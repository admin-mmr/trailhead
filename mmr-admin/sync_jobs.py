"""
Background job registry for mmr-admin sheets-sync operations.

Replaces the 10 identical daemon-thread dispatch blocks in api_sheets_sync.py
and the ad-hoc _sync_jobs dict + _sync_jobs_lock + _gen_job_id pattern.

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
from typing import Any, Dict, Optional


_jobs: Dict[str, Dict[str, Any]] = {}
_lock = threading.Lock()


def _make_job(job_id: str, initial_message: str) -> Dict[str, Any]:
    return {
        'jobId':     job_id,
        'status':    'queued',
        'message':   initial_message,
        'progress':  0,
        'startedAt': time.time(),
        'updatedAt': time.time(),
        'result':    None,
    }


def _new_job_id() -> str:
    """8-char hex job ID based on time + thread ID."""
    return f'{int(time.time() * 1000) % 0xFFFFFFFF:08x}'


def launch_job(
    worker,
    *args,
    initial_message: str = 'Queued',
    **kwargs,
) -> str:
    """
    Register a new background job and start it in a daemon thread.

    The worker callable receives `job_id` as its first positional argument,
    followed by any additional *args and **kwargs.

    Returns the job_id string.
    """
    job_id = _new_job_id()
    with _lock:
        _jobs[job_id] = _make_job(job_id, initial_message)

    t = threading.Thread(target=worker, args=(job_id, *args), kwargs=kwargs, daemon=True)
    t.start()
    return job_id


def update_job(job_id: str, **fields) -> None:
    """
    Update fields on an existing job.

    Common fields: status ('queued'|'running'|'done'|'error'),
                   message (str), progress (0–100), result (any).
    """
    with _lock:
        if job_id in _jobs:
            _jobs[job_id].update(fields)
            _jobs[job_id]['updatedAt'] = time.time()


def get_job(job_id: str) -> Optional[Dict[str, Any]]:
    """Return a copy of the job dict, or None if not found."""
    with _lock:
        job = _jobs.get(job_id)
        return dict(job) if job else None


def list_jobs() -> list:
    """Return a list of all job dicts, newest first."""
    with _lock:
        jobs = list(_jobs.values())
    return sorted(jobs, key=lambda j: j['startedAt'], reverse=True)
