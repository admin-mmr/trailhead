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
    Retries with exponential backoff on timeout.

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
    max_retries = 3
    timeout = 60  # Increased from 30 to 60 seconds

    for attempt in range(max_retries):
        try:
            resp = requests.post(webhook_url, json=payload, timeout=timeout)
            if resp.status_code != 200:
                raise Exception(f"HTTP {resp.status_code}: {resp.text[:500]}")

            body = resp.json()
            if not body.get('ok'):
                raise Exception(f"GAS error: {body.get('error', body)}")

            return body.get('data', {})
        except requests.exceptions.Timeout as e:
            if attempt < max_retries - 1:
                wait_time = 2 ** attempt  # 1s, 2s, 4s backoff
                logger.warning(f"GAS webhook timeout (attempt {attempt + 1}/{max_retries}). Retrying in {wait_time}s...")
                time.sleep(wait_time)
            else:
                logger.error(f"GAS webhook timed out after {max_retries} attempts: {e}")
                raise
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


def _parse_datetime(value: Any) -> Optional[datetime]:
    """Parse a datetime from various formats (ISO 8601, date string, or datetime object)."""
    if value is None:
        return None
    if isinstance(value, datetime):
        return value
    if isinstance(value, str):
        # Try ISO 8601 first (most common)
        for fmt in [
            '%Y-%m-%dT%H:%M:%S.%f',  # 2026-03-31T12:35:45.123456
            '%Y-%m-%dT%H:%M:%S',      # 2026-03-31T12:35:45
            '%Y-%m-%d %H:%M:%S',      # 2026-03-31 12:35:45
            '%Y-%m-%d',               # 2026-03-31
        ]:
            try:
                return datetime.strptime(value, fmt)
            except ValueError:
                continue
    return None


def _datetimes_equal(dt1: Any, dt2: Any) -> bool:
    """Compare two datetime values (handles different formats). Allows 1-second tolerance."""
    d1 = _parse_datetime(dt1)
    d2 = _parse_datetime(dt2)
    if d1 is None or d2 is None:
        return d1 is None and d2 is None
    return abs((d1 - d2).total_seconds()) < 1


def _get_field_diffs(mysql_row: Dict, sheets_row: Dict, exclude_fields: Optional[List[str]] = None) -> List[str]:
    """Compare two rows and return list of fields that differ."""
    if exclude_fields is None:
        exclude_fields = {'UpdatedAt', 'CreatedAt', 'id', '_sync_version'}

    diffs = []
    for field in mysql_row.keys():
        if field in exclude_fields or field not in sheets_row:
            continue

        mysql_val = mysql_row.get(field)
        sheets_val = sheets_row.get(field)

        # For datetime fields, use special comparison (handles format differences)
        if 'date' in field.lower() or 'time' in field.lower():
            if not _datetimes_equal(mysql_val, sheets_val):
                diffs.append(field)
        else:
            # For other fields, direct comparison (convert to string to handle types)
            if str(mysql_val) != str(sheets_val):
                diffs.append(field)

    return diffs


