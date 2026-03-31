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


def _call_gas_webhook(payload: Dict) -> Dict:
    """
    Call the Google Apps Script webhook to fetch/push Sheets data.

    Args:
        payload: {action: str, ...}

    Returns:
        Response data or empty dict on error
    """
    webhook_url = _get_config_value('SheetsWebhookUrl', '')
    if not webhook_url:
        logger.warning("SheetsWebhookUrl not configured — skipping webhook call")
        return {}

    import requests
    try:
        resp = requests.post(webhook_url, json=payload, timeout=30)
        if resp.status_code != 200:
            raise Exception(f"HTTP {resp.status_code}: {resp.text[:500]}")

        body = resp.json()
        if not body.get('ok'):
            raise Exception(f"GAS error: {body.get('error', body)}")

        return body.get('data', {})
    except Exception as e:
        logger.error(f"GAS webhook failed: {e}")
        raise


def _serialize_row(row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert datetime and other non-JSON-serializable objects to strings.
    Needed before sending rows to GAS webhook.
    """
    from decimal import Decimal

    result = {}
    for key, value in row.items():
        if isinstance(value, datetime):
            result[key] = value.isoformat()
        elif hasattr(value, 'isoformat'):  # Handle date, time, timedelta, etc.
            result[key] = value.isoformat()
        elif isinstance(value, Decimal):
            result[key] = str(float(value))  # Convert Decimal to float then string
        elif value is None:
            result[key] = ''  # GAS prefers empty string over null
        else:
            result[key] = value
    return result


def _serialize_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Serialize all rows in a list."""
    return [_serialize_row(row) for row in rows]


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

        # Fetch members from Google Sheets
        try:
            sheets_data = _call_gas_webhook({'action': 'get_members'})
            sheets_members = sheets_data if isinstance(sheets_data, list) else []
            sheets_by_id = {m['MemberID']: m for m in sheets_members if 'MemberID' in m}
            log_lines.append(f"📊 Fetched {len(sheets_by_id)} members from Google Sheets")
        except Exception as e:
            log_lines.append(f"⚠️  Could not fetch from Sheets: {e}")
            sheets_by_id = {}

        job_update = {
            'status': 'running',
            'message': f'Syncing {len(members_rows)} members to Google Sheets...',
            'progress': 25,
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Separate rows for appending vs updating
        rows_to_append = []
        rows_to_update = []

        for idx, member in enumerate(members_rows):
            member_id = member['MemberID']
            mysql_updated = member.get('LastUpdated')

            if member_id not in sheets_by_id:
                # New member — append to Sheets
                rows_to_append.append(member)
                log_lines.append(f"✅ {member_id}: {member.get('FirstName', '')} {member.get('LastName', '')} (NEW)")
                inserted.append(f"{member_id} ({member.get('FirstName', '')} {member.get('LastName', '')})")
            else:
                # Existing member — check versioning
                sheets_member = sheets_by_id[member_id]
                sheets_updated = sheets_member.get('LastUpdated')

                # Compare timestamps
                if mysql_updated and sheets_updated:
                    # Both have timestamps — compare them
                    mysql_ts = str(mysql_updated) if mysql_updated else ''
                    sheets_ts = str(sheets_updated) if sheets_updated else ''
                    if mysql_ts > sheets_ts:
                        rows_to_update.append(member)
                        log_lines.append(f"🔄 {member_id}: {member.get('FirstName', '')} {member.get('LastName', '')} (MySQL newer)")
                        updated.append(f"{member_id} (updated)")
                elif mysql_updated:
                    # MySQL has timestamp, Sheets doesn't — update
                    rows_to_update.append(member)
                    log_lines.append(f"🔄 {member_id}: {member.get('FirstName', '')} {member.get('LastName', '')} (Sheets missing date)")
                    updated.append(f"{member_id} (updated)")
                else:
                    log_lines.append(f"⊘ {member_id}: skipped (no MySQL LastUpdated)")

            if (idx + 1) % 50 == 0:
                job_update = {'progress': 25 + int((idx / len(members_rows)) * 50)}
                with _sync_jobs_lock:
                    _sync_jobs[job_id].update(job_update)

        # Push changes to Sheets
        if rows_to_append:
            try:
                _call_gas_webhook({'action': 'append_members', 'rows': _serialize_rows(rows_to_append)})
                log_lines.append(f"📤 Appended {len(rows_to_append)} new members to Sheets")
            except Exception as e:
                log_lines.append(f"❌ Failed to append members: {e}")
                errors.append(f"append_members: {e}")

        if rows_to_update:
            try:
                _call_gas_webhook({'action': 'update_members', 'rows': _serialize_rows(rows_to_update)})
                log_lines.append(f"📤 Updated {len(rows_to_update)} members in Sheets")
            except Exception as e:
                log_lines.append(f"❌ Failed to update members: {e}")
                errors.append(f"update_members: {e}")

        summary = f"✅ Members Sync Complete: {len(inserted)} inserted, {len(updated)} updated, {len(errors)} errors"
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

        # Send error report email
        try:
            _send_sync_report(
                recipient='admin@mmrunners.org',
                operation='MySQL → Google: Members',
                summary=error_msg,
                details=[],
                log_content='\n'.join(log_lines),
            )
        except Exception as email_err:
            logger.error(f"Failed to send error email: {email_err}")


def _sync_events_to_sheets(job_id: str):
    """Compare webapp_events by EventID with smart versioning."""
    log_lines = []
    inserted = []
    updated = []
    errors = []

    try:
        job_update = {'status': 'running', 'message': 'Fetching events...', 'progress': 0}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        events_rows = query(
            "SELECT * FROM webapp_events ORDER BY EventID"
        )
        log_lines.append(f"📥 Fetched {len(events_rows)} events from MySQL")

        # Fetch from Sheets
        try:
            sheets_data = _call_gas_webhook({'action': 'get_events'})
            sheets_events = sheets_data if isinstance(sheets_data, list) else []
            sheets_by_id = {e.get('EventID'): e for e in sheets_events if 'EventID' in e}
            log_lines.append(f"📊 Fetched {len(sheets_by_id)} events from Google Sheets")
        except Exception as e:
            log_lines.append(f"⚠️  Could not fetch from Sheets: {e}")
            sheets_by_id = {}

        job_update = {'status': 'running', 'message': 'Syncing events...', 'progress': 25}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        rows_to_append = []
        rows_to_update = []

        for idx, event in enumerate(events_rows):
            event_id = event['EventID']
            mysql_updated = event.get('UpdatedAt')

            if event_id not in sheets_by_id:
                rows_to_append.append(event)
                log_lines.append(f"✅ {event_id}: {event.get('EventName', '')} (NEW)")
                inserted.append(event_id)
            else:
                sheets_event = sheets_by_id[event_id]
                sheets_updated = sheets_event.get('UpdatedAt')

                if mysql_updated and sheets_updated:
                    mysql_ts = str(mysql_updated) if mysql_updated else ''
                    sheets_ts = str(sheets_updated) if sheets_updated else ''
                    if mysql_ts > sheets_ts:
                        rows_to_update.append(event)
                        log_lines.append(f"🔄 {event_id}: updated")
                        updated.append(event_id)
                elif mysql_updated:
                    rows_to_update.append(event)
                    log_lines.append(f"🔄 {event_id}: updated (Sheets missing date)")
                    updated.append(event_id)

            if (idx + 1) % 50 == 0:
                job_update = {'progress': 25 + int((idx / len(events_rows)) * 50)}
                with _sync_jobs_lock:
                    _sync_jobs[job_id].update(job_update)

        # Push to Sheets
        if rows_to_append:
            try:
                _call_gas_webhook({'action': 'append_events', 'rows': _serialize_rows(rows_to_append)})
                log_lines.append(f"📤 Appended {len(rows_to_append)} new events")
            except Exception as e:
                log_lines.append(f"❌ Failed to append events: {e}")
                errors.append(f"append_events: {e}")

        if rows_to_update:
            try:
                _call_gas_webhook({'action': 'update_events', 'rows': _serialize_rows(rows_to_update)})
                log_lines.append(f"📤 Updated {len(rows_to_update)} events")
            except Exception as e:
                log_lines.append(f"❌ Failed to update events: {e}")
                errors.append(f"update_events: {e}")

        summary = f"✅ Events Sync: {len(inserted)} inserted, {len(updated)} updated, {len(errors)} errors"

        job_update = {
            'status': 'done',
            'message': summary,
            'progress': 100,
            'result': {
                'operation': 'events_to_sheets',
                'inserted': len(inserted),
                'updated': len(updated),
                'errors': len(errors),
                'log': '\n'.join(log_lines),
            }
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Send report email
        _send_sync_report(
            recipient='admin@mmrunners.org',
            operation='MySQL → Google: Events',
            summary=summary,
            details=inserted[:50],
            log_content='\n'.join(log_lines),
        )

    except Exception as e:
        logger.error(f"Events sync error: {e}\n{traceback.format_exc()}")
        error_msg = f"❌ Events sync failed: {e}"
        job_update = {
            'status': 'error',
            'message': error_msg,
            'result': {'error': str(e), 'log': '\n'.join(log_lines)}
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Send error report email
        try:
            _send_sync_report(
                recipient='admin@mmrunners.org',
                operation='MySQL → Google: Events',
                summary=error_msg,
                details=[],
                log_content='\n'.join(log_lines),
            )
        except Exception as email_err:
            logger.error(f"Failed to send error email: {email_err}")


def _sync_payments_to_sheets(job_id: str):
    """Compare payments by PaymentID with smart versioning."""
    log_lines = []
    inserted = []
    updated = []
    errors = []

    try:
        job_update = {'status': 'running', 'message': 'Fetching payments...', 'progress': 0}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        payments_rows = query("SELECT * FROM payments ORDER BY PaymentID DESC LIMIT 500")
        log_lines.append(f"📥 Fetched {len(payments_rows)} recent payments from MySQL")

        # Fetch from Sheets
        try:
            sheets_data = _call_gas_webhook({'action': 'get_payments'})
            sheets_payments = sheets_data if isinstance(sheets_data, list) else []
            sheets_by_id = {p.get('PaymentID'): p for p in sheets_payments if 'PaymentID' in p}
            log_lines.append(f"📊 Fetched {len(sheets_by_id)} payments from Google Sheets")
        except Exception as e:
            log_lines.append(f"⚠️  Could not fetch from Sheets: {e}")
            sheets_by_id = {}

        job_update = {'status': 'running', 'message': 'Syncing payments...', 'progress': 25}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        rows_to_append = []
        rows_to_update = []

        for idx, payment in enumerate(payments_rows):
            payment_id = payment['PaymentID']
            mysql_updated = payment.get('ProcessedDate')
            amount = float(payment.get('Amount', 0))
            member_id = payment.get('MemberID', '?')

            # Fetch member name for better debugging
            member_name = '?'
            if member_id and member_id != '?':
                member_rows = query("SELECT FirstName, LastName FROM members WHERE MemberID = %s", [member_id])
                if member_rows:
                    first = member_rows[0].get('FirstName', '')
                    last = member_rows[0].get('LastName', '')
                    member_name = f"{first} {last}".strip() or '?'

            if payment_id not in sheets_by_id:
                rows_to_append.append(payment)
                log_lines.append(f"✅ {payment_id}: ${amount}, {member_id}, {member_name} (NEW)")
                inserted.append(f"{payment_id}: ${amount}, {member_id}, {member_name}")
            else:
                sheets_payment = sheets_by_id[payment_id]
                sheets_updated = sheets_payment.get('ProcessedDate')

                if mysql_updated and sheets_updated:
                    mysql_ts = str(mysql_updated) if mysql_updated else ''
                    sheets_ts = str(sheets_updated) if sheets_updated else ''
                    if mysql_ts > sheets_ts:
                        rows_to_update.append(payment)
                        log_lines.append(f"🔄 {payment_id}: ${amount}, {member_id}, {member_name} (MySQL newer)")
                        updated.append(payment_id)
                elif mysql_updated:
                    rows_to_update.append(payment)
                    log_lines.append(f"🔄 {payment_id}: ${amount}, {member_id}, {member_name} (Sheets missing date)")
                    updated.append(payment_id)

            if (idx + 1) % 100 == 0:
                job_update = {'progress': 25 + int((idx / len(payments_rows)) * 50)}
                with _sync_jobs_lock:
                    _sync_jobs[job_id].update(job_update)

        # Push to Sheets
        if rows_to_append:
            try:
                _call_gas_webhook({'action': 'append_payments', 'rows': _serialize_rows(rows_to_append)})
                log_lines.append(f"📤 Appended {len(rows_to_append)} new payments")
            except Exception as e:
                log_lines.append(f"❌ Failed to append payments: {e}")
                errors.append(f"append_payments: {e}")

        if rows_to_update:
            try:
                _call_gas_webhook({'action': 'update_payments', 'rows': _serialize_rows(rows_to_update)})
                log_lines.append(f"📤 Updated {len(rows_to_update)} payments")
            except Exception as e:
                log_lines.append(f"❌ Failed to update payments: {e}")
                errors.append(f"update_payments: {e}")

        summary = f"✅ Payments Sync: {len(inserted)} inserted, {len(updated)} updated, {len(errors)} errors"

        job_update = {
            'status': 'done',
            'message': summary,
            'progress': 100,
            'result': {
                'operation': 'payments_to_sheets',
                'inserted': len(inserted),
                'updated': len(updated),
                'errors': len(errors),
                'log': '\n'.join(log_lines),
            }
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Send report email
        _send_sync_report(
            recipient='admin@mmrunners.org',
            operation='MySQL → Google: Payments',
            summary=summary,
            details=inserted[:50],
            log_content='\n'.join(log_lines),
        )

    except Exception as e:
        logger.error(f"Payments sync error: {e}\n{traceback.format_exc()}")
        error_msg = f"❌ Payments sync failed: {e}"
        job_update = {
            'status': 'error',
            'message': error_msg,
            'result': {'error': str(e), 'log': '\n'.join(log_lines)}
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Send error report email
        try:
            _send_sync_report(
                recipient='admin@mmrunners.org',
                operation='MySQL → Google: Payments',
                summary=error_msg,
                details=[],
                log_content='\n'.join(log_lines),
            )
        except Exception as email_err:
            logger.error(f"Failed to send error email: {email_err}")


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

        # Fetch transactions from Google Sheets
        try:
            sheets_data = _call_gas_webhook({'action': 'get_transactions'})
            sheets_txns = sheets_data if isinstance(sheets_data, list) else []
            log_lines.append(f"📥 Fetched {len(sheets_txns)} transactions from Google Sheets")
        except Exception as e:
            log_lines.append(f"❌ Failed to fetch from Sheets: {e}")
            raise

        # Get existing MessageIds from MySQL
        existing_txns = query("SELECT MessageId, Notes FROM gmail_transactions")
        existing_ids = {t['MessageId']: t['Notes'] for t in existing_txns}
        log_lines.append(f"📥 Found {len(existing_ids)} existing transactions in MySQL")

        job_update = {'status': 'running', 'message': 'Processing transactions...', 'progress': 25}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Process each transaction
        for idx, txn in enumerate(sheets_txns):
            message_id = txn.get('MessageId')
            memo = txn.get('Memo', '')
            processed_time = txn.get('ProcessedTime')
            webapp_id = txn.get('WebAppID', '')

            if not message_id:
                log_lines.append(f"⚠️  Skipping row {idx}: missing MessageId")
                continue

            if message_id not in existing_ids:
                # New transaction — insert
                try:
                    execute("""
                        INSERT INTO gmail_transactions
                        (MessageId, Memo, Notes, ProcessedTime, WebAppID)
                        VALUES (%s, %s, %s, %s, %s)
                    """, [message_id, memo, '', processed_time, webapp_id])
                    inserted.append(message_id)
                    log_lines.append(f"✅ {message_id}: inserted (new)")
                except Exception as e:
                    errors.append(f"{message_id}: {e}")
                    log_lines.append(f"❌ {message_id}: {e}")
            else:
                # Existing transaction — check if Memo differs from Notes
                existing_notes = existing_ids[message_id]
                if memo and memo != existing_notes:
                    try:
                        execute(
                            "UPDATE gmail_transactions SET Notes = %s WHERE MessageId = %s",
                            [memo, message_id]
                        )
                        updated.append(message_id)
                        log_lines.append(f"🔄 {message_id}: updated Notes")
                    except Exception as e:
                        errors.append(f"{message_id}: {e}")
                        log_lines.append(f"❌ {message_id}: {e}")
                else:
                    log_lines.append(f"⊘ {message_id}: skipped (Memo matches Notes)")

            if (idx + 1) % 100 == 0:
                job_update = {'progress': 25 + int((idx / len(sheets_txns)) * 50)}
                with _sync_jobs_lock:
                    _sync_jobs[job_id].update(job_update)

        summary = f"✅ Import Complete: {len(inserted)} inserted, {len(updated)} updated, {len(errors)} errors"

        job_update = {
            'status': 'done',
            'message': summary,
            'progress': 100,
            'result': {
                'operation': 'import_transactions',
                'inserted': len(inserted),
                'updated': len(updated),
                'errors': len(errors),
                'log': '\n'.join(log_lines),
            }
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Send report email
        _send_sync_report(
            recipient='admin@mmrunners.org',
            operation='Import Transactions from Google',
            summary=summary,
            details=inserted[:50],
            log_content='\n'.join(log_lines),
        )

    except Exception as e:
        logger.error(f"Transaction import error: {e}\n{traceback.format_exc()}")
        error_msg = f"❌ Import failed: {e}"
        job_update = {
            'status': 'error',
            'message': error_msg,
            'result': {'error': str(e), 'log': '\n'.join(log_lines)}
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Send error report email
        try:
            _send_sync_report(
                recipient='admin@mmrunners.org',
                operation='Import Transactions from Google',
                summary=error_msg,
                details=[],
                log_content='\n'.join(log_lines),
            )
        except Exception as email_err:
            logger.error(f"Failed to send error email: {email_err}")


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
        job_update = {'status': 'running', 'message': 'Fetching data for comparison...', 'progress': 0}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        log_lines.append("🔍 Dry-run: Google → MySQL (no changes made)")

        # Fetch all data from Sheets
        try:
            sheets_members_data = _call_gas_webhook({'action': 'get_members'})
            sheets_members = sheets_members_data if isinstance(sheets_members_data, list) else []
            sheets_member_ids = {m.get('MemberID') for m in sheets_members if 'MemberID' in m}
            log_lines.append(f"📊 Sheets: {len(sheets_member_ids)} members")
        except Exception as e:
            log_lines.append(f"⚠️  Could not fetch members from Sheets: {e}")
            sheets_member_ids = set()

        try:
            sheets_events_data = _call_gas_webhook({'action': 'get_events'})
            sheets_events = sheets_events_data if isinstance(sheets_events_data, list) else []
            sheets_event_ids = {e.get('EventID') for e in sheets_events if 'EventID' in e}
            log_lines.append(f"📊 Sheets: {len(sheets_event_ids)} events")
        except Exception as e:
            log_lines.append(f"⚠️  Could not fetch events from Sheets: {e}")
            sheets_event_ids = set()

        try:
            sheets_payments_data = _call_gas_webhook({'action': 'get_payments'})
            sheets_payments = sheets_payments_data if isinstance(sheets_payments_data, list) else []
            sheets_payment_ids = {p.get('PaymentID') for p in sheets_payments if 'PaymentID' in p}
            log_lines.append(f"📊 Sheets: {len(sheets_payment_ids)} payments")
        except Exception as e:
            log_lines.append(f"⚠️  Could not fetch payments from Sheets: {e}")
            sheets_payment_ids = set()

        job_update = {'status': 'running', 'message': 'Comparing with MySQL...', 'progress': 40}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Fetch from MySQL
        mysql_members = query("SELECT MemberID FROM members")
        mysql_member_ids = {m['MemberID'] for m in mysql_members}
        log_lines.append(f"💾 MySQL: {len(mysql_member_ids)} members")

        mysql_events = query("SELECT EventID FROM webapp_events")
        mysql_event_ids = {e['EventID'] for e in mysql_events}
        log_lines.append(f"💾 MySQL: {len(mysql_event_ids)} events")

        mysql_payments = query("SELECT PaymentID FROM payments")
        mysql_payment_ids = {p['PaymentID'] for p in mysql_payments}
        log_lines.append(f"💾 MySQL: {len(mysql_payment_ids)} payments")

        job_update = {'status': 'running', 'message': 'Analyzing differences...', 'progress': 70}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        log_lines.append("\n--- MEMBER DIFFERENCES ---")
        only_in_sheets_m = sheets_member_ids - mysql_member_ids
        only_in_mysql_m = mysql_member_ids - sheets_member_ids

        if only_in_sheets_m:
            log_lines.append(f"📌 {len(only_in_sheets_m)} members in Sheets only (not in MySQL):")
            for mid in sorted(only_in_sheets_m)[:20]:
                log_lines.append(f"   • {mid}")
            if len(only_in_sheets_m) > 20:
                log_lines.append(f"   ... and {len(only_in_sheets_m) - 20} more")
            diffs.append(f"Members: {len(only_in_sheets_m)} in Sheets only")

        if only_in_mysql_m:
            log_lines.append(f"📌 {len(only_in_mysql_m)} members in MySQL only (not in Sheets):")
            for mid in sorted(only_in_mysql_m)[:20]:
                log_lines.append(f"   • {mid}")
            if len(only_in_mysql_m) > 20:
                log_lines.append(f"   ... and {len(only_in_mysql_m) - 20} more")
            diffs.append(f"Members: {len(only_in_mysql_m)} in MySQL only")

        if not only_in_sheets_m and not only_in_mysql_m:
            log_lines.append("✅ Members: No differences")

        log_lines.append("\n--- EVENT DIFFERENCES ---")
        only_in_sheets_e = sheets_event_ids - mysql_event_ids
        only_in_mysql_e = mysql_event_ids - sheets_event_ids

        if only_in_sheets_e:
            log_lines.append(f"📌 {len(only_in_sheets_e)} events in Sheets only:")
            for eid in sorted(only_in_sheets_e)[:20]:
                log_lines.append(f"   • {eid}")
            if len(only_in_sheets_e) > 20:
                log_lines.append(f"   ... and {len(only_in_sheets_e) - 20} more")
            diffs.append(f"Events: {len(only_in_sheets_e)} in Sheets only")

        if only_in_mysql_e:
            log_lines.append(f"📌 {len(only_in_mysql_e)} events in MySQL only:")
            for eid in sorted(only_in_mysql_e)[:20]:
                log_lines.append(f"   • {eid}")
            if len(only_in_mysql_e) > 20:
                log_lines.append(f"   ... and {len(only_in_mysql_e) - 20} more")
            diffs.append(f"Events: {len(only_in_mysql_e)} in MySQL only")

        if not only_in_sheets_e and not only_in_mysql_e:
            log_lines.append("✅ Events: No differences")

        log_lines.append("\n--- PAYMENT DIFFERENCES ---")
        only_in_sheets_p = sheets_payment_ids - mysql_payment_ids
        only_in_mysql_p = mysql_payment_ids - sheets_payment_ids

        if only_in_sheets_p:
            log_lines.append(f"📌 {len(only_in_sheets_p)} payments in Sheets only:")
            for pid in sorted(only_in_sheets_p)[:20]:
                log_lines.append(f"   • {pid}")
            if len(only_in_sheets_p) > 20:
                log_lines.append(f"   ... and {len(only_in_sheets_p) - 20} more")
            diffs.append(f"Payments: {len(only_in_sheets_p)} in Sheets only")

        if only_in_mysql_p:
            log_lines.append(f"📌 {len(only_in_mysql_p)} payments in MySQL only:")
            for pid in sorted(only_in_mysql_p)[:20]:
                log_lines.append(f"   • {pid}")
            if len(only_in_mysql_p) > 20:
                log_lines.append(f"   ... and {len(only_in_mysql_p) - 20} more")
            diffs.append(f"Payments: {len(only_in_mysql_p)} in MySQL only")

        if not only_in_sheets_p and not only_in_mysql_p:
            log_lines.append("✅ Payments: No differences")

        diff_count = len(diffs)
        summary = f"✅ Dry-run complete: {diff_count} difference(s) detected (no changes made)"

        job_update = {
            'status': 'done',
            'message': summary,
            'progress': 100,
            'result': {
                'operation': 'dry_run_google_to_mysql',
                'differences': diffs,
                'difference_count': diff_count,
                'log': '\n'.join(log_lines),
            }
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Send report email
        _send_sync_report(
            recipient='admin@mmrunners.org',
            operation='Google → MySQL Dry-Run',
            summary=summary + ' (NO CHANGES MADE)',
            details=diffs,
            log_content='\n'.join(log_lines),
        )

    except Exception as e:
        logger.error(f"Dry-run error: {e}\n{traceback.format_exc()}")
        error_msg = f"❌ Dry-run failed: {e}"
        job_update = {
            'status': 'error',
            'message': error_msg,
            'result': {'error': str(e), 'log': '\n'.join(log_lines)}
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Send error report email
        try:
            _send_sync_report(
                recipient='admin@mmrunners.org',
                operation='Google → MySQL: Dry Run',
                summary=error_msg,
                details=[],
                log_content='\n'.join(log_lines),
            )
        except Exception as email_err:
            logger.error(f"Failed to send error email: {email_err}")


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
