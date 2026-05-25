"""
Background job registry for mmr-admin sheets-sync operations.

Replaces the 10 identical daemon-thread dispatch blocks in api_sheets_sync.py
and the ad-hoc _sync_jobs dict + _sync_jobs_lock + _gen_job_id pattern.

Persists job entries to MySQL sync_jobs table for audit trail and batch logging FK compliance.

Usage:
    from sync_jobs import launch_job, update_job, get_job, list_jobs

    def my_worker(job_id: str, arg1, arg2):
        update_job(job_id, status='running', message='Working...')
        try:
            # ... do work ...
            update_job(job_id, status='done', message='Completed', progress=100)
        except Exception as e:
            update_job(job_id, status='error', message=str(e))

    job_id = launch_job(my_worker, arg1, arg2, initial_message='Starting...')
    return json_response({'ok': True, 'jobId': job_id})
"""

from __future__ import annotations

import threading
import time
import logging
import json
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

_jobs: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()


def _get_db_execute():
    """Lazy import to avoid circular dependencies."""
    try:
        from db import execute
        return execute
    except ImportError:
        return None


def _make_job(job_id: str, initial_message: str, operation: str = 'sync') -> Dict[str, Any]:
    return {
        'jobId':       job_id,
        'operation':   operation,
        'status':      'queued',
        'message':     initial_message,
        'progress':    0,
        'startedAt':   time.time(),
        'updatedAt':   time.time(),
        'completedAt': None,
        'result':      None,
    }


def _new_job_id() -> str:
    """8-char hex job ID based on time + thread ID."""
    return f'{int(time.time() * 1000) % 0xFFFFFFFF:08x}'


def launch_job(
    worker,
    *args,
    initial_message: str = 'Queued',
    operation: str = 'sync',
    **kwargs,
) -> str:
    """
    Register a new background job and start it in a daemon thread.

    The worker callable receives `job_id` as its first positional argument,
    followed by any additional *args and **kwargs.

    Persists job entry to MySQL sync_jobs table for audit trail and FK compliance.

    Args:
        worker: Callable(job_id, *args, **kwargs) to execute in background
        initial_message: Status message (default: 'Queued')
        operation: Operation name for audit (default: 'sync')

    Returns the job_id string.
    """
    job_id = _new_job_id()
    job = _make_job(job_id, initial_message, operation)

    # Insert into MySQL sync_jobs table
    db_execute = _get_db_execute()
    if db_execute:
        try:
            sql = """
                INSERT INTO sync_jobs (JobID, Operation, Status, Message, Progress, StartedAt, UpdatedAt)
                VALUES (%s, %s, %s, %s, %s, NOW(), NOW())
                ON DUPLICATE KEY UPDATE
                    Status = VALUES(Status),
                    Message = VALUES(Message),
                    UpdatedAt = NOW()
            """
            db_execute(sql, [job_id, operation, job['status'], job['message'], job['progress']])
            logger.debug(f"Persisted job {job_id} ({operation}) to sync_jobs table")
        except Exception as e:
            logger.warning(f"Failed to persist job {job_id} to MySQL: {str(e)}")

    with _lock:
        _jobs[job_id] = job

    t = threading.Thread(target=worker, args=(job_id, *args), kwargs=kwargs, daemon=True)
    t.start()
    return job_id


