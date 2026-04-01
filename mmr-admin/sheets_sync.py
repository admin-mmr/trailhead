"""
Google Sheets sync helpers for mmr-admin.

Fire-and-forget async POST to the GAS webhook endpoint.
All sync functions run in daemon threads and never block the request.

This is a leaf module — it only imports from db.
"""

from __future__ import annotations

import threading
from datetime import date, datetime
from typing import Any, Dict, Optional

from db import query
from config_cache import get_config


# ---------------------------------------------------------------------------
# Low-level POST helper
# ---------------------------------------------------------------------------

def _get_webhook_url() -> str:
    """Get the Sheets webhook URL from config."""
    return get_config('SheetsWebhookUrl', '').strip()


def _post_to_sheets(payload: Dict) -> None:
    """
    Fire-and-forget async POST to the GAS webhook.
    Runs in a daemon thread so it never blocks the request.
    """
    webhook_url = _get_webhook_url()
    if not webhook_url:
        print(f'  [sheets-sync] ERROR: SheetsWebhookUrl not set in config table. '
              f'action={payload.get("action")} member={payload.get("memberId", "?")}')
        return

    action = payload.get('action', '?')
    member = payload.get('memberId', '?')

    def _do_post():
        try:
            import requests
            resp = requests.post(webhook_url, json=payload, timeout=15)
            if resp.status_code == 200:
                try:
                    body = resp.json()
                    if not body.get('ok'):
                        print(f'  [sheets-sync] WARN: {action} member={member} → '
                              f'HTTP 200 but ok=false: {body.get("error", body)}')
                    else:
                        print(f'  [sheets-sync] OK: {action} member={member} → 200')
                except Exception:
                    print(f'  [sheets-sync] OK: {action} member={member} → 200 (non-JSON response)')
            else:
                print(f'  [sheets-sync] ERROR: {action} member={member} → '
                      f'HTTP {resp.status_code}: {resp.text[:200]}')
        except Exception as e:
            print(f'  [sheets-sync] ERROR: {action} member={member} → {e}')

    t = threading.Thread(target=_do_post, daemon=True)
    t.start()


# ---------------------------------------------------------------------------
# ISO helper
# ---------------------------------------------------------------------------

def _to_iso(val) -> str:
    """Convert a date/datetime to ISO string, or return empty string."""
    if val is None:
        return ''
    if isinstance(val, (date, datetime)):
        return val.isoformat()
    return str(val)


# ---------------------------------------------------------------------------
# Public sync functions
# ---------------------------------------------------------------------------

def sync_member_to_sheets(member_id: str, changed_by: str = '') -> None:
    """
    Sync a single member's current MySQL state to Google Sheets.

    Reads the full member row from MySQL and POSTs it to the GAS
    webhook with action='member_updated'. The webhook writes the
    values into the Membership Master sheet.

    Call this after ANY write to the members table.
    """
    rows = query("SELECT * FROM members WHERE MemberID = %s", [member_id])
    if not rows:
        print(f'  [sheets-sync] Member {member_id} not found — skipping sync')
        return
    member = rows[0]

    # Build payload with all syncable fields
    # Keys match the GAS FIELD_TO_COL mapping in webhook.ts
    _post_to_sheets({
        'action': 'member_updated',
        'memberId': member_id,
        'changedBy': changed_by,
        'fields': {
            'Status':             str(member.get('Status', '')),
            'Expiration':         _to_iso(member.get('Expiration')),
            'Type':               str(member.get('Type', '')),
            'FamilyID':           str(member.get('FamilyID', '') or ''),
            'MembershipFeePaid':  str(member.get('MembershipFeePaid', '') or ''),
            'PaymentDate':        _to_iso(member.get('PaymentDate')),
            'PaymentTransaction': str(member.get('PaymentTransaction', '') or ''),
            'LastUpdated':        _to_iso(member.get('LastUpdated')),
            'Email':              str(member.get('Email', '')),
            'FirstName':          str(member.get('FirstName', '')),
            'LastName':           str(member.get('LastName', '')),
            'Gender':             str(member.get('Gender', '') or ''),
            'WeChatID':           str(member.get('WeChatID', '') or ''),
            'District':           str(member.get('District', '') or ''),
            'PhoneNumber':        str(member.get('PhoneNumber', '') or ''),
            'Notes':              str(member.get('Notes', '') or ''),
            'NYRRRunnerName':     str(member.get('NYRRRunnerName', '') or ''),
            'YearBorn':           str(member.get('YearBorn', '') or ''),
        },
    })


def sync_event_to_sheets(
    event_id: str,
    status: str,
    admin_email: str = '',
) -> None:
    """
    Sync a webapp_event status change to Google Sheets.
    Call after approve/reject/match operations.
    """
    _post_to_sheets({
        'action': 'event_status_updated',
        'eventId': event_id,
        'status': status,
        'adminApprover': admin_email,
    })


def sync_payment_to_sheets(
    payment_id: str,
    event_id: str,
    member_id: str,
    amount: str,
    payment_intent: str,
    period_end: str,
    source: str = 'mmr-admin',
) -> None:
    """
    Sync a new payment record to the Payment-History sheet.
    Call after creating a payment record in MySQL.
    """
    _post_to_sheets({
        'action': 'payment_created',
        'paymentId': payment_id,
        'eventId': event_id,
        'memberId': member_id,
        'amount': amount,
        'paymentIntent': payment_intent,
        'periodEnd': period_end,
        'source': source,
    })
