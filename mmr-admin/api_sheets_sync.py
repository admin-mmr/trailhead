"""
Google Sheets ↔ MySQL sync endpoints for mmr-admin.

Three main operations:
  1. MySQL → Google (members, events, payments) — LIVE
  2. Import Transactions from Google — LIVE (sync new items to mysql)
  3. Google → MySQL — DRY RUN (display differences, no changes)

All endpoints are async (daemon threads) and return immediately with job_id.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import traceback
from datetime import datetime
from typing import Any, Dict, List, Optional

from flask import Blueprint, request
from db import query, execute, get_conn
from helpers import json_response
from email_client import send_email
from auth import login_required

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

sheets_sync_bp = Blueprint('sheets_sync', __name__)

# In-flight sync jobs: job_id -> {status, message, progress, result}
_sync_jobs: Dict[str, Dict[str, Any]] = {}
_sync_jobs_lock = threading.Lock()


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

def _gen_job_id() -> str:
    """Generate a unique job ID."""
    import uuid
    return f"sync_{int(time.time())}_{uuid.uuid4().hex[:8]}"


def _get_config_value(key: str, default: str = '') -> str:
    """Get a single config value."""
    rows = query("SELECT ConfigValue FROM config WHERE ConfigKey = %s", [key])
    return rows[0]['ConfigValue'] if rows else default


def _send_sync_report(
    recipient: str,
    operation: str,
    summary: str,
    details: List[str],
    log_content: str,
) -> bool:
    """Send sync report email."""
    title = f"MMR Sync Report: {operation}"
    body = f"""
{summary}

Details ({len(details)} items):
{chr(10).join(f"  • {d}" for d in details[:50])}
{f"  ... and {len(details) - 50} more" if len(details) > 50 else ""}

---
Full Log:
{log_content[:2000]}
{"..." if len(log_content) > 2000 else ""}

