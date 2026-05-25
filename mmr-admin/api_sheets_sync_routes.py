"""
api_sheets_sync_routes.py — Simplified Flask routes using generic_sync_runner.

All routes use the centralized SYNC_CONFIG and generic_sync_runner helpers
to eliminate code duplication and maintain a single source of truth.

Routes:
  POST /api/sync/export/members
  POST /api/sync/export/payments
  POST /api/sync/export/submissions
  POST /api/sync/export/transaction-meta
  POST /api/sync/import/members
  POST /api/sync/import/transactions
  POST /api/sync/jobs
  GET  /api/sync/status/<job_id>
"""

from __future__ import annotations

import logging
import time
from flask import Blueprint, request, jsonify
from helpers import json_response
from auth import login_required
from sync_jobs import launch_job, get_job, list_jobs as list_sync_jobs

# Import simplified sync runners
from sync_runners import (
    sync_export_members,
    sync_export_payments,
    sync_export_submissions,
    sync_export_transaction_meta,
    sync_import_members,
    sync_import_transactions,
)

logger = logging.getLogger(__name__)
sheets_sync_bp = Blueprint('sheets_sync', __name__)


# ═══════════════════════════════════════════════════════════════════════════
# Export Routes (MySQL → Google Sheets)
# ═══════════════════════════════════════════════════════════════════════════

@sheets_sync_bp.route('/api/sync/export/members', methods=['POST'])
@login_required
def api_export_members():
    """
    Export members from MySQL to Google Sheets.

    Returns:
        {ok: true, job_id: str}
    """
    job_id = launch_job(sync_export_members, initial_message='Exporting members...', operation='export_members')
    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/export/payments', methods=['POST'])
@login_required
def api_export_payments():
    """
    Export payments from MySQL to Google Sheets.

    Returns:
        {ok: true, job_id: str}
    """
    job_id = launch_job(sync_export_payments, initial_message='Exporting payments...', operation='export_payments')
    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/export/submissions', methods=['POST'])
@login_required
def api_export_submissions():
    """
    Export submissions from MySQL to Google Sheets.

    Returns:
        {ok: true, job_id: str}
    """
    job_id = launch_job(sync_export_submissions, initial_message='Exporting submissions...', operation='export_submissions')
    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/export/transaction-meta', methods=['POST'])
@login_required
def api_export_transaction_meta():
    """
    Export transaction metadata (Notes, UpdatedAt) from MySQL to Google Sheets.

    Returns:
        {ok: true, job_id: str}
    """
    job_id = launch_job(
        sync_export_transaction_meta,
        initial_message='Exporting transaction metadata...',
        operation='export_transaction_meta'
    )
    return json_response({'ok': True, 'job_id': job_id})


# ═══════════════════════════════════════════════════════════════════════════
# Import Routes (Google Sheets → MySQL)
# ═══════════════════════════════════════════════════════════════════════════

@sheets_sync_bp.route('/api/sync/import/members', methods=['POST'])
@login_required
def api_import_members():
    """
    Import NEW members from Google Sheets Main tab into MySQL members table.

    Mode: INSERT ONLY (skips duplicates, never updates existing members).
    Primary key: MemberID

    Returns:
        {ok: true, job_id: str}
    """
    job_id = launch_job(sync_import_members, initial_message='Importing new members...', operation='import_members')
    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/import/transactions', methods=['POST'])
@login_required
def api_import_transactions():
    """
    Import transactions from Google Sheets to MySQL.

    Mode: UPSERT (insert new or update existing).
    Field mappings:
      Source (Sheet) → PaymentMethod (MySQL)

    Returns:
        {ok: true, job_id: str}
    """
    job_id = launch_job(sync_import_transactions, initial_message='Importing transactions...', operation='import_transactions')
    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/full-sync', methods=['POST'])
@login_required
def api_full_sync():
    """
    Full Sync: Run all 5 operations in batch sequence.

    Operations (in order):
      1. Export Members (MySQL → Google Sheets, SQL Members tab)
      2. Export Payments (MySQL → Google Sheets, SQL Payments tab)
      3. Export Submissions (MySQL → Google Sheets, SQL Submissions tab)
      4. Export Transactions metadata (MySQL → Google Sheets, SQL Transactions tab, Notes & UpdatedAt only)
      5. Import Transactions (Google Sheets → MySQL, gmail_transactions table)

    Returns:
        {ok: true, job_id: str}
    """
    job_id = launch_job(full_sync_all_operations, initial_message='Starting Full Sync (all 5 operations)...', operation='full_sync')
    return json_response({'ok': True, 'job_id': job_id})