def update_job(job_id: str, **fields) -> None:
    """
    Update fields on an existing job.

    Syncs changes to MySQL sync_jobs table for durability.

    Common fields: status ('queued'|'running'|'done'|'error'),
                   message (str), progress (0–100), result (any).
    """
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].update(fields)
            _jobs[job_id]['updatedAt'] = time.time()
            if fields.get('status') in ('done', 'error') and not _jobs[job_id].get('completedAt'):
                _jobs[job_id]['completedAt'] = time.time()

    # Sync to MySQL
    db_execute = _get_db_execute()
    if db_execute and fields:
        try:
            logger.debug(f"update_job({job_id}): fields={fields}")

            # Build update clause dynamically from fields
            set_clauses = []
            params = []
            if 'status' in fields:
                status_val = fields['status']
                logger.debug(f"  Setting Status = {repr(status_val)} (type: {type(status_val).__name__})")
                set_clauses.append('Status = %s')
                params.append(status_val)
            if 'message' in fields:
                set_clauses.append('Message = %s')
                params.append(fields['message'])
            if 'progress' in fields:
                set_clauses.append('Progress = %s')
                params.append(fields['progress'])
            if 'result' in fields:
                set_clauses.append('Result = %s')
                # Convert dict to JSON string if needed
                result_val = fields['result']
                if isinstance(result_val, dict):
                    result_val = json.dumps(result_val)
                params.append(result_val)

            if set_clauses:
                set_clauses.append('UpdatedAt = NOW()')
                if fields.get('status') == 'done' or fields.get('status') == 'error':
                    set_clauses.append('CompletedAt = NOW()')

                sql = f"UPDATE sync_jobs SET {', '.join(set_clauses)} WHERE JobID = %s"
                params.append(job_id)
                logger.debug(f"  SQL: {sql}")
                logger.debug(f"  Params: {params}")
                db_execute(sql, params)
                logger.debug(f"Updated job {job_id} in sync_jobs table")
        except Exception as e:
            logger.warning(f"Failed to update job {job_id} in MySQL: {str(e)}")


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """
    Return a copy of the job dict.

    First checks in-memory cache (_jobs).
    If not found, falls back to MySQL sync_jobs table for durability
    (handles process restarts, cross-process lookups).
    """
    # Check in-memory cache first
    with _lock:
        job = _jobs.get(job_id)
        if job:
            return dict(job)

    # Fall back to MySQL database
    db_query = None
    try:
        from db import query as db_query_fn
        db_query = db_query_fn
    except ImportError:
        pass

    if db_query:
        try:
            rows = db_query(
                "SELECT JobID, Operation, Status, Message, Progress, Result, StartedAt, UpdatedAt, CompletedAt FROM sync_jobs WHERE JobID = %s",
                [job_id]
            )
            if rows:
                row = rows[0]
                # Convert MySQL row dict → in-memory job dict format
                job_from_db = {
                    'jobId': row['JobID'],
                    'operation': row['Operation'],
                    'status': row['Status'],
                    'message': row['Message'],
                    'progress': row['Progress'] or 0,
                    'startedAt': row['StartedAt'].timestamp() if row['StartedAt'] else 0,
                    'updatedAt': row['UpdatedAt'].timestamp() if row['UpdatedAt'] else 0,
                    'completedAt': row['CompletedAt'].timestamp() if row['CompletedAt'] else None,
                    'result': row['Result'],
                }
                logger.debug(f"get_job({job_id}): found in MySQL, status={row['Status']}")
                return job_from_db
        except Exception as e:
            logger.warning(f"get_job({job_id}): MySQL fallback failed: {str(e)}")

    return None


def list_jobs() -> list:
    """
    Return a list of all job dicts, newest first.

    Includes both in-memory jobs and recent jobs from MySQL database.
    (Handles process restarts and cross-process visibility.)
    """
    # Start with in-memory jobs
    with _lock:
        jobs_in_memory = {job['jobId']: job for job in _jobs.values()}

    # Also fetch recent jobs from MySQL (last 50, last 24 hours)
    db_query = None
    try:
        from db import query as db_query_fn
        db_query = db_query_fn
    except ImportError:
        pass

    jobs_from_db = {}
    if db_query:
        try:
            rows = db_query("""
                SELECT JobID, Operation, Status, Message, Progress, Result, StartedAt, UpdatedAt, CompletedAt
                FROM sync_jobs
                WHERE StartedAt >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
                ORDER BY StartedAt DESC
                LIMIT 50
            """)
            for row in rows:
                job_from_db = {
                    'jobId': row['JobID'],
                    'operation': row['Operation'],
                    'status': row['Status'],
                    'message': row['Message'],
                    'progress': row['Progress'] or 0,
                    'startedAt': row['StartedAt'].timestamp() if row['StartedAt'] else 0,
                    'updatedAt': row['UpdatedAt'].timestamp() if row['UpdatedAt'] else 0,
                    'completedAt': row['CompletedAt'].timestamp() if row['CompletedAt'] else None,
                    'result': row['Result'],
                }
                jobs_from_db[row['JobID']] = job_from_db
        except Exception as e:
            logger.warning(f"list_jobs(): MySQL query failed: {str(e)}")

    # Merge: in-memory jobs take precedence (more up-to-date)
    all_jobs = {**jobs_from_db, **jobs_in_memory}
    return sorted(all_jobs.values(), key=lambda j: j['startedAt'], reverse=True)