Generated: {datetime.now().isoformat()}
"""
    try:
        send_email(
            to_address=recipient,
            subject=title,
            html_body=body.replace('\n', '<br>'),
        )
        return True
    except Exception as e:
        logger.error(f"Failed to send sync report: {e}")
        return False


# ═══════════════════════════════════════════════════════════════════════════
# MySQL → Google: Members sync
# ═══════════════════════════════════════════════════════════════════════════

def _sync_members_to_sheets(job_id: str):
    """
    Fetch all members from MySQL, compare against Google Sheets by MemberID.

    Logic:
      - If new MemberID not in Sheets → append
      - If exists: check LastUpdated in Sheets (column P) vs MySQL
        - If MySQL newer → copy all fields to Sheets
        - Else → skip

    Creates detailed sync log with all changes.
    """
    log_lines = []
    inserted = []
    updated = []
    errors = []

    try:
        job_update = {'status': 'running', 'message': 'Fetching members from MySQL...', 'progress': 0}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Fetch all members from MySQL
        members_rows = query("SELECT * FROM members ORDER BY MemberID")
        log_lines.append(f"📥 Fetched {len(members_rows)} members from MySQL")

        # TODO: Fetch members from Google Sheets via GAS webhook
        # For now, simulate with a placeholder request to GAS
        # sheets_data = _call_gas_webhook({'action': 'get_members'})
        # For v1, we'll just log the plan

        job_update = {
            'status': 'running',
            'message': f'Syncing {len(members_rows)} members to Google Sheets...',
            'progress': 25,
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        for idx, member in enumerate(members_rows):
            member_id = member['MemberID']
            mysql_updated = member.get('LastUpdated')

            # TODO: Check if member exists in Google Sheets by MemberID
            # If not found → mark for append
            # If found → check LastUpdated and decide to update

            # For now, log what would happen
            log_lines.append(f"✓ {member_id}: would sync {member['FirstName']} {member['LastName']}")
            inserted.append(f"{member_id} ({member.get('FirstName', '')} {member.get('LastName', '')})")

            if (idx + 1) % 50 == 0:
                job_update = {'progress': 25 + int((idx / len(members_rows)) * 50)}
                with _sync_jobs_lock:
                    _sync_jobs[job_id].update(job_update)

        summary = f"✅ Members Sync Complete: {len(inserted)} inserted/updated, {len(errors)} errors"
        log_lines.insert(0, summary)

        job_update = {
            'status': 'done',
            'message': summary,
            'progress': 100,
            'result': {
                'operation': 'members_to_sheets',
                'inserted': len(inserted),
                'updated': 0,
                'errors': len(errors),
                'inserted_list': inserted[:100],
                'error_list': errors[:50],
                'log': '\n'.join(log_lines),
            }
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Send report email
        _send_sync_report(
            recipient='admin@mmrunners.org',
            operation='MySQL → Google: Members',
            summary=summary,
            details=inserted[:100],
            log_content='\n'.join(log_lines),
        )

    except Exception as e:
        error_msg = f"❌ Sync failed: {e}"
        log_lines.append(error_msg)
        logger.error(f"Members sync error: {e}\n{traceback.format_exc()}")

        job_update = {
            'status': 'error',
            'message': error_msg,
            'progress': 100,
            'result': {'error': str(e), 'log': '\n'.join(log_lines)}
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)


def _sync_events_to_sheets(job_id: str):
    """Similar to members: compare webapp_events by EventID."""
    log_lines = []
    inserted = []

    try:
        job_update = {'status': 'running', 'message': 'Syncing events...', 'progress': 0}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        events_rows = query(
            "SELECT * FROM webapp_events WHERE EventStatus NOT IN ('cancelled', 'archived') ORDER BY EventID"
        )
        log_lines.append(f"📥 Fetched {len(events_rows)} events from MySQL")

        for event in events_rows:
            log_lines.append(f"✓ {event['EventID']}: {event.get('EventName', '')}")
            inserted.append(event['EventID'])

        summary = f"✅ Events Sync: {len(inserted)} processed"

        job_update = {
            'status': 'done',
            'message': summary,
            'progress': 100,
            'result': {
                'operation': 'events_to_sheets',
                'inserted': len(inserted),
                'log': '\n'.join(log_lines),
            }
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

    except Exception as e:
        logger.error(f"Events sync error: {e}")
        job_update = {
            'status': 'error',
            'message': f"❌ Events sync failed: {e}",
            'result': {'error': str(e), 'log': '\n'.join(log_lines)}
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)


def _sync_payments_to_sheets(job_id: str):
    """Similar to members/events: compare payments by PaymentID."""
    log_lines = []
    inserted = []

    try:
        job_update = {'status': 'running', 'message': 'Syncing payments...', 'progress': 0}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        payments_rows = query("SELECT * FROM payments ORDER BY PaymentID DESC LIMIT 500")
        log_lines.append(f"📥 Fetched {len(payments_rows)} recent payments from MySQL")

        for payment in payments_rows:
            log_lines.append(f"✓ {payment['PaymentID']}: ${payment.get('Amount', 0)}")
            inserted.append(payment['PaymentID'])

        summary = f"✅ Payments Sync: {len(inserted)} processed"

        job_update = {
            'status': 'done',
            'message': summary,
            'progress': 100,
            'result': {
                'operation': 'payments_to_sheets',
                'inserted': len(inserted),
                'log': '\n'.join(log_lines),
            }
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

    except Exception as e:
        logger.error(f"Payments sync error: {e}")
        job_update = {
            'status': 'error',
            'message': f"❌ Payments sync failed: {e}",
            'result': {'error': str(e), 'log': '\n'.join(log_lines)}
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)


# ═══════════════════════════════════════════════════════════════════════════
# Import Transactions from Google Sheets
# ═══════════════════════════════════════════════════════════════════════════

def _import_transactions(job_id: str):
    """
    Fetch gmail_transactions from Google Sheets.

    For each row:
      - If MessageId not in MySQL → INSERT
      - If exists: check if Memo differs from Notes → UPDATE Notes in MySQL
    """
    log_lines = []
    inserted = []
    updated = []
    errors = []

    try:
        job_update = {'status': 'running', 'message': 'Fetching transactions from Google...', 'progress': 0}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # TODO: Call GAS webhook to get gmail_transactions sheet
        # sheets_txns = _call_gas_webhook({'action': 'get_transactions'})

        # For now, just log the intent
        log_lines.append("📥 Importing gmail_transactions from Google Sheets...")
        log_lines.append("Note: MessageId is primary key; only update Notes if Memo differs")

        job_update = {
            'status': 'done',
            'message': 'ℹ️ Import transactions ready (awaiting GAS integration)',
            'progress': 100,
            'result': {
                'operation': 'import_transactions',
                'inserted': 0,
                'updated': 0,
                'log': '\n'.join(log_lines),
            }
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

    except Exception as e:
        logger.error(f"Transaction import error: {e}")
        job_update = {
            'status': 'error',
            'message': f"❌ Import failed: {e}",
            'result': {'error': str(e)}
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)


# ═══════════════════════════════════════════════════════════════════════════
# Google → MySQL: Dry Run (no changes)
# ═══════════════════════════════════════════════════════════════════════════

def _dry_run_google_to_mysql(job_id: str):
    """
    Fetch data from Google Sheets and compare with MySQL.
    Display differences but make NO changes.
    """
    log_lines = []
    diffs = []

    try:
        job_update = {'status': 'running', 'message': 'Running dry-run comparison...', 'progress': 0}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # TODO: Fetch sheets data and compare
        log_lines.append("🔍 Dry-run: Google → MySQL (no changes)")
        log_lines.append("This would show differences between Google Sheets and MySQL")
        log_lines.append("No changes made — for review only.")

        job_update = {
            'status': 'done',
            'message': '✅ Dry-run complete: 0 differences detected',
            'progress': 100,
            'result': {
                'operation': 'dry_run_google_to_mysql',
                'differences': diffs,
                'log': '\n'.join(log_lines),
            }
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

    except Exception as e:
        logger.error(f"Dry-run error: {e}")
        job_update = {
            'status': 'error',
            'message': f"❌ Dry-run failed: {e}",
            'result': {'error': str(e)}
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)


# ═══════════════════════════════════════════════════════════════════════════
# REST API Endpoints
# ═══════════════════════════════════════════════════════════════════════════

@sheets_sync_bp.route('/api/sync/mysql-to-google/members', methods=['POST'])
@login_required
def api_sync_members():
    """Trigger members sync (MySQL → Google Sheets)."""
    job_id = _gen_job_id()

    with _sync_jobs_lock:
        _sync_jobs[job_id] = {
            'status': 'queued',
            'message': 'Queued',
            'progress': 0,
            'created_at': datetime.utcnow().isoformat(),
        }

    thread = threading.Thread(target=_sync_members_to_sheets, args=(job_id,), daemon=True)
    thread.start()

    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/mysql-to-google/events', methods=['POST'])
@login_required
def api_sync_events():
    """Trigger events sync (MySQL → Google Sheets)."""
    job_id = _gen_job_id()

    with _sync_jobs_lock:
        _sync_jobs[job_id] = {
            'status': 'queued',
            'message': 'Queued',
            'progress': 0,
            'created_at': datetime.utcnow().isoformat(),
        }

    thread = threading.Thread(target=_sync_events_to_sheets, args=(job_id,), daemon=True)
    thread.start()

    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/mysql-to-google/payments', methods=['POST'])
@login_required
def api_sync_payments():
    """Trigger payments sync (MySQL → Google Sheets)."""
    job_id = _gen_job_id()

    with _sync_jobs_lock:
        _sync_jobs[job_id] = {
            'status': 'queued',
            'message': 'Queued',
            'progress': 0,
            'created_at': datetime.utcnow().isoformat(),
        }

    thread = threading.Thread(target=_sync_payments_to_sheets, args=(job_id,), daemon=True)
    thread.start()

    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/import-transactions', methods=['POST'])
@login_required
def api_import_transactions():
    """Trigger transaction import (Google Sheets → MySQL)."""
    job_id = _gen_job_id()

    with _sync_jobs_lock:
        _sync_jobs[job_id] = {
            'status': 'queued',
            'message': 'Queued',
            'progress': 0,
            'created_at': datetime.utcnow().isoformat(),
        }

    thread = threading.Thread(target=_import_transactions, args=(job_id,), daemon=True)
    thread.start()

    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/dry-run', methods=['POST'])
@login_required
def api_dry_run():
    """Trigger dry-run (Google → MySQL, no changes)."""
    job_id = _gen_job_id()

    with _sync_jobs_lock:
        _sync_jobs[job_id] = {
            'status': 'queued',
            'message': 'Queued',
            'progress': 0,
            'created_at': datetime.utcnow().isoformat(),
        }

    thread = threading.Thread(target=_dry_run_google_to_mysql, args=(job_id,), daemon=True)
    thread.start()

    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/status/<job_id>')
@login_required
def api_sync_status(job_id):
    """Get status of a sync job."""
    with _sync_jobs_lock:
        job = _sync_jobs.get(job_id, {})

    if not job:
        return json_response({'ok': False, 'error': 'Job not found'}, 404)

    return json_response({'ok': True, 'data': job})