# ═══════════════════════════════════════════════════════════════════════════
# Job Management Routes
# ═══════════════════════════════════════════════════════════════════════════

@sheets_sync_bp.route('/api/sync/last-import', methods=['GET'])
@login_required
def api_last_import():
    """
    Return the timestamp of the most recent successful import_transactions job.

    Queries sync_jobs directly (no 24h cap) so it survives process restarts.
    Falls back to MAX(Timestamp) in gmail_transactions if sync_jobs has no record.
    """
    try:
        from db import query
        rows = query(
            "SELECT CompletedAt FROM sync_jobs WHERE Operation = %s AND Status = 'done' "
            "AND CompletedAt IS NOT NULL ORDER BY CompletedAt DESC LIMIT 1",
            ['import_transactions']
        )
        if rows and rows[0]['CompletedAt']:
            ts = rows[0]['CompletedAt'].timestamp()
            return json_response({'ok': True, 'completedAt': ts})
        # Fallback: latest transaction timestamp as a proxy
        rows2 = query("SELECT MAX(Timestamp) AS ts FROM gmail_transactions")
        ts2 = rows2[0]['ts'].timestamp() if rows2 and rows2[0]['ts'] else None
        return json_response({'ok': True, 'completedAt': ts2})
    except Exception as e:
        logger.warning(f"api_last_import failed: {e}")
        return json_response({'ok': True, 'completedAt': None})


@sheets_sync_bp.route('/api/sync/jobs', methods=['GET'])
@login_required
def api_list_sync_jobs():
    """
    Return all known sync jobs (newest first) so the UI can restore state on mount.

    Returns:
        {
            ok: true,
            jobs: [
                {
                    id: str,
                    status: 'queued' | 'running' | 'completed' | 'error',
                    message: str,
                    progress: int (0-100),
                    started_at: ISO timestamp,
                    completed_at: ISO timestamp | null
                }
            ]
        }
    """
    jobs = list_sync_jobs()
    return json_response({
        'ok': True,
        'jobs': jobs
    })


# Terminal jobs older than this are expired — frontend must stop polling.
_JOB_TTL_SECONDS = 300  # 5 minutes


@sheets_sync_bp.route('/api/sync/status/<job_id>', methods=['GET'])
@login_required
def api_sync_status(job_id: str):
    """
    Get the status of a specific sync job.

    Returns 404 when a terminal job (done/error) is older than _JOB_TTL_SECONDS.
    This forces any frontend poller to stop regardless of which code version is
    running — the frontend's !r.ok / 404 branch must call clearInterval.

    Returns:
        {
            ok: true,
            job: {
                id: str,
                status: 'queued' | 'running' | 'done' | 'error',
                message: str,
                progress: int (0-100),
                started_at: ISO timestamp,
                completed_at: ISO timestamp | null
            }
        }
    """
    user_agent = request.headers.get('User-Agent', 'unknown')

    job = get_job(job_id)
    if not job:
        logger.warning(f"[FETCH] Job {job_id} not found")
        return json_response({'ok': False, 'error': 'Job not found'}, 404)

    status = job.get('status', 'unknown')
    progress = job.get('progress', 0)
    message = job.get('message', '')[:50]

    if status in ('done', 'error'):
        # Expire terminal jobs after TTL — return 404 so any frontend poller stops
        updated_at = job.get('updatedAt') or job.get('completedAt') or 0
        age = time.time() - updated_at if updated_at else _JOB_TTL_SECONDS + 1
        if age > _JOB_TTL_SECONDS:
            logger.info(f"[FETCH] Job {job_id} expired (age={age:.0f}s) — returning 404 to stop pollers")
            return json_response({'ok': False, 'error': 'Job expired', 'job_id': job_id}, 404)
        logger.info(f"[FETCH] Job {job_id} COMPLETE status={status}, age={age:.0f}s — user_agent={user_agent[:80]}")
    else:
        logger.debug(f"[FETCH] Job {job_id} status={status}, progress={progress}%, message='{message}'")

    return json_response({'ok': True, 'job': job})