def _send_sync_report(
    recipient: str,
    operation: str,
    summary: str,
    details: List[str],
    log_content: str,
) -> Dict[str, Any]:
    """
    Send sync report email with comprehensive logging.

    Returns:
        Dict with email_sent (bool), email_log (str), error (str or None)
    """
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
    email_log_lines = []
    email_log_lines.append(f"📧 Sending sync report email...")
    email_log_lines.append(f"   To: {recipient}")
    email_log_lines.append(f"   Operation: {operation}")
    email_log_lines.append(f"   Subject: {title}")

    try:
        email_result = send_email(
            to=recipient,
            subject=title,
            html_content=body.replace('\n', '<br>'),
        )

        # Log email result
        if email_result.get('success'):
            email_log_lines.append(f"   ✅ {email_result.get('message', 'Email sent')}")
            email_log_lines.append(f"   Status: {email_result.get('status')}")
            logger.info(f"✅ Sync report email sent to {recipient}: {operation}")
            return {
                'email_sent': True,
                'email_log': '\n'.join(email_log_lines),
                'error': None
            }
        else:
            error = email_result.get('error', 'Unknown error')
            email_log_lines.append(f"   ❌ {email_result.get('message', f'Failed: {error}')}")
            logger.error(f"❌ Sync report email failed to {recipient}: {error}")
            return {
                'email_sent': False,
                'email_log': '\n'.join(email_log_lines),
                'error': error
            }

    except Exception as e:
        error_msg = str(e)
        email_log_lines.append(f"   ❌ Exception: {error_msg}")
        logger.error(f"Failed to send sync report to {recipient}: {error_msg}", exc_info=True)
        return {
            'email_sent': False,
            'email_log': '\n'.join(email_log_lines),
            'error': error_msg
        }


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
    Verbose mode shows first 3 members from each source for debugging.
    """
    log_lines = []
    inserted = []
    updated = []
    skipped = []
    errors = []
    verbose_mode = True  # Set to False to reduce verbosity

    try:
        job_update = {'status': 'running', 'message': 'Fetching members from MySQL...', 'progress': 0}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Fetch all members from MySQL
        members_rows = query("SELECT * FROM members ORDER BY MemberID")
        log_lines.append(f"📥 Fetched {len(members_rows)} members from MySQL")

        if verbose_mode and members_rows:
            # Show column names
            columns = list(members_rows[0].keys())
            log_lines.append(f"   Columns ({len(columns)}): {', '.join(columns[:10])}{'...' if len(columns) > 10 else ''}")
            # Show first 3 rows
            for i, member in enumerate(members_rows[:3]):
                name = f"{member.get('FirstName', '')} {member.get('LastName', '')}".strip()
                updated_at = member.get('LastUpdated', 'NULL')
                log_lines.append(f"   [Row {i+1}] {member['MemberID']}: {name}, LastUpdated={updated_at}")

        # Fetch members from Google Sheets
        try:
            sheets_data = _call_gas_webhook({'action': 'get_members'})
            sheets_members = sheets_data if isinstance(sheets_data, list) else []
            sheets_by_id = {m['MemberID']: m for m in sheets_members if 'MemberID' in m}
            log_lines.append(f"📊 Fetched {len(sheets_by_id)} members from Google Sheets")

            if verbose_mode and sheets_members:
                columns = list(sheets_members[0].keys())
                log_lines.append(f"   Columns ({len(columns)}): {', '.join(columns[:10])}{'...' if len(columns) > 10 else ''}")
                for i, member in enumerate(sheets_members[:3]):
                    name = f"{member.get('FirstName', '')} {member.get('LastName', '')}".strip()
                    updated_at = member.get('LastUpdated', 'NULL')
                    log_lines.append(f"   [Row {i+1}] {member.get('MemberID', 'N/A')}: {name}, LastUpdated={updated_at}")
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
            member_name = f"{member.get('FirstName', '')} {member.get('LastName', '')}".strip()

            if member_id not in sheets_by_id:
                # New member — append to Sheets
                rows_to_append.append(member)
                log_lines.append(f"✅ {member_id}: {member_name} (NEW)")
                inserted.append(member_id)

                if verbose_mode and idx < 3:
                    log_lines.append(f"   → LastUpdated={mysql_updated}")
            else:
                # Existing member — check versioning
                sheets_member = sheets_by_id[member_id]
                sheets_updated = sheets_member.get('LastUpdated')

                reason = None
                should_update = False

                # Compare timestamps (using proper datetime parsing)
                mysql_dt = _parse_datetime(mysql_updated)
                sheets_dt = _parse_datetime(sheets_updated)

                if mysql_dt and sheets_dt:
                    if mysql_dt > sheets_dt:
                        should_update = True
                        reason = f"MySQL newer: {mysql_dt} > {sheets_dt}"
                elif mysql_dt and not sheets_dt:
                    should_update = True
                    reason = "Sheets missing LastUpdated"
                else:
                    reason = f"Sheets newer or equal"

                if should_update:
                    rows_to_update.append(member)
                    log_lines.append(f"🔄 {member_id}: {member_name} ({reason})")
                    updated.append(member_id)
                else:
                    skipped.append(member_id)
                    log_lines.append(f"⊘ {member_id}: skipped ({reason})")

            if (idx + 1) % 50 == 0:
                job_update = {'progress': 25 + int((idx / len(members_rows)) * 50)}
                with _sync_jobs_lock:
                    _sync_jobs[job_id].update(job_update)

        # Push changes to Sheets (batched to avoid timeout)
        batch_size = 200

        if rows_to_append:
            for batch_idx in range(0, len(rows_to_append), batch_size):
                batch = rows_to_append[batch_idx:batch_idx + batch_size]
                batch_num = (batch_idx // batch_size) + 1
                total_batches = (len(rows_to_append) + batch_size - 1) // batch_size
                try:
                    _call_gas_webhook({'action': 'append_members', 'rows': _serialize_rows(batch)})
                    log_lines.append(f"📤 Appended batch {batch_num}/{total_batches}: {len(batch)} new members to Sheets")
                except Exception as e:
                    error_msg = f"append_members batch {batch_num}: {e}"
                    log_lines.append(f"❌ {error_msg}")
                    errors.append(error_msg)

        if rows_to_update:
            for batch_idx in range(0, len(rows_to_update), batch_size):
                batch = rows_to_update[batch_idx:batch_idx + batch_size]
                batch_num = (batch_idx // batch_size) + 1
                total_batches = (len(rows_to_update) + batch_size - 1) // batch_size
                try:
                    _call_gas_webhook({'action': 'update_members', 'rows': _serialize_rows(batch)})
                    log_lines.append(f"📤 Updated batch {batch_num}/{total_batches}: {len(batch)} members in Sheets")
                except Exception as e:
                    error_msg = f"update_members batch {batch_num}: {e}"
                    log_lines.append(f"❌ {error_msg}")
                    errors.append(error_msg)

        summary = f"✅ Members Sync Complete: {len(inserted)} inserted, {len(updated)} updated, {len(skipped)} skipped, {len(errors)} errors"
        log_lines.insert(0, summary)

        job_update = {
            'status': 'done',
            'message': summary,
            'progress': 100,
            'result': {
                'operation': 'members_to_sheets',
                'inserted': len(inserted),
                'updated': len(updated),
                'skipped': len(skipped),
                'errors': len(errors),
                'total_processed': len(members_rows),
                'inserted_list': inserted[:100],
                'updated_list': updated[:100],
                'error_list': errors[:50],
                'log': '\n'.join(log_lines),
            }
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Send report email
        email_result = _send_sync_report(
            recipient='admin@mmrunners.org',
            operation='MySQL → Google: Members',
            summary=summary,
            details=inserted[:100],
            log_content='\n'.join(log_lines),
        )
        if email_result.get('email_log'):
            log_lines.append(email_result['email_log'])
        if not email_result.get('email_sent'):
            log_lines.append(f"⚠️  Email failed: {email_result.get('error', 'Unknown error')}")

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
            email_result = _send_sync_report(
                recipient='admin@mmrunners.org',
                operation='MySQL → Google: Members',
                summary=error_msg,
                details=[],
                log_content='\n'.join(log_lines),
            )
            if email_result.get('email_log'):
                log_lines.append(email_result['email_log'])
        except Exception as email_err:
            log_lines.append(f"⚠️  Failed to send error email: {email_err}")
            logger.error(f"Failed to send error email: {email_err}")
        except Exception as email_err:
            logger.error(f"Failed to send error email: {email_err}")


def _sync_events_to_sheets(job_id: str):
    """Compare webapp_events by EventID with smart versioning.

    Verbose mode shows first 3 events from each source for debugging.
    """
    log_lines = []
    inserted = []
    updated = []
    skipped = []
    errors = []
    verbose_mode = True  # Set to False to reduce verbosity

    try:
        job_update = {'status': 'running', 'message': 'Fetching events...', 'progress': 0}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        events_rows = query(
            "SELECT * FROM webapp_events ORDER BY EventID"
        )
        log_lines.append(f"📥 Fetched {len(events_rows)} events from MySQL")

        if verbose_mode and events_rows:
            columns = list(events_rows[0].keys())
            log_lines.append(f"   Columns ({len(columns)}): {', '.join(columns[:10])}{'...' if len(columns) > 10 else ''}")
            for i, event in enumerate(events_rows[:3]):
                event_name = event.get('EventName', 'N/A')
                updated_at = event.get('UpdatedAt', 'NULL')
                log_lines.append(f"   [Row {i+1}] {event['EventID']}: {event_name}, UpdatedAt={updated_at}")

        # Fetch from Sheets
        try:
            sheets_data = _call_gas_webhook({'action': 'get_events'})
            sheets_events = sheets_data if isinstance(sheets_data, list) else []
            sheets_by_id = {e.get('EventID'): e for e in sheets_events if 'EventID' in e}
            log_lines.append(f"📊 Fetched {len(sheets_by_id)} events from Google Sheets")

            if verbose_mode and sheets_events:
                columns = list(sheets_events[0].keys())
                log_lines.append(f"   Columns ({len(columns)}): {', '.join(columns[:10])}{'...' if len(columns) > 10 else ''}")
                for i, event in enumerate(sheets_events[:3]):
                    event_name = event.get('EventName', 'N/A')
                    updated_at = event.get('UpdatedAt', 'NULL')
                    log_lines.append(f"   [Row {i+1}] {event.get('EventID', 'N/A')}: {event_name}, UpdatedAt={updated_at}")
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
            event_name = event.get('EventName', '')
            mysql_updated = event.get('UpdatedAt')

            if event_id not in sheets_by_id:
                rows_to_append.append(event)
                log_lines.append(f"✅ {event_id}: {event_name} (NEW)")
                inserted.append(event_id)

                if verbose_mode and idx < 3:
                    log_lines.append(f"   → UpdatedAt={mysql_updated}")
            else:
                sheets_event = sheets_by_id[event_id]
                sheets_updated = sheets_event.get('UpdatedAt')

                # Use proper datetime comparison that handles different formats
                mysql_dt = _parse_datetime(mysql_updated)
                sheets_dt = _parse_datetime(sheets_updated)

                should_update = False
                diff_fields = []
                reason = None

                if mysql_dt and sheets_dt:
                    # Both have timestamps: compare them
                    if mysql_dt > sheets_dt:
                        should_update = True
                        # Get specific fields that differ
                        diff_fields = _get_field_diffs(event, sheets_event)
                        reason = f"MySQL newer: {mysql_dt} > {sheets_dt}, fields: {', '.join(diff_fields)}"
                    else:
                        reason = f"Sheets newer or equal"
                elif mysql_dt and not sheets_dt:
                    # MySQL has timestamp but Sheets doesn't
                    should_update = True
                    diff_fields = ['UpdatedAt (missing in Sheets)']
                    reason = "Sheets missing UpdatedAt"
                else:
                    reason = "Both missing UpdatedAt"

                if should_update:
                    rows_to_update.append(event)
                    diff_str = f" ({', '.join(diff_fields)})" if diff_fields else ""
                    log_lines.append(f"🔄 {event_id}: {event_name}{diff_str}")
                    updated.append(event_id)
                else:
                    skipped.append(event_id)
                    log_lines.append(f"⊘ {event_id}: skipped ({reason})")

            if (idx + 1) % 50 == 0:
                job_update = {'progress': 25 + int((idx / len(events_rows)) * 50)}
                with _sync_jobs_lock:
                    _sync_jobs[job_id].update(job_update)

        # Push to Sheets (batched to avoid timeout)
        batch_size = 200

        if rows_to_append:
            for batch_idx in range(0, len(rows_to_append), batch_size):
                batch = rows_to_append[batch_idx:batch_idx + batch_size]
                batch_num = (batch_idx // batch_size) + 1
                total_batches = (len(rows_to_append) + batch_size - 1) // batch_size
                try:
                    _call_gas_webhook({'action': 'append_events', 'rows': _serialize_rows(batch)})
                    log_lines.append(f"📤 Appended batch {batch_num}/{total_batches}: {len(batch)} new events")
                except Exception as e:
                    error_msg = f"append_events batch {batch_num}: {e}"
                    log_lines.append(f"❌ {error_msg}")
                    errors.append(error_msg)

        if rows_to_update:
            for batch_idx in range(0, len(rows_to_update), batch_size):
                batch = rows_to_update[batch_idx:batch_idx + batch_size]
                batch_num = (batch_idx // batch_size) + 1
                total_batches = (len(rows_to_update) + batch_size - 1) // batch_size
                try:
                    _call_gas_webhook({'action': 'update_events', 'rows': _serialize_rows(batch)})
                    log_lines.append(f"📤 Updated batch {batch_num}/{total_batches}: {len(batch)} events")
                except Exception as e:
                    error_msg = f"update_events batch {batch_num}: {e}"
                    log_lines.append(f"❌ {error_msg}")
                    errors.append(error_msg)

        summary = f"✅ Events Sync: {len(inserted)} inserted, {len(updated)} updated, {len(skipped)} skipped, {len(errors)} errors"

        job_update = {
            'status': 'done',
            'message': summary,
            'progress': 100,
            'result': {
                'operation': 'events_to_sheets',
                'inserted': len(inserted),
                'updated': len(updated),
                'skipped': len(skipped),
                'errors': len(errors),
                'total_processed': len(events_rows),
                'inserted_list': inserted[:100],
                'updated_list': updated[:100],
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

        # Push to Sheets (batched to avoid timeout)
        batch_size = 200

        if rows_to_append:
            for batch_idx in range(0, len(rows_to_append), batch_size):
                batch = rows_to_append[batch_idx:batch_idx + batch_size]
                batch_num = (batch_idx // batch_size) + 1
                total_batches = (len(rows_to_append) + batch_size - 1) // batch_size
                try:
                    _call_gas_webhook({'action': 'append_payments', 'rows': _serialize_rows(batch)})
                    log_lines.append(f"📤 Appended batch {batch_num}/{total_batches}: {len(batch)} new payments")
                except Exception as e:
                    error_msg = f"append_payments batch {batch_num}: {e}"
                    log_lines.append(f"❌ {error_msg}")
                    errors.append(error_msg)

        if rows_to_update:
            for batch_idx in range(0, len(rows_to_update), batch_size):
                batch = rows_to_update[batch_idx:batch_idx + batch_size]
                batch_num = (batch_idx // batch_size) + 1
                total_batches = (len(rows_to_update) + batch_size - 1) // batch_size
                try:
                    _call_gas_webhook({'action': 'update_payments', 'rows': _serialize_rows(batch)})
                    log_lines.append(f"📤 Updated batch {batch_num}/{total_batches}: {len(batch)} payments")
                except Exception as e:
                    error_msg = f"update_payments batch {batch_num}: {e}"
                    log_lines.append(f"❌ {error_msg}")
                    errors.append(error_msg)

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
# MySQL → Google: Gmail Transactions
# ═══════════════════════════════════════════════════════════════════════════

def _sync_gmail_transactions_to_sheets(job_id: str):
    """
    Sync gmail_transactions Notes and ProcessedTime from MySQL to Google Sheets.

    Logic:
      - Fetch all gmail_transactions from MySQL
      - Compare against Google Sheets by MessageId
      - If MessageId not in Sheets → skip (not inserted in this sync)
      - If exists and MySQL Notes/ProcessedTime differ → update in Sheets
    """
    log_lines = []
    updated = []
    errors = []

    try:
        job_update = {'status': 'running', 'message': 'Fetching gmail_transactions from MySQL...', 'progress': 0}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Fetch all gmail_transactions from MySQL
        txn_rows = query("SELECT MessageId, Notes, ProcessedTime FROM gmail_transactions ORDER BY TimeStamp DESC")
        log_lines.append(f"📥 Fetched {len(txn_rows)} gmail_transactions from MySQL")

        # Fetch gmail_transactions from Google Sheets
        try:
            sheets_data = _call_gas_webhook({'action': 'get_gmail_transactions'})
            sheets_txns = sheets_data if isinstance(sheets_data, list) else []
            sheets_by_id = {t['MessageId']: t for t in sheets_txns if 'MessageId' in t}
            log_lines.append(f"📊 Fetched {len(sheets_by_id)} gmail_transactions from Google Sheets")
        except Exception as e:
            log_lines.append(f"⚠️  Could not fetch from Sheets: {e}")
            sheets_by_id = {}

        job_update = {
            'status': 'running',
            'message': f'Syncing Notes/ProcessedTime for {len(txn_rows)} transactions...',
            'progress': 50,
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Compare and build update list
        rows_to_update = []
        for txn in txn_rows:
            msg_id = txn['MessageId']
            if msg_id not in sheets_by_id:
                continue  # Skip if not in Sheets

            sheet_row = sheets_by_id[msg_id]
            needs_update = False

            # Check if Notes differ
            mysql_notes = txn.get('Notes', '')
            sheet_notes = sheet_row.get('Notes', '')
            if mysql_notes != sheet_notes:
                needs_update = True

            # Check if ProcessedTime differs
            mysql_processed = txn.get('ProcessedTime')
            sheet_processed = sheet_row.get('ProcessedTime')
            mysql_processed_str = mysql_processed.isoformat() if mysql_processed else ''
            sheet_processed_str = sheet_processed if isinstance(sheet_processed, str) else (sheet_processed.isoformat() if sheet_processed else '')

            if mysql_processed_str != sheet_processed_str:
                needs_update = True

            if needs_update:
                rows_to_update.append({
                    'MessageId': msg_id,
                    'Notes': mysql_notes or '',
                    'ProcessedTime': mysql_processed_str if mysql_processed else '',
                })

        log_lines.append(f"🔄 Found {len(rows_to_update)} transactions to update in Sheets")

        # Call GAS webhook to update Sheets (batched to avoid timeout)
        if rows_to_update:
            batch_size = 200  # Update 200 rows per webhook call
            total_updated = 0

            for batch_idx in range(0, len(rows_to_update), batch_size):
                batch = rows_to_update[batch_idx:batch_idx + batch_size]
                batch_num = (batch_idx // batch_size) + 1
                total_batches = (len(rows_to_update) + batch_size - 1) // batch_size

                try:
                    update_result = _call_gas_webhook({
                        'action': 'update_gmail_transactions',
                        'rows': batch,
                    })
                    total_updated += len(batch)
                    log_lines.append(f"✅ Batch {batch_num}/{total_batches}: Updated {len(batch)} transactions")

                    # Update progress
                    progress = 50 + int((batch_idx / len(rows_to_update)) * 50)
                    job_update = {
                        'status': 'running',
                        'message': f'Updating batch {batch_num}/{total_batches} ({total_updated}/{len(rows_to_update)})...',
                        'progress': progress,
                    }
                    with _sync_jobs_lock:
                        _sync_jobs[job_id].update(job_update)
                except Exception as e:
                    error_msg = f"Batch {batch_num}/{total_batches} failed: {e}"
                    log_lines.append(f"❌ {error_msg}")
                    errors.append(error_msg)
                    # Continue with next batch instead of failing completely

            if total_updated > 0:
                log_lines.append(f"✅ Successfully updated {total_updated}/{len(rows_to_update)} transactions in Sheets")
                updated = rows_to_update[:total_updated]  # Track what was sent
            else:
                log_lines.append(f"❌ No batches completed successfully")

        # Final update
        job_update = {
            'status': 'completed',
            'message': 'Sync complete',
            'progress': 100,
            'result': {
                'updated': len(updated),
                'errors': len(errors),
                'summary': '\n'.join(log_lines),
            },
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Send report email
        summary = f"Updated: {len(updated)}"
        if errors:
            summary += f" | Errors: {len(errors)}"

        _send_sync_report(
            recipient='admin@mmrunners.org',
            operation='MySQL → Google: Gmail Transactions',
            summary=summary,
            details=updated[:10],  # Show first 10
            log_content='\n'.join(log_lines),
        )

    except Exception as e:
        error_msg = str(e)
        log_lines.append(f"❌ Sync failed: {error_msg}")
        logger.error(f"Gmail transactions sync error: {traceback.format_exc()}")

        job_update = {
            'status': 'error',
            'message': error_msg,
            'progress': 100,
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        try:
            _send_sync_report(
                recipient='admin@mmrunners.org',
                operation='MySQL → Google: Gmail Transactions',
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
    Fetch gmail_transactions from Google Sheets with verbose logging.

    For each row:
      - If MessageId not in MySQL → INSERT (new)
      - If exists: compare Memo vs Notes field → UPDATE if different
      - Log all data read from Google and MySQL for debugging

    Verbose output shows:
      1. All columns from Google Sheets for each row
      2. Comparison with existing MySQL row
      3. Specific field differences (if any)
      4. Reason for insert/update/skip decision
    """
    log_lines = []
    inserted = []
    updated = []
    skipped = []
    errors = []
    verbose_mode = True  # Set to False to reduce verbosity

    try:
        job_update = {'status': 'running', 'message': 'Fetching transactions from Google...', 'progress': 0}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Fetch transactions from Google Sheets
        try:
            sheets_data = _call_gas_webhook({'action': 'get_transactions'})
            sheets_txns = sheets_data if isinstance(sheets_data, list) else []
            log_lines.append(f"📥 Fetched {len(sheets_txns)} transactions from Google Sheets")

            if verbose_mode and sheets_txns:
                # Show column names and first row as example
                first_row = sheets_txns[0]
                log_lines.append(f"   Columns: {', '.join(first_row.keys())}")
        except Exception as e:
            log_lines.append(f"❌ Failed to fetch from Sheets: {e}")
            raise

        # Get existing transactions from MySQL
        existing_txns = query("SELECT MessageId, Memo, Notes, ProcessedTime, WebAppID, TimeStamp, SyncedAt FROM gmail_transactions")
        existing_by_id = {t['MessageId']: t for t in existing_txns}
        log_lines.append(f"📥 Found {len(existing_by_id)} existing transactions in MySQL")

        job_update = {'status': 'running', 'message': 'Processing transactions...', 'progress': 25}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Process each transaction
        for idx, txn in enumerate(sheets_txns):
            message_id = txn.get('MessageId')
            memo = txn.get('Memo', '')
            processed_time = txn.get('ProcessedTime')
            webapp_id = txn.get('WebAppID', '')

            if verbose_mode and idx < 5:
                # Log first 5 rows in detail to show what we're reading
                log_lines.append(f"   [Row {idx+1}] MessageId={message_id}, Memo={repr(memo)}, ProcessedTime={processed_time}, WebAppID={webapp_id}")

            if not message_id:
                log_lines.append(f"⚠️  Skipping row {idx}: missing MessageId")
                skipped.append((idx, "missing MessageId"))
                continue

            if message_id not in existing_by_id:
                # New transaction — insert
                try:
                    execute("""
                        INSERT INTO gmail_transactions
                        (MessageId, Memo, Notes, ProcessedTime, WebAppID)
                        VALUES (%s, %s, %s, %s, %s)
                    """, [message_id, memo, '', processed_time, webapp_id])
                    inserted.append(message_id)
                    log_lines.append(f"✅ {message_id}: INSERTED (new)")

                    if verbose_mode:
                        log_lines.append(f"   → Memo={repr(memo)}, ProcessedTime={processed_time}")
                except Exception as e:
                    errors.append(f"{message_id}: {e}")
                    log_lines.append(f"❌ {message_id}: INSERT failed — {e}")
            else:
                # Existing transaction — compare fields
                existing = existing_by_id[message_id]
                existing_notes = existing.get('Notes', '')

                reason = None
                should_update = False

                # Check if Memo differs from Notes
                if memo and memo != existing_notes:
                    should_update = True
                    reason = f"Memo changed: {repr(existing_notes)} → {repr(memo)}"
                elif not memo and existing_notes:
                    # Memo is empty but Notes has data — don't clear Notes
                    reason = f"Memo is empty, Notes={repr(existing_notes)} unchanged"
                elif not memo and not existing_notes:
                    reason = "Both Memo and Notes empty — no change"
                elif memo == existing_notes:
                    reason = f"Memo matches Notes: {repr(memo)}"

                if should_update:
                    try:
                        execute(
                            "UPDATE gmail_transactions SET Notes = %s WHERE MessageId = %s",
                            [memo, message_id]
                        )
                        updated.append(message_id)
                        log_lines.append(f"🔄 {message_id}: UPDATED — {reason}")
                    except Exception as e:
                        errors.append(f"{message_id}: {e}")
                        log_lines.append(f"❌ {message_id}: UPDATE failed — {e}")
                else:
                    skipped.append((message_id, reason))
                    log_lines.append(f"⊘ {message_id}: skipped — {reason}")

            if (idx + 1) % 100 == 0:
                job_update = {'progress': 25 + int((idx / len(sheets_txns)) * 50)}
                with _sync_jobs_lock:
                    _sync_jobs[job_id].update(job_update)

        summary = f"✅ Import Complete: {len(inserted)} inserted, {len(updated)} updated, {len(skipped)} skipped, {len(errors)} errors"

        job_update = {
            'status': 'done',
            'message': summary,
            'progress': 100,
            'result': {
                'operation': 'import_transactions',
                'inserted': len(inserted),
                'updated': len(updated),
                'skipped': len(skipped),
                'errors': len(errors),
                'total_processed': len(sheets_txns),
                'log': '\n'.join(log_lines),
                'inserted_ids': inserted[:100],  # First 100 for reference
                'updated_ids': updated[:100],
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


@sheets_sync_bp.route('/api/sync/mysql-to-google/gmail-transactions', methods=['POST'])
@login_required
def _sync_unprocessed_transactions_to_sheets(job_id: str):
    """
    Sync unprocessed transactions (ProcessedTime IS NULL) from MySQL to Google Sheets.

    Updates only: Notes, ProcessedTime, WebAppID.
    """
    log_lines = []
    updated = []
    errors = []

    try:
        job_update = {'status': 'running', 'message': 'Fetching unprocessed transactions...', 'progress': 0}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Fetch unprocessed transactions from MySQL
        unprocessed = query("""
            SELECT MessageId, Notes, ProcessedTime, WebAppID
            FROM gmail_transactions
            WHERE ProcessedTime IS NULL OR ProcessedTime = ''
            ORDER BY TimeStamp DESC
        """)
        log_lines.append(f"📥 Found {len(unprocessed)} unprocessed transactions in MySQL")

        # Fetch gmail_transactions from Google Sheets
        try:
            sheets_data = _call_gas_webhook({'action': 'get_gmail_transactions'})
            sheets_by_id = {t.get('MessageId'): t for t in (sheets_data if isinstance(sheets_data, list) else [])}
            log_lines.append(f"📊 Fetched {len(sheets_by_id)} transactions from Google Sheets")
        except Exception as e:
            log_lines.append(f"❌ Failed to fetch from Sheets: {e}")
            raise

        job_update = {'status': 'running', 'message': 'Syncing unprocessed transactions...', 'progress': 25}
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Update Sheets with unprocessed transactions
        updates = []
        for txn in unprocessed:
            message_id = txn['MessageId']
            if message_id in sheets_by_id:
                updates.append({
                    'MessageId': message_id,
                    'Notes': txn['Notes'] or '',
                    'ProcessedTime': txn['ProcessedTime'] or '',
                    'WebAppID': txn['WebAppID'] or '',
                })
                updated.append(message_id)
                log_lines.append(f"🔄 {message_id}: synced to Sheets")

        if updates:
            try:
                _call_gas_webhook({
                    'action': 'update_gmail_transactions',
                    'data': updates
                })
                log_lines.append(f"✅ Updated {len(updates)} transactions in Google Sheets")
            except Exception as e:
                errors.append(f"Batch update failed: {e}")
                log_lines.append(f"❌ Batch update failed: {e}")
                raise
        else:
            log_lines.append("ℹ️  No unprocessed transactions to sync")

        summary = f"✅ Sync Complete: {len(updated)} synced, {len(errors)} errors"
        job_update = {
            'status': 'done',
            'message': summary,
            'progress': 100,
            'result': {
                'operation': 'sync_unprocessed_transactions',
                'synced': len(updated),
                'errors': len(errors),
                'log': '\n'.join(log_lines),
            }
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Send report email
        _send_sync_report(
            recipient='admin@mmrunners.org',
            operation='Sync Unprocessed Transactions to Sheets',
            summary=summary,
            details=updated[:50],
            log_content='\n'.join(log_lines),
        )

    except Exception as e:
        logger.error(f"Unprocessed transaction sync error: {e}\n{traceback.format_exc()}")
        error_msg = f"❌ Sync failed: {e}"
        job_update = {
            'status': 'error',
            'message': error_msg,
            'result': {'error': str(e), 'log': '\n'.join(log_lines)}
        }
        with _sync_jobs_lock:
            _sync_jobs[job_id].update(job_update)

        # Send error report
        try:
            _send_sync_report(
                recipient='admin@mmrunners.org',
                operation='Sync Unprocessed Transactions to Sheets',
                summary=error_msg,
                details=[],
                log_content='\n'.join(log_lines),
            )
        except Exception as e2:
            logger.error(f"Failed to send error report: {e2}")


def api_sync_gmail_transactions():
    """Trigger gmail_transactions sync (MySQL → Google Sheets)."""
    job_id = _gen_job_id()

    with _sync_jobs_lock:
        _sync_jobs[job_id] = {
            'status': 'queued',
            'message': 'Queued',
            'progress': 0,
            'created_at': datetime.utcnow().isoformat(),
        }

    thread = threading.Thread(target=_sync_gmail_transactions_to_sheets, args=(job_id,), daemon=True)
    thread.start()

    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/unprocessed-transactions', methods=['POST'])
@login_required
def api_sync_unprocessed_transactions():
    """Trigger unprocessed transactions sync (MySQL → Google Sheets)."""
    job_id = _gen_job_id()

    with _sync_jobs_lock:
        _sync_jobs[job_id] = {
            'status': 'queued',
            'message': 'Queued',
            'progress': 0,
            'created_at': datetime.utcnow().isoformat(),
        }

    thread = threading.Thread(target=_sync_unprocessed_transactions_to_sheets, args=(job_id,), daemon=True)
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
