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
from webhook_client import send_generic_email
from auth import login_required
from config_cache import get_config as _get_config_cached
from sync_jobs import launch_job, update_job, get_job, list_jobs as list_sync_jobs

# ── Shared bidirectional sync engine (spec-compliant) ────────────────────────
from sync_engine import (
    parse_datetime      as _engine_parse_dt,
    to_mysql_datetime   as _engine_to_mysql_dt,
    resolve_conflict    as _engine_resolve_conflict,
    resolve_gmail_row   as _engine_resolve_gmail,
    filter_sync_columns as _engine_filter_cols,
    SyncDecision,
    SyncAudit,
    log_sync_error      as _engine_log_error,
    STANDARD_TABLES     as _STANDARD_TABLES,
)
# ─────────────────────────────────────────────────────────────────────────────

logger = logging.getLogger(__name__)
logger.setLevel(logging.DEBUG)

sheets_sync_bp = Blueprint('sheets_sync', __name__)


# ═══════════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════════

def _get_config_value(key: str, default: str = '') -> str:
    """Thin wrapper over config_cache.get_config for backward compat."""
    return _get_config_cached(key, default)


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
            logger.info(f"GAS webhook POST action={payload.get('action')} url={webhook_url[:60]}...")
            resp = requests.post(webhook_url, json=payload, timeout=timeout)
            logger.info(f"GAS webhook response: status={resp.status_code} len={len(resp.text)} content_type={resp.headers.get('Content-Type','?')}")
            logger.debug(f"GAS webhook body[:500]: {resp.text[:500]!r}")
            if resp.status_code != 200:
                raise Exception(f"HTTP {resp.status_code}: {resp.text[:500]}")
            if not resp.text.strip():
                raise Exception(f"GAS returned empty body (status 200) for action={payload.get('action')}")

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


def _convert_date_fields_to_iso_date(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Convert Expiration and PaymentDate from ISO8601 datetime format (YYYY-MM-DDTHH:MM:SS)
    to ISO date-only format (YYYY-MM-DD).

    This function operates on already-serialized rows (string values) and ensures that
    date fields are sent to GAS as date-only strings without time component.

    Args:
        rows: List of serialized row dicts with string values

    Returns:
        List of rows with Expiration and PaymentDate converted to date-only format
    """
    result = []
    for row in rows:
        new_row = row.copy()

        # Convert Expiration field
        if 'Expiration' in new_row:
            exp_val = new_row['Expiration']
            if exp_val and isinstance(exp_val, str):
                try:
                    # Handle both "2027-03-31T04:00:00" and "2027-03-31" formats
                    if 'T' in exp_val:
                        date_part = exp_val.split('T')[0]
                    else:
                        date_part = exp_val[:10]  # Take first 10 chars (YYYY-MM-DD)
                    new_row['Expiration'] = date_part
                except Exception as e:
                    logger.warning(f"Failed to convert Expiration '{exp_val}': {e}")

        # Convert PaymentDate field
        if 'PaymentDate' in new_row:
            pd_val = new_row['PaymentDate']
            if pd_val and isinstance(pd_val, str):
                try:
                    # Handle both "2027-03-31T04:00:00" and "2027-03-31" formats
                    if 'T' in pd_val:
                        date_part = pd_val.split('T')[0]
                    else:
                        date_part = pd_val[:10]  # Take first 10 chars (YYYY-MM-DD)
                    new_row['PaymentDate'] = date_part
                except Exception as e:
                    logger.warning(f"Failed to convert PaymentDate '{pd_val}': {e}")

        result.append(new_row)

    return result


def _normalize_gas_keys(row: Dict[str, Any]) -> Dict[str, Any]:
    """
    Convert camelCase keys from GAS webhook to PascalCase (MySQL column names).

    CRITICAL: GAS webhook returns TypeScript objects serialized as JSON with camelCase keys.
    MySQL schema uses PascalCase column names. This function maps all known camelCase keys
    to their PascalCase equivalents for all four tables (Members, Events, Payments, Transactions).

    Mappings:
      - Members: memberID→MemberID, firstName→FirstName, lastName→LastName, etc.
      - WebApp Events: eventID→EventID, eventType→EventType, memberID→MemberID, etc.
      - Payment History: paymentID→PaymentID, eventID→EventID, memberID→MemberID, etc.
      - Fetch Gmail: messageId→MessageId, transactionNumber→TransactionNumber, etc.
    """
    CASE_MAP = {
        # Members table
        'memberID': 'MemberID',
        'firstName': 'FirstName',
        'lastName': 'LastName',
        'familyID': 'FamilyID',
        'wechatID': 'WeChatID',
        'webApp': 'WebApp',
        'paymentCheck': 'PaymentCheck',
        'lastUpdated': 'LastUpdated',
        'membershipFeePaid': 'MembershipFeePaid',
        'paymentDate': 'PaymentDate',
        'paymentTransaction': 'PaymentTransaction',
        'joinYear': 'JoinYear',
        'phoneNumber': 'PhoneNumber',
        'lastLoginDate': 'LastLoginDate',
        'profileLastUpdated': 'ProfileLastUpdated',
        # WebApp Events table
        'eventID': 'EventID',
        'eventType': 'EventType',
        'expiresAt': 'ExpiresAt',
        'paymentIntent': 'PaymentIntent',
        'paymentMethod': 'PaymentMethod',
        'payerName': 'PayerName',
        'memoField': 'MemoField',
        'last4Digits': 'Last4Digits',
        'familyMemberEmails': 'FamilyMemberEmails',
        'matchedMessageId': 'MatchedMessageId',
        'matchedTransactionNumber': 'MatchedTransactionNumber',
        'adminApprover': 'AdminApprover',
        'approvalDate': 'ApprovalDate',
        'screenshotFileId': 'ScreenshotFileId',
        'gdriveFilePath': 'GDriveFilePath',
        'ocrText': 'OCRText',
        'ocrTimestamp': 'OCRTimestamp',
        # Payment History table
        'paymentID': 'PaymentID',
        'transactionReference': 'TransactionReference',
        'periodStart': 'PeriodStart',
        'periodEnd': 'PeriodEnd',
        'processedBy': 'ProcessedBy',
        'processedDate': 'ProcessedDate',
        # Fetch Gmail table (transactions)
        'messageId': 'MessageId',
        'transactionNumber': 'TransactionNumber',
        'transactionDate': 'TransactionDate',
        'originalMemo': 'OriginalMemo',
        'processedTime': 'ProcessedTime',
        'paymentID': 'PaymentID',
        # Common fields
        'timestamp': 'Timestamp',
        'created': 'Created',
        'sender': 'Sender',
        'amount': 'Amount',
        'memo': 'Memo',
        'subject': 'Subject',
        'notes': 'Notes',
        'source': 'Source',
    }

    normalized = {}
    for key, value in row.items():
        # Use mapped key if it exists, otherwise keep original
        normalized_key = CASE_MAP.get(key, key)
        normalized[normalized_key] = value

    return normalized


def _parse_datetime(value: Any) -> Optional[datetime]:
    """
    Parse any datetime to a naive UTC datetime.
    Delegates to sync_engine.parse_datetime — correctly applies GMT offsets
    (e.g. 'Tue Mar 31 2026 15:51:18 GMT-0400' → UTC 2026-03-31 19:51:18).
    """
    return _engine_parse_dt(value)


def _to_iso_datetime(value: Any) -> Optional[str]:
    """
    Convert any datetime to a MySQL-safe UTC string (YYYY-MM-DD HH:MM:SS).
    Delegates to sync_engine.to_mysql_datetime — correctly applies GMT offsets
    instead of discarding them (spec §4.2).
    """
    return _engine_to_mysql_dt(value)


def _coerce_value(v: Any, col: str, dt_cols: set, int_cols: set, decimal_cols: set = set()) -> Any:
    """
    Coerce a Google Sheets value to the correct MySQL type.
    - datetime/timestamp/date cols: delegate to _to_iso_datetime; '' → None
    - integer cols: '' or None → None; numeric strings → int
    - decimal/float cols: '' or None → None; numeric strings → float
    - everything else: pass through unchanged
    """
    if col in dt_cols:
        return _to_iso_datetime(v)
    if col in int_cols:
        if v is None or v == '':
            return None
        try:
            return int(float(str(v)))   # handles '2015', '2015.0'
        except (ValueError, TypeError):
            return None
    if col in decimal_cols:
        if v is None or v == '':
            return None
        try:
            return float(str(v))
        except (ValueError, TypeError):
            return None
    return v


# ---------------------------------------------------------------------------
# Member Status ENUM normalizer
# MySQL members.Status ENUM: ('active', 'not active', 'pending')
# Sheets/GAS may send: 'Active', 'inactive', 'Inactive', 'pending_upgrade', etc.
# ---------------------------------------------------------------------------
_MEMBER_STATUS_ENUM = {'active', 'not active', 'pending'}

_MEMBER_STATUS_MAP = {
    # exact MySQL values (pass-through)
    'active':         'active',
    'not active':     'not active',
    'pending':        'pending',
    # case variants
    'Active':         'active',
    'Not Active':     'not active',
    'Pending':        'pending',
    'ACTIVE':         'active',
    'NOT ACTIVE':     'not active',
    'PENDING':        'pending',
    # GAS / legacy labels that differ from MySQL ENUM
    'inactive':       'not active',
    'Inactive':       'not active',
    'INACTIVE':       'not active',
    'pending_upgrade': 'pending',
    'Pending_Upgrade': 'pending',
    'expired':        'not active',
    'Expired':        'not active',
    'EXPIRED':        'not active',
}


def _coerce_member_status(raw_value: Any) -> tuple:
    """
    Map a Sheets/GAS Status value to the MySQL ENUM value.
    Returns (mysql_value, warning_message_or_None).
    - If mappable: returns ('active'|'not active'|'pending', None)
    - If unmappable: returns (None, warning_string) — caller should skip the column
    """
    if raw_value is None or raw_value == '':
        return None, None  # caller keeps existing DB value (skip column in UPDATE)
    s = str(raw_value).strip()
    mapped = _MEMBER_STATUS_MAP.get(s)
    if mapped:
        changed = (mapped != s)
        msg = f"Status '{s}' → '{mapped}'" if changed else None
        return mapped, msg
    # Last-resort: lowercase match
    lower = s.lower()
    if lower in _MEMBER_STATUS_ENUM:
        return lower, f"Status '{s}' → '{lower}' (lowercased)"
    # Unknown — do not write a bad value; skip and warn
    return None, f"⚠️ Status '{s}' has no MySQL ENUM mapping ('active'|'not active'|'pending') — column skipped"


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
        email_result = send_generic_email(
            to=recipient,
            subject=title,
            html_content=body.replace('\n', '<br>'),
        )

        # Log email result
        if email_result:
            email_log_lines.append(f"   ✅ Email sent to {recipient}")
            email_log_lines.append(f"   Status: sent")
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
        update_job(job_id, **job_update)

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
            # Normalize camelCase to PascalCase
            sheets_members = [_normalize_gas_keys(row) for row in sheets_members]
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
        update_job(job_id, **job_update)

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
                log_lines.append(
                    f"✅ INSERT | {member_id} | {member_name} | "
                    f"LastUpdated={mysql_updated!r}"
                )
                inserted.append(member_id)
            else:
                # Existing member — spec §2.2 bidirectional newer-wins conflict resolution
                sheets_member = sheets_by_id[member_id]
                decision = _engine_resolve_conflict('members', member_id, member, sheets_member)

                if decision.direction == SyncDecision.NO_CHANGE:
                    skipped.append(member_id)
                    log_lines.append(f"= MATCH | {member_id}")
                elif decision.direction == SyncDecision.MYSQL_WINS:
                    # MySQL newer → push to Sheets; compute field diff for log
                    diff_fields = _get_field_diffs(member, sheets_member)
                    field_detail = ', '.join(
                        f"{f}: {sheets_member.get(f)!r} → {member.get(f)!r}"
                        for f in diff_fields if f != 'LastUpdated'
                    ) or '(timestamp only)'
                    rows_to_update.append(member)
                    log_lines.append(
                        f"🔄 UPDATE | {member_id} | {field_detail} | {decision.reason}"
                    )
                    updated.append(member_id)
                else:
                    # SHEETS_WINS (newer or tie) → check if there are actual field diffs
                    diff_fields = _get_field_diffs(member, sheets_member, exclude_fields=['LastUpdated'])
                    if not diff_fields:
                        # Tie with no field differences → silent match (don't log noise)
                        pass
                    else:
                        # Tie or Sheets newer with field diffs → log the conflict
                        log_lines.append(
                            f"⏭️ SKIP | {member_id} | Sheets wins ({decision.reason}) — has field diffs: {', '.join(diff_fields)}"
                        )
                    skipped.append(member_id)

            if (idx + 1) % 50 == 0:
                job_update = {'progress': 25 + int((idx / len(members_rows)) * 50)}
                update_job(job_id, **job_update)

        # Push changes to Sheets (batched to avoid timeout)
        batch_size = 200

        if rows_to_append:
            for batch_idx in range(0, len(rows_to_append), batch_size):
                batch = rows_to_append[batch_idx:batch_idx + batch_size]
                batch_num = (batch_idx // batch_size) + 1
                total_batches = (len(rows_to_append) + batch_size - 1) // batch_size
                try:
                    serialized = _serialize_rows(batch)
                    # Convert Expiration and PaymentDate to ISO date-only format (YYYY-MM-DD)
                    serialized = _convert_date_fields_to_iso_date(serialized)
                    _call_gas_webhook({'action': 'append_members', 'rows': serialized})
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
                    serialized = _serialize_rows(batch)
                    # Convert Expiration and PaymentDate to ISO date-only format (YYYY-MM-DD)
                    serialized = _convert_date_fields_to_iso_date(serialized)
                    _call_gas_webhook({'action': 'update_members', 'rows': serialized})
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
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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
            # Normalize camelCase to PascalCase
            sheets_events = [_normalize_gas_keys(row) for row in sheets_events]
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
        update_job(job_id, **job_update)

        rows_to_append = []
        rows_to_update = []

        for idx, event in enumerate(events_rows):
            event_id = event['EventID']
            event_name = event.get('EventName', '')
            mysql_updated = event.get('UpdatedAt')

            if event_id not in sheets_by_id:
                rows_to_append.append(event)
                log_lines.append(
                    f"✅ INSERT | {event_id} | {event_name} | "
                    f"UpdatedAt={mysql_updated!r}"
                )
                inserted.append(event_id)
            else:
                # Spec §2.2 bidirectional conflict resolution for webapp_events
                sheets_event = sheets_by_id[event_id]
                decision = _engine_resolve_conflict('webapp_events', event_id, event, sheets_event)

                if decision.direction == SyncDecision.NO_CHANGE:
                    skipped.append(event_id)
                    log_lines.append(f"= MATCH | {event_id}")
                elif decision.direction == SyncDecision.MYSQL_WINS:
                    diff_fields = _get_field_diffs(event, sheets_event)
                    field_detail = ' | '.join(
                        f"{f}: {str(sheets_event.get(f, ''))[:40]!r} → {str(event.get(f, ''))[:40]!r}"
                        for f in diff_fields if f != 'UpdatedAt'
                    ) or '(timestamp only)'
                    rows_to_update.append(event)
                    log_lines.append(
                        f"🔄 UPDATE | {event_id} | {field_detail} | {decision.reason}"
                    )
                    updated.append(event_id)
                else:
                    # SHEETS_WINS (newer or tie) → check if there are actual field diffs
                    diff_fields = _get_field_diffs(event, sheets_event, exclude_fields=['UpdatedAt'])
                    if not diff_fields:
                        # Tie with no field differences → silent match (don't log noise)
                        pass
                    else:
                        # Tie or Sheets newer with field diffs → log the conflict
                        log_lines.append(
                            f"⏭️ SKIP | {event_id} | Sheets wins ({decision.reason}) — has field diffs: {', '.join(diff_fields)}"
                        )
                    skipped.append(event_id)

            if (idx + 1) % 50 == 0:
                job_update = {'progress': 25 + int((idx / len(events_rows)) * 50)}
                update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

        payments_rows = query("SELECT * FROM payments ORDER BY PaymentID DESC LIMIT 500")
        log_lines.append(f"📥 Fetched {len(payments_rows)} recent payments from MySQL")

        # Fetch from Sheets
        try:
            sheets_data = _call_gas_webhook({'action': 'get_payments'})
            sheets_payments = sheets_data if isinstance(sheets_data, list) else []
            # Normalize camelCase to PascalCase
            sheets_payments = [_normalize_gas_keys(row) for row in sheets_payments]
            sheets_by_id = {p.get('PaymentID'): p for p in sheets_payments if 'PaymentID' in p}
            log_lines.append(f"📊 Fetched {len(sheets_by_id)} payments from Google Sheets")
        except Exception as e:
            log_lines.append(f"⚠️  Could not fetch from Sheets: {e}")
            sheets_by_id = {}

        job_update = {'status': 'running', 'message': 'Syncing payments...', 'progress': 25}
        update_job(job_id, **job_update)

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
                log_lines.append(
                    f"✅ INSERT | {payment_id} | MemberID={member_id} | "
                    f"ProcessedDate={payment.get('ProcessedDate', '?')!r}"
                )
                inserted.append(f"{payment_id}: ${amount}, {member_id}, {member_name}")
            else:
                # Spec §2.2 bidirectional conflict resolution for payments
                sheets_payment = sheets_by_id[payment_id]
                decision = _engine_resolve_conflict('payments', payment_id, payment, sheets_payment)

                if decision.direction == SyncDecision.MYSQL_WINS:
                    diff_fields = _get_field_diffs(payment, sheets_payment)
                    field_detail = ', '.join(
                        f"{f}: {sheets_payment.get(f)!r} → {payment.get(f)!r}"
                        for f in diff_fields if f != 'ProcessedDate'
                    ) or '(timestamp only)'
                    rows_to_update.append(payment)
                    log_lines.append(
                        f"🔄 UPDATE | {payment_id} | MemberID={member_id} | "
                        f"{field_detail} | {decision.reason}"
                    )
                    updated.append(payment_id)
                elif decision.direction == SyncDecision.SHEETS_WINS:
                    # Check if there are actual field diffs
                    diff_fields = _get_field_diffs(payment, sheets_payment, exclude_fields=['ProcessedDate'])
                    if not diff_fields:
                        # Tie with no field differences → silent match (don't log noise)
                        pass
                    else:
                        # Tie or Sheets newer with field diffs → log the conflict
                        log_lines.append(
                            f"⏭️ SKIP | {payment_id} | MemberID={member_id} | "
                            f"Sheets wins ({decision.reason}) — has field diffs: {', '.join(diff_fields)}"
                        )
                else:
                    # NO_CHANGE
                    log_lines.append(f"= MATCH | {payment_id} | MemberID={member_id}")

            if (idx + 1) % 100 == 0:
                job_update = {'progress': 25 + int((idx / len(payments_rows)) * 50)}
                update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

        # Fetch all gmail_transactions from MySQL
        txn_rows = query("SELECT MessageId, Notes, ProcessedTime FROM gmail_transactions ORDER BY TimeStamp DESC")
        log_lines.append(f"📥 Fetched {len(txn_rows)} gmail_transactions from MySQL")

        # Fetch gmail_transactions from Google Sheets
        try:
            sheets_data = _call_gas_webhook({'action': 'get_transactions'})
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
        update_job(job_id, **job_update)

        # Compare and build update list (spec §3.2 field-level rules via engine)
        rows_to_update = []
        for txn in txn_rows:
            msg_id = txn['MessageId']
            if msg_id not in sheets_by_id:
                continue  # spec §3.2: never create Sheets rows from MySQL

            sheet_row = sheets_by_id[msg_id]
            action = _engine_resolve_gmail(msg_id, txn, sheet_row)

            if action.has_sheets_updates:
                update_payload = {'MessageId': msg_id}
                update_payload.update(action.sheets_updates)
                rows_to_update.append(update_payload)

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
                    update_job(job_id, **job_update)
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
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

        # Fetch transactions from Google Sheets
        try:
            sheets_data = _call_gas_webhook({'action': 'get_transactions'})
            sheets_txns = sheets_data if isinstance(sheets_data, list) else []

            # CRITICAL: Normalize camelCase keys from GAS to PascalCase (MySQL column names)
            sheets_txns = [_normalize_gas_keys(row) for row in sheets_txns]

            log_lines.append(f"📥 Fetched {len(sheets_txns)} transactions from Google Sheets")

            if verbose_mode and sheets_txns:
                # Show column names and first 3 rows as examples
                first_row = sheets_txns[0]
                log_lines.append(f"   Columns: {', '.join(first_row.keys())}")
                log_lines.append(f"   📋 Example rows from Google Sheets (normalized):")
                for i, row in enumerate(sheets_txns[:3]):
                    # Print all fields with values
                    row_str = json.dumps({k: str(v)[:50] for k, v in row.items()}, indent=0)
                    log_lines.append(f"      [Row {i+1}]: {row_str}")
        except Exception as e:
            log_lines.append(f"❌ Failed to fetch from Sheets: {e}")
            raise

        # Get existing transactions from MySQL
        existing_txns = query("SELECT MessageId, Memo, Notes, ProcessedTime, PaymentID, TimeStamp, SyncedAt FROM gmail_transactions")
        existing_by_id = {t['MessageId']: t for t in existing_txns}
        log_lines.append(f"📥 Found {len(existing_by_id)} existing transactions in MySQL")

        job_update = {'status': 'running', 'message': 'Processing transactions...', 'progress': 25}
        update_job(job_id, **job_update)

        # Process each transaction
        for idx, txn in enumerate(sheets_txns):
            message_id = txn.get('MessageId')
            timestamp_raw = txn.get('Timestamp')  # REQUIRED: TimeStamp column is NOT NULL
            memo = txn.get('Memo', '')
            processed_time_raw = txn.get('ProcessedTime')
            payment_id = txn.get('PaymentID', '')
            sender = txn.get('Sender', '') or ''
            transaction_number = txn.get('TransactionNumber', '') or ''
            subject = txn.get('Subject', '') or ''
            original_memo = txn.get('OriginalMemo', '') or ''
            source = txn.get('Source', '') or ''

            # Coerce Amount to float or None
            amount_raw = txn.get('Amount', '')
            try:
                amount = float(amount_raw) if amount_raw not in ('', None) else None
            except (ValueError, TypeError):
                amount = None

            # Normalize TransactionDate — GAS sends JS Date.toString() e.g.
            # 'Tue Mar 31 2026 00:00:00 GMT-0400 (...)'; reuse _to_iso_datetime
            # then take the date portion only (YYYY-MM-DD).
            transaction_date_raw = txn.get('TransactionDate', '')
            if transaction_date_raw:
                _td_iso = _to_iso_datetime(transaction_date_raw)
                transaction_date = str(_td_iso)[:10] if _td_iso else None
            else:
                transaction_date = None

            # Normalize timestamps to MySQL-safe ISO format
            timestamp = _to_iso_datetime(timestamp_raw)
            processed_time = _to_iso_datetime(processed_time_raw) if processed_time_raw else None

            if verbose_mode and idx < 5:
                # Log first 5 rows in detail to show what we're reading
                log_lines.append(f"   [Row {idx+1}] MessageId={message_id}, Timestamp={timestamp} (from {repr(str(timestamp_raw)[:60])}), Sender={repr(sender)}, Amount={amount}, Memo={repr(memo)}, ProcessedTime={processed_time}")

            if not message_id:
                log_lines.append(f"⚠️  Skipping row {idx}: missing MessageId")
                skipped.append((idx, "missing MessageId"))
                continue

            if not timestamp:
                log_lines.append(f"⚠️  Skipping row {idx}: invalid/missing Timestamp (raw: {repr(str(timestamp_raw)[:60])})")
                skipped.append((idx, "invalid Timestamp"))
                continue

            if message_id not in existing_by_id:
                # New transaction — insert all fields from Sheets.
                # Notes=Memo so re-imports detect no change on the next run.
                try:
                    execute("""
                        INSERT INTO gmail_transactions
                        (MessageId, TimeStamp, Sender, Amount, Memo, TransactionDate,
                         TransactionNumber, Subject, OriginalMemo, Notes,
                         ProcessedTime, Source, PaymentID)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """, [
                        message_id, timestamp, sender, amount, memo, transaction_date,
                        transaction_number, subject, original_memo, memo,
                        processed_time, source, payment_id,
                    ])
                    inserted.append(message_id)
                    log_lines.append(f"✅ {message_id}: INSERTED (new)")

                    if verbose_mode:
                        log_lines.append(f"   → Sender={repr(sender)}, Amount={amount}, TransactionDate={transaction_date}, ProcessedTime={processed_time}")
                except Exception as e:
                    errors.append(f"{message_id}: {e}")
                    log_lines.append(f"❌ {message_id}: INSERT failed — {e}")
            else:
                # Existing transaction — spec §3.2 field-level rules via engine.
                existing = existing_by_id[message_id]
                sheets_row_for_engine = {
                    'Memo':          memo,
                    'ProcessedTime': processed_time,
                    'Notes':         existing.get('Notes', ''),
                    # Pass Sheets' PaymentID/Source so engine can sync them Sheets→MySQL
                    # when GAS has processed the row (Bug 3 fix).
                    'PaymentID':     payment_id or existing.get('PaymentID', ''),
                    'Source':        source or existing.get('Source', ''),
                }
                action = _engine_resolve_gmail(message_id, existing, sheets_row_for_engine)

                # Backfill: for rows inserted before this fix that are missing Amount/Sender/etc.
                backfill = {}
                if existing.get('Amount') in (None, '') and amount is not None:
                    backfill['Amount'] = amount
                if not existing.get('Sender') and sender:
                    backfill['Sender'] = sender
                if not existing.get('TransactionDate') and transaction_date:
                    backfill['TransactionDate'] = transaction_date
                if not existing.get('TransactionNumber') and transaction_number:
                    backfill['TransactionNumber'] = transaction_number
                if not existing.get('Subject') and subject:
                    backfill['Subject'] = subject
                if not existing.get('OriginalMemo') and original_memo:
                    backfill['OriginalMemo'] = original_memo
                if not existing.get('Source') and source:
                    backfill['Source'] = source
                if backfill:
                    action.mysql_updates.update(backfill)

                if action.has_mysql_updates:
                    set_clauses = ', '.join(f"{k} = %s" for k in action.mysql_updates)
                    params = list(action.mysql_updates.values()) + [message_id]
                    try:
                        execute(
                            f"UPDATE gmail_transactions SET {set_clauses} WHERE MessageId = %s",
                            params,
                        )
                        updated.append(message_id)
                        log_lines.append(
                            f"🔄 {message_id}: UPDATED {list(action.mysql_updates)} from Sheets"
                        )
                    except Exception as e:
                        errors.append(f"{message_id}: {e}")
                        log_lines.append(f"❌ {message_id}: UPDATE failed — {e}")
                else:
                    skipped.append((message_id, 'no mysql changes'))
                    log_lines.append(f"⊘ {message_id}: no changes")

            if (idx + 1) % 100 == 0:
                job_update = {'progress': 25 + int((idx / len(sheets_txns)) * 50)}
                update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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

def _dry_run_google_to_mysql(job_id: str, tables: list = None):
    """
    Fetch data from Google Sheets and compare with MySQL.
    Display differences but make NO changes.
    Pass tables=['members'] / ['events'] / ['payments'] to restrict to one table.
    """
    if tables is None:
        tables = ['members', 'events', 'payments']
    log_lines = []
    diffs = []

    try:
        job_update = {'status': 'running', 'message': 'Fetching data for comparison...', 'progress': 0}
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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


def _sync_google_to_mysql(job_id: str, tables: list = None):
    """
    Fetch data from Google Sheets and sync to MySQL.
    - Inserts new records from Sheets into MySQL.
    - Updates existing MySQL records if Sheets data is newer.
    Pass tables=['members'] / ['events'] / ['payments'] to restrict to one table.
    Default (None) syncs all three.
    """
    if tables is None:
        tables = ['members', 'events', 'payments']
    log_lines = []
    inserted_members, updated_members, skipped_members, errors_members = [], [], [], []
    inserted_events,  updated_events,  skipped_events,  errors_events  = [], [], [], []
    inserted_payments, updated_payments, skipped_payments, errors_payments = [], [], [], []
    errors = []

    try:
        job_update = {'status': 'running', 'message': 'Fetching data from Google Sheets...', 'progress': 0}
        update_job(job_id, **job_update)

        log_lines.append(f"🚀 Live Sync: Google → MySQL ({', '.join(tables)})")

        # 1. Fetch Members
        if 'members' not in tables:
            sheets_members_by_id = {}
            member_columns = []
            log_lines.append("⏭️ Members: skipped (not in requested tables)")
        else:
            try:
                sheets_members_data = _call_gas_webhook({'action': 'get_members'})
                sheets_members = [_normalize_gas_keys(m) for m in (sheets_members_data if isinstance(sheets_members_data, list) else [])]
                sheets_members_by_id = {m['MemberID']: m for m in sheets_members if m.get('MemberID')}
                log_lines.append(f"📊 Sheets: Fetched {len(sheets_members_by_id)} members")
            except Exception as e:
                log_lines.append(f"⚠️ Could not fetch members from Sheets: {e}")
                sheets_members_by_id = {}

            mysql_members_rows = query("SELECT * FROM members")
            mysql_members_by_id = {m['MemberID']: m for m in mysql_members_rows}
            log_lines.append(f"💾 MySQL: Fetched {len(mysql_members_by_id)} members")

            member_columns = [c['COLUMN_NAME'] for c in query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members'")]
            member_dt_columns = {c['COLUMN_NAME'] for c in query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND DATA_TYPE IN ('datetime','timestamp','date')")}
            member_int_columns = {c['COLUMN_NAME'] for c in query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND DATA_TYPE IN ('int','tinyint','smallint','mediumint','bigint','year')")}
            member_decimal_columns = {c['COLUMN_NAME'] for c in query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'members' AND DATA_TYPE IN ('decimal','numeric','float','double')")}

            job_update['message'] = 'Syncing members...'
            job_update['progress'] = 20
            update_job(job_id, **job_update)

        for member_id, sheet_member in sheets_members_by_id.items():
            mysql_member = mysql_members_by_id.get(member_id)

            if not mysql_member:
                # INSERT new member
                try:
                    cols_to_insert = {k: v for k, v in sheet_member.items() if k in member_columns}
                    cols_to_insert = {k: _coerce_value(v, k, member_dt_columns, member_int_columns, member_decimal_columns) for k, v in cols_to_insert.items()}
                    # Normalize Status ENUM (Sheets value may differ from MySQL ENUM)
                    if 'Status' in cols_to_insert:
                        mysql_status, status_warn = _coerce_member_status(cols_to_insert['Status'])
                        if status_warn:
                            log_lines.append(f"   {member_id}: {status_warn}")
                        if mysql_status is not None:
                            cols_to_insert['Status'] = mysql_status
                        else:
                            del cols_to_insert['Status']  # skip; let DB default apply
                    col_names = ', '.join(cols_to_insert.keys())
                    placeholders = ', '.join(['%s'] * len(cols_to_insert))
                    sql = f"INSERT INTO members ({col_names}) VALUES ({placeholders})"
                    execute(sql, list(cols_to_insert.values()))
                    inserted_members.append(member_id)
                    log_lines.append(
                        f"✅ INSERT | Member {member_id} | "
                        f"LastUpdated={cols_to_insert.get('LastUpdated', '?')!r}"
                    )
                except Exception as e:
                    log_lines.append(f"❌ Member {member_id}: INSERT failed: {e}")
                    errors_members.append(f"Member {member_id} INSERT: {e}")
                    errors.append(f"Member {member_id} INSERT: {e}")
                continue

            # Compare LastUpdated timestamps for existing members
            sheet_updated_at = _parse_datetime(sheet_member.get('LastUpdated'))
            mysql_updated_at = mysql_member.get('LastUpdated') # Already a datetime object

            if sheet_updated_at and mysql_updated_at and sheet_updated_at > mysql_updated_at:
                try:
                    cols_to_update = {k: v for k, v in sheet_member.items() if k in member_columns and k != 'MemberID'}
                    cols_to_update = {k: _coerce_value(v, k, member_dt_columns, member_int_columns, member_decimal_columns) for k, v in cols_to_update.items()}
                    # Normalize Status ENUM before comparing or writing
                    if 'Status' in cols_to_update:
                        mysql_status, status_warn = _coerce_member_status(cols_to_update['Status'])
                        if status_warn:
                            log_lines.append(f"   {member_id}: {status_warn}")
                        if mysql_status is not None:
                            cols_to_update['Status'] = mysql_status
                        else:
                            del cols_to_update['Status']  # unknown value → skip column, keep current DB value

                    # Find fields that actually changed (skip LastUpdated — it triggered the sync)
                    changed_fields = []
                    for col, new_val in cols_to_update.items():
                        if col == 'LastUpdated':
                            continue
                        old_val = mysql_member.get(col)
                        if col in member_dt_columns:
                            if not _datetimes_equal(old_val, new_val):
                                changed_fields.append(col)
                        else:
                            old_coerced = _coerce_value(old_val, col, member_dt_columns, member_int_columns, member_decimal_columns)
                            if str(old_coerced) != str(new_val):
                                changed_fields.append(col)

                    if not changed_fields:
                        # Sheets LastUpdated is newer but no data fields changed —
                        # sync the timestamp so next run shows MATCH instead of SKIP.
                        sheets_ts_str = sheet_member.get('LastUpdated', '')
                        mysql_ts_str  = str(mysql_updated_at) if mysql_updated_at else ''
                        coerced_ts = _coerce_value(sheets_ts_str, 'LastUpdated', member_dt_columns, member_int_columns, member_decimal_columns)
                        try:
                            execute("UPDATE members SET LastUpdated=%s WHERE MemberID=%s", [coerced_ts, member_id])
                            updated_members.append(member_id)
                            log_lines.append(
                                f"= MATCH | Member {member_id} | "
                                f"LastUpdated synced: {mysql_ts_str!r} → {sheets_ts_str!r} (no other changes)"
                            )
                        except Exception as ts_err:
                            skipped_members.append(member_id)
                            log_lines.append(f"⏭️ SKIP | Member {member_id} | LastUpdated sync failed: {ts_err}")
                    else:
                        set_clauses = ', '.join([f"{k}=%s" for k in cols_to_update.keys()])
                        sql = f"UPDATE members SET {set_clauses} WHERE MemberID=%s"
                        values = list(cols_to_update.values()) + [member_id]
                        mysql_ts_str  = str(mysql_updated_at) if mysql_updated_at else ''
                        sheets_ts_str = sheet_member.get('LastUpdated', '')
                        field_detail = ', '.join(
                            f"{f}: {mysql_member.get(f)!r} → {cols_to_update[f]!r}"
                            for f in changed_fields if f in cols_to_update
                        )
                        execute(sql, values)
                        updated_members.append(member_id)
                        log_lines.append(
                            f"🔄 UPDATE | Member {member_id} | {field_detail} | "
                            f"LastUpdated: {mysql_ts_str!r} → {sheets_ts_str!r}"
                        )
                except Exception as e:
                    # Show which Sheets/MySQL values triggered the failure
                    sheets_status = sheet_member.get('Status', '?')
                    mysql_status_val = cols_to_update.get('Status', '?') if 'cols_to_update' in dir() else '?'
                    sheets_ts = sheet_member.get('LastUpdated', '?')
                    mysql_ts = mysql_member.get('LastUpdated', '?')
                    log_lines.append(
                        f"❌ Member {member_id}: UPDATE failed: {e} "
                        f"[Sheets Status='{sheets_status}' → MySQL='{mysql_status_val}', "
                        f"Sheets LastUpdated='{sheets_ts}', MySQL LastUpdated='{mysql_ts}']"
                    )
                    errors_members.append(f"Member {member_id} UPDATE: {e}")
                    errors.append(f"Member {member_id} UPDATE: {e}")
            else:
                # MySQL timestamp is same or newer — Sheets data is stale, skip
                skipped_members.append(member_id)
                mysql_ts_disp   = str(mysql_updated_at) if mysql_updated_at else 'None'
                sheets_ts_disp  = sheet_member.get('LastUpdated', 'None')
                log_lines.append(
                    f"⏭️ SKIP | Member {member_id} | "
                    f"MySQL LastUpdated={mysql_ts_disp!r} ≥ Sheets LastUpdated={sheets_ts_disp!r}"
                )

        # 2. Fetch Events
        log_lines.append("\n--- Syncing Events ---")
        inserted_events, updated_events, skipped_events, errors_events = [], [], [], []
        if 'events' not in tables:
            log_lines.append("⏭️ Events: skipped (not in requested tables)")
        else:
            try:
                sheets_events_data = _call_gas_webhook({'action': 'get_events'})
                sheets_events = [_normalize_gas_keys(e) for e in (sheets_events_data if isinstance(sheets_events_data, list) else [])]
                sheets_events_by_id = {e['EventID']: e for e in sheets_events if e.get('EventID')}
                log_lines.append(f"📊 Sheets: Fetched {len(sheets_events_by_id)} events")

                mysql_events_rows = query("SELECT * FROM webapp_events")
                mysql_events_by_id = {e['EventID']: e for e in mysql_events_rows}
                log_lines.append(f"💾 MySQL: Fetched {len(mysql_events_by_id)} events")

                event_columns = [c['COLUMN_NAME'] for c in query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'webapp_events'")]
                event_dt_columns = {c['COLUMN_NAME'] for c in query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'webapp_events' AND DATA_TYPE IN ('datetime','timestamp','date')")}
                event_int_columns = {c['COLUMN_NAME'] for c in query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'webapp_events' AND DATA_TYPE IN ('int','tinyint','smallint','mediumint','bigint','year')")}
                valid_gmail_ids = {r['MessageId'] for r in query("SELECT MessageId FROM gmail_transactions")}

                for event_id, sheet_event in sheets_events_by_id.items():
                    mysql_event = mysql_events_by_id.get(event_id)
                    if not mysql_event:
                        try:
                            cols_to_insert = {k: v for k, v in sheet_event.items() if k in event_columns}
                            cols_to_insert = {k: _coerce_value(v, k, event_dt_columns, event_int_columns) for k, v in cols_to_insert.items()}
                            # Null out MatchedMessageId if empty string OR not in gmail_transactions
                            # (empty string '' is falsy but still triggers FK constraint)
                            raw_mid = cols_to_insert.get('MatchedMessageId')
                            if not raw_mid or str(raw_mid).strip() == '' or raw_mid not in valid_gmail_ids:
                                if raw_mid and str(raw_mid).strip():
                                    log_lines.append(f"   Event {event_id}: MatchedMessageId '{raw_mid}' not in gmail_transactions → NULL")
                                cols_to_insert['MatchedMessageId'] = None
                            col_names = ', '.join(cols_to_insert.keys())
                            placeholders = ', '.join(['%s'] * len(cols_to_insert))
                            sql = f"INSERT INTO webapp_events ({col_names}) VALUES ({placeholders})"
                            execute(sql, list(cols_to_insert.values()))
                            inserted_events.append(event_id)
                            log_lines.append(
                                f"✅ INSERT | Event {event_id} | "
                                f"UpdatedAt={cols_to_insert.get('UpdatedAt', cols_to_insert.get('Timestamp', '?'))!r}"
                            )
                        except Exception as e:
                            log_lines.append(f"❌ ERROR | Event {event_id} | INSERT failed: {e}")
                            errors_events.append(f"Event {event_id} INSERT: {e}")
                    else:
                        sheet_updated_at = _parse_datetime(sheet_event.get('Timestamp'))
                        mysql_updated_at = mysql_event.get('Timestamp')
                        if sheet_updated_at and mysql_updated_at and sheet_updated_at > mysql_updated_at:
                            try:
                                cols_to_update = {k: v for k, v in sheet_event.items() if k in event_columns and k != 'EventID'}
                                cols_to_update = {k: _coerce_value(v, k, event_dt_columns, event_int_columns) for k, v in cols_to_update.items()}
                                # Null out MatchedMessageId if empty string OR not in gmail_transactions
                                raw_mid = cols_to_update.get('MatchedMessageId')
                                if not raw_mid or str(raw_mid).strip() == '' or raw_mid not in valid_gmail_ids:
                                    if raw_mid and str(raw_mid).strip():
                                        log_lines.append(f"   Event {event_id}: MatchedMessageId '{raw_mid}' not in gmail_transactions → NULL")
                                    cols_to_update['MatchedMessageId'] = None
                                # Compute field-level diff for the log
                                event_changed = [
                                    f"{k}: {mysql_event.get(k)!r} → {v!r}"
                                    for k, v in cols_to_update.items()
                                    if k != 'Timestamp' and str(mysql_event.get(k, '')) != str(v or '')
                                ]
                                set_clauses = ', '.join([f"{k}=%s" for k in cols_to_update.keys()])
                                sql = f"UPDATE webapp_events SET {set_clauses} WHERE EventID=%s"
                                values = list(cols_to_update.values()) + [event_id]
                                execute(sql, values)
                                updated_events.append(event_id)
                                field_detail = ', '.join(event_changed) if event_changed else '(timestamp only)'
                                log_lines.append(
                                    f"🔄 UPDATE | Event {event_id} | {field_detail} | "
                                    f"UpdatedAt: {str(mysql_updated_at)!r} → {sheet_event.get('Timestamp', '?')!r}"
                                )
                            except Exception as e:
                                log_lines.append(f"❌ ERROR | Event {event_id} | UPDATE failed: {e}")
                                errors_events.append(f"Event {event_id} UPDATE: {e}")
                        else:
                            skipped_events.append(event_id)
                            mysql_ts_disp  = str(mysql_updated_at) if mysql_updated_at else 'None'
                            sheets_ts_disp = sheet_event.get('Timestamp', 'None')
                            log_lines.append(
                                f"⏭️ SKIP | Event {event_id} | "
                                f"MySQL UpdatedAt={mysql_ts_disp!r} ≥ Sheets Timestamp={sheets_ts_disp!r}"
                            )
                log_lines.append(f"Events Sync Finished: Inserted {len(inserted_events)}, Updated {len(updated_events)}, Skipped {len(skipped_events)}, Errors {len(errors_events)}")
                errors.extend(errors_events)
            except Exception as e:
                log_lines.append(f"⚠️ Could not sync events: {e}")
                errors.append(f"Event sync failed: {e}")

        # 3. Fetch Payments
        log_lines.append("\n--- Syncing Payments ---")
        inserted_payments, updated_payments, skipped_payments, errors_payments = [], [], [], []
        if 'payments' not in tables:
            log_lines.append("⏭️ Payments: skipped (not in requested tables)")
        else:
            try:
                sheets_payments_data = _call_gas_webhook({'action': 'get_payments'})
                sheets_payments = [_normalize_gas_keys(p) for p in (sheets_payments_data if isinstance(sheets_payments_data, list) else [])]
                sheets_payments_by_id = {p['PaymentID']: p for p in sheets_payments if p.get('PaymentID')}
                log_lines.append(f"📊 Sheets: Fetched {len(sheets_payments_by_id)} payments")

                mysql_payments_rows = query("SELECT * FROM payments")
                mysql_payments_by_id = {p['PaymentID']: p for p in mysql_payments_rows}
                log_lines.append(f"💾 MySQL: Fetched {len(mysql_payments_by_id)} payments")

                payment_columns = [c['COLUMN_NAME'] for c in query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments'")]
                payment_dt_columns = {c['COLUMN_NAME'] for c in query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND DATA_TYPE IN ('datetime','timestamp','date')")}
                payment_int_columns = {c['COLUMN_NAME'] for c in query("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'payments' AND DATA_TYPE IN ('int','tinyint','smallint','mediumint','bigint','year')")}
                valid_event_ids = {r['EventID'] for r in query("SELECT EventID FROM webapp_events")}

                for payment_id, sheet_payment in sheets_payments_by_id.items():
                    mysql_payment = mysql_payments_by_id.get(payment_id)
                    if not mysql_payment:
                        try:
                            cols_to_insert = {k: v for k, v in sheet_payment.items() if k in payment_columns}
                            cols_to_insert = {k: _coerce_value(v, k, payment_dt_columns, payment_int_columns) for k, v in cols_to_insert.items()}
                            if cols_to_insert.get('EventID') and cols_to_insert['EventID'] not in valid_event_ids:
                                cols_to_insert['EventID'] = None
                            col_names = ', '.join(cols_to_insert.keys())
                            placeholders = ', '.join(['%s'] * len(cols_to_insert))
                            sql = f"INSERT INTO payments ({col_names}) VALUES ({placeholders})"
                            execute(sql, list(cols_to_insert.values()))
                            inserted_payments.append(payment_id)
                            log_lines.append(
                                f"✅ INSERT | Payment {payment_id} | "
                                f"MemberID={cols_to_insert.get('MemberID', '?')} | "
                                f"ProcessedDate={cols_to_insert.get('ProcessedDate', '?')!r}"
                            )
                        except Exception as e:
                            log_lines.append(f"❌ ERROR | Payment {payment_id} | INSERT failed: {e}")
                            errors_payments.append(f"Payment {payment_id} INSERT: {e}")
                    else:
                        sheet_updated_at = _parse_datetime(sheet_payment.get('ProcessedDate'))
                        mysql_updated_at = mysql_payment.get('ProcessedDate')
                        if sheet_updated_at and mysql_updated_at and sheet_updated_at > mysql_updated_at:
                            try:
                                cols_to_update = {k: v for k, v in sheet_payment.items() if k in payment_columns and k != 'PaymentID'}
                                cols_to_update = {k: _coerce_value(v, k, payment_dt_columns, payment_int_columns) for k, v in cols_to_update.items()}
                                if cols_to_update.get('EventID') and cols_to_update['EventID'] not in valid_event_ids:
                                    cols_to_update['EventID'] = None
                                # Compute field-level diff for the log
                                pay_changed = [
                                    f"{k}: {mysql_payment.get(k)!r} → {v!r}"
                                    for k, v in cols_to_update.items()
                                    if k != 'ProcessedDate' and str(mysql_payment.get(k, '')) != str(v or '')
                                ]
                                set_clauses = ', '.join([f"{k}=%s" for k in cols_to_update.keys()])
                                sql = f"UPDATE payments SET {set_clauses} WHERE PaymentID=%s"
                                values = list(cols_to_update.values()) + [payment_id]
                                execute(sql, values)
                                updated_payments.append(payment_id)
                                field_detail = ', '.join(pay_changed) if pay_changed else '(timestamp only)'
                                log_lines.append(
                                    f"🔄 UPDATE | Payment {payment_id} | "
                                    f"MemberID={mysql_payment.get('MemberID', '?')} | "
                                    f"{field_detail} | "
                                    f"ProcessedDate: {str(mysql_updated_at)!r} → {sheet_payment.get('ProcessedDate', '?')!r}"
                                )
                            except Exception as e:
                                log_lines.append(f"❌ ERROR | Payment {payment_id} | UPDATE failed: {e}")
                                errors_payments.append(f"Payment {payment_id} UPDATE: {e}")
                        else:
                            skipped_payments.append(payment_id)
                            mysql_ts_disp  = str(mysql_updated_at) if mysql_updated_at else 'None'
                            sheets_ts_disp = sheet_payment.get('ProcessedDate', 'None')
                            log_lines.append(
                                f"⏭️ SKIP | Payment {payment_id} | "
                                f"MemberID={mysql_payment.get('MemberID', '?')} | "
                                f"MySQL ProcessedDate={mysql_ts_disp!r} ≥ Sheets ProcessedDate={sheets_ts_disp!r}"
                            )
                log_lines.append(f"Payments Sync Finished: Inserted {len(inserted_payments)}, Updated {len(updated_payments)}, Skipped {len(skipped_payments)}, Errors {len(errors_payments)}")
                errors.extend(errors_payments)
            except Exception as e:
                log_lines.append(f"⚠️ Could not sync payments: {e}")
                errors.append(f"Payment sync failed: {e}")

        summary = (
            f"✅ Google → MySQL | "
            f"Members: {len(inserted_members)} ins, {len(updated_members)} upd, {len(skipped_members)} skip, {len(errors_members)} err | "
            f"Events: {len(inserted_events)} ins, {len(updated_events)} upd, {len(skipped_events)} skip, {len(errors_events)} err | "
            f"Payments: {len(inserted_payments)} ins, {len(updated_payments)} upd, {len(skipped_payments)} skip, {len(errors_payments)} err"
        )

        total_inserted = len(inserted_members) + len(inserted_events) + len(inserted_payments)
        total_updated  = len(updated_members)  + len(updated_events)  + len(updated_payments)
        total_skipped  = len(skipped_members)  + len(skipped_events)  + len(skipped_payments)
        job_update = {
            'status': 'done',
            'message': summary,
            'progress': 100,
            'result': {
                'operation': 'sync_google_to_mysql',
                # Normalised summary keys (consumed by JobCard stat line)
                'inserted': total_inserted,
                'updated':  total_updated,
                'skipped':  total_skipped,
                'errors_count': len(errors),
                # Per-table detail
                'inserted_members': len(inserted_members),
                'updated_members':  len(updated_members),
                'inserted_events':  len(inserted_events),
                'updated_events':   len(updated_events),
                'inserted_payments': len(inserted_payments),
                'updated_payments':  len(updated_payments),
                'errors': errors,
                'log': '\n'.join(log_lines),
            }
        }
        update_job(job_id, **job_update)

        # Send report email
        _send_sync_report(
            recipient='admin@mmrunners.org',
            operation='Google → MySQL Sync',
            summary=summary,
            details=[f"Inserted Members: {len(inserted_members)}", f"Updated Members: {len(updated_members)}",
                     f"Inserted Events: {len(inserted_events)}", f"Updated Events: {len(updated_events)}",
                     f"Inserted Payments: {len(inserted_payments)}", f"Updated Payments: {len(updated_payments)}"] + errors,
            log_content='\n'.join(log_lines),
        )

    except Exception as e:
        logger.error(f"Google → MySQL sync error: {e}\n{traceback.format_exc()}")
        error_msg = f"❌ Sync failed: {e}"
        job_update = {
            'status': 'error',
            'message': error_msg,
            'result': {'error': str(e), 'log': '\n'.join(log_lines)}
        }
        update_job(job_id, **job_update)

        _send_sync_report(
            recipient='admin@mmrunners.org',
            operation='Google → MySQL Sync',
            summary=error_msg,
            details=[],
            log_content='\n'.join(log_lines),
        )


# ═══════════════════════════════════════════════════════════════════════════
# REST API Endpoints
# ═══════════════════════════════════════════════════════════════════════════

@sheets_sync_bp.route('/api/sync/mysql-to-google/members', methods=['POST'])
@login_required
def api_sync_members():
    """Trigger members sync (MySQL → Google Sheets)."""
    job_id = launch_job(_sync_members_to_sheets)

    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/mysql-to-google/events', methods=['POST'])
@login_required
def api_sync_events():
    """Trigger events sync (MySQL → Google Sheets)."""
    job_id = launch_job(_sync_events_to_sheets)

    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/mysql-to-google/payments', methods=['POST'])
@login_required
def api_sync_payments():
    """Trigger payments sync (MySQL → Google Sheets)."""
    job_id = launch_job(_sync_payments_to_sheets)

    return json_response({'ok': True, 'job_id': job_id})


def _sync_unprocessed_transactions_to_sheets(job_id: str):
    """
    Sync unprocessed transactions (ProcessedTime IS NULL) from MySQL to Google Sheets.

    Updates only: Notes, ProcessedTime, PaymentID.
    """
    log_lines = []
    updated = []
    errors = []

    try:
        job_update = {'status': 'running', 'message': 'Fetching unprocessed transactions...', 'progress': 0}
        update_job(job_id, **job_update)

        # Fetch unprocessed transactions from MySQL
        unprocessed = query("""
            SELECT MessageId, Notes, ProcessedTime, PaymentID
            FROM gmail_transactions
            WHERE ProcessedTime IS NULL
            ORDER BY TimeStamp DESC
        """)
        log_lines.append(f"📥 Found {len(unprocessed)} unprocessed transactions in MySQL")

        # Fetch gmail_transactions from Google Sheets
        try:
            sheets_data = _call_gas_webhook({'action': 'get_transactions'})
            sheets_by_id = {t.get('MessageId'): t for t in (sheets_data if isinstance(sheets_data, list) else [])}
            log_lines.append(f"📊 Fetched {len(sheets_by_id)} transactions from Google Sheets")
        except Exception as e:
            log_lines.append(f"❌ Failed to fetch from Sheets: {e}")
            raise

        job_update = {'status': 'running', 'message': 'Syncing unprocessed transactions...', 'progress': 25}
        update_job(job_id, **job_update)

        # Update Sheets with unprocessed transactions
        updates = []
        for txn in unprocessed:
            message_id = txn['MessageId']
            if message_id in sheets_by_id:
                updates.append({
                    'MessageId': message_id,
                    'Notes': txn['Notes'] or '',
                    'ProcessedTime': txn['ProcessedTime'] or '',
                    'PaymentID': txn['PaymentID'] or '',
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
        update_job(job_id, **job_update)

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
        update_job(job_id, **job_update)

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
    job_id = launch_job(_sync_gmail_transactions_to_sheets)

    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/unprocessed-transactions', methods=['POST'])
@login_required
def api_sync_unprocessed_transactions():
    """Trigger unprocessed transactions sync (MySQL → Google Sheets)."""
    job_id = launch_job(_sync_unprocessed_transactions_to_sheets)

    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/import-transactions', methods=['POST'])
@login_required
def api_import_transactions():
    """Trigger transaction import (Google Sheets → MySQL)."""
    job_id = launch_job(_import_transactions)

    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/google-to-mysql', methods=['POST'])
@login_required
def api_sync_google_to_mysql():
    """Trigger sync (Google Sheets → MySQL)."""
    job_id = launch_job(_sync_google_to_mysql)

    return json_response({'ok': True, 'job_id': job_id})


@sheets_sync_bp.route('/api/sync/dry-run', methods=['POST'])
@login_required
def api_dry_run():
    """Trigger dry-run (Google → MySQL, no changes)."""
    job_id = launch_job(_dry_run_google_to_mysql)

    return json_response({'ok': True, 'job_id': job_id})


def _make_g2m_route(table: str, live: bool):
    """Factory for per-table Google → MySQL live/dry-run route handlers."""
    def handler():
        fn = _sync_google_to_mysql if live else _dry_run_google_to_mysql
        job_id = launch_job(fn, tables=[table])
        return json_response({'ok': True, 'job_id': job_id})
    handler.__name__ = f'api_g2m_{"live" if live else "dry"}_{table}'
    return handler


for _table in ('members', 'events', 'payments'):
    sheets_sync_bp.route(f'/api/sync/google-to-mysql/{_table}', methods=['POST'])(
        login_required(_make_g2m_route(_table, live=True))
    )
    sheets_sync_bp.route(f'/api/sync/dry-run/{_table}', methods=['POST'])(
        login_required(_make_g2m_route(_table, live=False))
    )


@sheets_sync_bp.route('/api/sync/jobs')
@login_required
def api_sync_jobs():
    """Return all known sync jobs (newest first) so the UI can restore state on mount."""
    jobs = list_sync_jobs()
    ordered = {j['jobId']: j for j in jobs}
    return json_response({'ok': True, 'jobs': ordered})


@sheets_sync_bp.route('/api/sync/status/<job_id>')
@login_required
def api_sync_status(job_id):
    """Get status of a sync job (from memory or database)."""
    # First check in-memory jobs
    job = get_job(job_id)
    if job:
        return json_response({'ok': True, 'data': job})

    # Fallback: check database for completed/archived jobs
    try:
        db_job = query(
            "SELECT JobID, Operation, Status, Message, Progress, Result, StartedAt, UpdatedAt, CompletedAt "
            "FROM sync_jobs WHERE JobID = %s",
            [job_id]
        )
        if db_job:
            logger.info(f'api_sync_status: job {job_id} found in database (status={db_job[0].get("Status")})')
            return json_response({'ok': True, 'data': db_job[0]})
    except Exception as e:
        logger.warning(f'Failed to check database for job {job_id}: {e}')

    # Job not found anywhere
    logger.warning(f'api_sync_status: job {job_id} not found (may have completed/expired)')
    return json_response({
        'ok': False,
        'error': f'Job {job_id} not found (may have completed or expired)',
        'hint': 'Check completed jobs list or try restarting the sync'
    }, 404)


# ─────────────────────────────────────────────────────────────────────────────
# Cron token auth — lets GitHub Actions call sync routes without a session
# ─────────────────────────────────────────────────────────────────────────────

def _cron_auth_or_session(f):
    """
    Decorator: allow request if either:
    - user is logged in (normal session), OR
    - X-Cron-Token header matches SYNC_CRON_TOKEN env var (for GH Actions)
    """
    import functools, os as _os2
    @functools.wraps(f)
    def wrapper(*args, **kwargs):
        token = request.headers.get('X-Cron-Token', '')
        expected = _os2.environ.get('SYNC_CRON_TOKEN', '')
        if expected and token == expected:
            return f(*args, **kwargs)   # cron path — bypass session check
        # Fall through to normal session auth
        from auth import login_required as _lr
        return _lr(f)(*args, **kwargs)
    return wrapper


# ─────────────────────────────────────────────────────────────────────────────
# Full Bidirectional Sync — all 8 phases in sequence
# ─────────────────────────────────────────────────────────────────────────────

_FULL_SYNC_PHASES = [
    # (label, fn, kwargs)
    ('Members: MySQL → Google',          _sync_members_to_sheets,                  {}),
    ('Members: Google → MySQL',          _sync_google_to_mysql,                    {'tables': ['members']}),
    ('Events: MySQL → Google',           _sync_events_to_sheets,                   {}),
    ('Events: Google → MySQL',           _sync_google_to_mysql,                    {'tables': ['events']}),
    ('Payments: MySQL → Google',         _sync_payments_to_sheets,                 {}),
    ('Payments: Google → MySQL',         _sync_google_to_mysql,                    {'tables': ['payments']}),
    ('Gmail Transactions: Import',       _import_transactions,                      {}),
    ('Unprocessed Txns: MySQL → Google', _sync_unprocessed_transactions_to_sheets, {}),
]


def _run_full_bidirectional_sync(job_id: str):
    """
    Run all 8 sync phases in sequence.
    Each phase is called directly (same thread) using its own sub-job-id.
    Admin email sent after every phase; summary email at the end.
    """
    n = len(_FULL_SYNC_PHASES)
    results = []
    overall_log = []

    update_job(job_id, status='running', message=f'Starting full sync ({n} phases)…', progress=0)

    for i, (label, fn, kwargs) in enumerate(_FULL_SYNC_PHASES):
        sub_id = f'{job_id}-p{i + 1}'
        # Register sub-job directly in the shared registry
        from sync_jobs import _jobs as _sj, _lock as _sl
        with _sl:
            _sj[sub_id] = {'jobId': sub_id, 'status': 'running',
                           'message': f'Running {label}…', 'jobName': label,
                           'actionType': 'Full Sync', 'progress': 0,
                           'startedAt': time.time(), 'updatedAt': time.time(), 'result': None}
        update_job(job_id, message=f'Phase {i + 1}/{n}: {label}', progress=int(i / n * 100))

        try:
            fn(sub_id, **kwargs)
        except Exception as exc:
            logger.error('Full sync phase %s error: %s', label, exc)
            update_job(sub_id, status='error', message=str(exc))

        phase = get_job(sub_id) or {}
        phase_status = phase.get('status', 'unknown')
        phase_log    = (phase.get('result') or {}).get('log', '')
        results.append({'phase': label, 'status': phase_status, 'message': phase.get('message', '')})
        overall_log.append(f'\n── Phase {i + 1}/{n}: {label} [{phase_status.upper()}] ──\n{phase_log}')

        # Per-phase email to admin
        _send_sync_report(
            recipient='admin@mmrunners.org',
            operation=f'Full Sync — Phase {i + 1}/{n}: {label}',
            summary=phase.get('message', ''),
            details=[f"Status: {phase_status}"],
            log_content=phase_log,
        )

    all_ok = all(r['status'] == 'done' for r in results)
    ok_count = sum(1 for r in results if r['status'] == 'done')
    emoji = '✅' if all_ok else '⚠️'
    summary = (f'{emoji} Full Bidirectional Sync complete: '
               f'{ok_count}/{n} phases succeeded.')
    if not all_ok:
        failed = [r['phase'] for r in results if r['status'] != 'done']
        summary += f' Failed: {", ".join(failed)}.'

    update_job(job_id,
        status='done' if all_ok else 'error',
        message=summary,
        progress=100,
        result={
            'inserted': sum(r.get('inserted', 0) for r in results if isinstance(r, dict)),
            'updated':  sum(r.get('updated',  0) for r in results if isinstance(r, dict)),
            'phases': results,
            'log': '\n'.join(overall_log),
        },
    )

    # Final summary email
    _send_sync_report(
        recipient='admin@mmrunners.org',
        operation='Full Bidirectional Sync — Complete',
        summary=summary,
        details=[f"  {'✅' if r['status']=='done' else '❌'} {r['phase']}: {r['message']}" for r in results],
        log_content='\n'.join(overall_log),
    )


@sheets_sync_bp.route('/api/sync/full-bidirectional-sync', methods=['POST'])
@_cron_auth_or_session
def api_full_bidirectional_sync():
    """
    Trigger a full 8-phase bidirectional sync.
    Accessible via admin session OR X-Cron-Token header (for GitHub Actions).
    """
    job_id = launch_job(_run_full_bidirectional_sync, initial_message='Queued…')
    return json_response({'ok': True, 'job_id': job_id})
