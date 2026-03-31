"""
Sync Debug Helpers — Extract raw data and helper functions for debugging.

These functions allow you to call sync internals from the Python Code Editor
to see raw data being used for comparison, without running the full sync.

Usage from Python Code Editor:
  from sync_debug_helpers import *

  # Get raw data from Google and MySQL for comparison
  google_members = get_google_members_for_debug()
  mysql_members = get_mysql_members_for_debug()

  # Compare specific member
  member = google_members[0] if google_members else None
  print(json.dumps(member, indent=2, default=str))
"""

from __future__ import annotations

import json
from typing import List, Dict, Any, Optional
from db import query
from api_sheets_sync import _call_gas_webhook
import traceback


def get_google_members_for_debug() -> List[Dict[str, Any]]:
    """Fetch members from Google Sheets (raw data)."""
    try:
        data = _call_gas_webhook({'action': 'get_members'})
        members = data if isinstance(data, list) else []
        return members
    except Exception as e:
        return [{'error': str(e), 'traceback': traceback.format_exc()}]


def get_mysql_members_for_debug() -> List[Dict[str, Any]]:
    """Fetch members from MySQL (raw data)."""
    try:
        members = query("SELECT * FROM members ORDER BY MemberID LIMIT 100")
        return members
    except Exception as e:
        return [{'error': str(e), 'traceback': traceback.format_exc()}]


def get_google_events_for_debug() -> List[Dict[str, Any]]:
    """Fetch events from Google Sheets (raw data)."""
    try:
        data = _call_gas_webhook({'action': 'get_events'})
        events = data if isinstance(data, list) else []
        return events
    except Exception as e:
        return [{'error': str(e), 'traceback': traceback.format_exc()}]


def get_mysql_events_for_debug() -> List[Dict[str, Any]]:
    """Fetch events from MySQL (raw data)."""
    try:
        events = query("SELECT * FROM webapp_events ORDER BY EventID LIMIT 100")
        return events
    except Exception as e:
        return [{'error': str(e), 'traceback': traceback.format_exc()}]


def get_google_payments_for_debug() -> List[Dict[str, Any]]:
    """Fetch payments from Google Sheets (raw data)."""
    try:
        data = _call_gas_webhook({'action': 'get_payments'})
        payments = data if isinstance(data, list) else []
        return payments
    except Exception as e:
        return [{'error': str(e), 'traceback': traceback.format_exc()}]


def get_mysql_payments_for_debug() -> List[Dict[str, Any]]:
    """Fetch payments from MySQL (raw data)."""
    try:
        payments = query("SELECT * FROM payments ORDER BY PaymentID LIMIT 100")
        return payments
    except Exception as e:
        return [{'error': str(e), 'traceback': traceback.format_exc()}]


def get_google_transactions_for_debug() -> List[Dict[str, Any]]:
    """Fetch transactions from Google Sheets (raw data)."""
    try:
        data = _call_gas_webhook({'action': 'get_transactions'})
        txns = data if isinstance(data, list) else []
        return txns
    except Exception as e:
        return [{'error': str(e), 'traceback': traceback.format_exc()}]


def get_mysql_transactions_for_debug() -> List[Dict[str, Any]]:
    """Fetch transactions from MySQL (raw data)."""
    try:
        txns = query("SELECT * FROM gmail_transactions ORDER BY MessageId LIMIT 100")
        return txns
    except Exception as e:
        return [{'error': str(e), 'traceback': traceback.format_exc()}]


def compare_members(google_members: Optional[List[Dict]] = None,
                   mysql_members: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """Compare members between Google and MySQL."""
    if google_members is None:
        google_members = get_google_members_for_debug()
    if mysql_members is None:
        mysql_members = get_mysql_members_for_debug()

    google_ids = {m.get('MemberID'): m for m in google_members if 'MemberID' in m}
    mysql_ids = {m['MemberID']: m for m in mysql_members}

    return {
        'google_count': len(google_ids),
        'mysql_count': len(mysql_ids),
        'new_in_google': list(set(google_ids.keys()) - set(mysql_ids.keys())),
        'missing_in_google': list(set(mysql_ids.keys()) - set(google_ids.keys())),
        'in_both': list(set(google_ids.keys()) & set(mysql_ids.keys())),
    }


def compare_events(google_events: Optional[List[Dict]] = None,
                  mysql_events: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """Compare events between Google and MySQL."""
    if google_events is None:
        google_events = get_google_events_for_debug()
    if mysql_events is None:
        mysql_events = get_mysql_events_for_debug()

    google_ids = {e.get('EventID'): e for e in google_events if 'EventID' in e}
    mysql_ids = {e['EventID']: e for e in mysql_events}

    return {
        'google_count': len(google_ids),
        'mysql_count': len(mysql_ids),
        'new_in_google': list(set(google_ids.keys()) - set(mysql_ids.keys())),
        'missing_in_google': list(set(mysql_ids.keys()) - set(google_ids.keys())),
        'in_both': list(set(google_ids.keys()) & set(mysql_ids.keys())),
    }


def compare_payments(google_payments: Optional[List[Dict]] = None,
                    mysql_payments: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """Compare payments between Google and MySQL."""
    if google_payments is None:
        google_payments = get_google_payments_for_debug()
    if mysql_payments is None:
        mysql_payments = get_mysql_payments_for_debug()

    google_ids = {p.get('PaymentID'): p for p in google_payments if 'PaymentID' in p}
    mysql_ids = {p['PaymentID']: p for p in mysql_payments}

    return {
        'google_count': len(google_ids),
        'mysql_count': len(mysql_ids),
        'new_in_google': list(set(google_ids.keys()) - set(mysql_ids.keys())),
        'missing_in_google': list(set(mysql_ids.keys()) - set(google_ids.keys())),
        'in_both': list(set(google_ids.keys()) & set(mysql_ids.keys())),
    }


def compare_transactions(google_txns: Optional[List[Dict]] = None,
                        mysql_txns: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """Compare transactions between Google and MySQL."""
    if google_txns is None:
        google_txns = get_google_transactions_for_debug()
    if mysql_txns is None:
        mysql_txns = get_mysql_transactions_for_debug()

    google_ids = {t.get('MessageId'): t for t in google_txns if 'MessageId' in t}
    mysql_ids = {t['MessageId']: t for t in mysql_txns}

    return {
        'google_count': len(google_ids),
        'mysql_count': len(mysql_ids),
        'new_in_google': list(set(google_ids.keys()) - set(mysql_ids.keys())),
        'missing_in_google': list(set(mysql_ids.keys()) - set(google_ids.keys())),
        'in_both': list(set(google_ids.keys()) & set(mysql_ids.keys())),
    }


def show_member_diff(member_id: str, google_members: Optional[List[Dict]] = None,
                     mysql_members: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """Show field-by-field differences for a specific member."""
    if google_members is None:
        google_members = get_google_members_for_debug()
    if mysql_members is None:
        mysql_members = get_mysql_members_for_debug()

    google_by_id = {m.get('MemberID'): m for m in google_members}
    mysql_by_id = {m['MemberID']: m for m in mysql_members}

    google_member = google_by_id.get(member_id, {})
    mysql_member = mysql_by_id.get(member_id, {})

    if not google_member and not mysql_member:
        return {'error': f'Member {member_id} not found in Google or MySQL'}

    diffs = {}
    all_fields = set(list(google_member.keys()) + list(mysql_member.keys()))

    for field in sorted(all_fields):
        g_val = google_member.get(field)
        m_val = mysql_member.get(field)
        if str(g_val) != str(m_val):
            diffs[field] = {
                'google': g_val,
                'mysql': m_val,
                'match': False
            }
        else:
            diffs[field] = {
                'value': g_val,
                'match': True
            }

    return {
        'member_id': member_id,
        'in_google': member_id in google_by_id,
        'in_mysql': member_id in mysql_by_id,
        'fields': diffs,
        'google_only_fields': list(set(google_member.keys()) - set(mysql_member.keys())),
        'mysql_only_fields': list(set(mysql_member.keys()) - set(google_member.keys())),
    }


def show_event_diff(event_id: str, google_events: Optional[List[Dict]] = None,
                    mysql_events: Optional[List[Dict]] = None) -> Dict[str, Any]:
    """Show field-by-field differences for a specific event."""
    if google_events is None:
        google_events = get_google_events_for_debug()
    if mysql_events is None:
        mysql_events = get_mysql_events_for_debug()

    google_by_id = {e.get('EventID'): e for e in google_events}
    mysql_by_id = {e['EventID']: e for e in mysql_events}

    google_event = google_by_id.get(event_id, {})
    mysql_event = mysql_by_id.get(event_id, {})

    if not google_event and not mysql_event:
        return {'error': f'Event {event_id} not found in Google or MySQL'}

    diffs = {}
    all_fields = set(list(google_event.keys()) + list(mysql_event.keys()))

    for field in sorted(all_fields):
        g_val = google_event.get(field)
        m_val = mysql_event.get(field)
        if str(g_val) != str(m_val):
            diffs[field] = {
                'google': g_val,
                'mysql': m_val,
                'match': False
            }
        else:
            diffs[field] = {
                'value': g_val,
                'match': True
            }

    return {
        'event_id': event_id,
        'in_google': event_id in google_by_id,
        'in_mysql': event_id in mysql_by_id,
        'fields': diffs,
        'google_only_fields': list(set(google_event.keys()) - set(mysql_event.keys())),
        'mysql_only_fields': list(set(mysql_event.keys()) - set(google_event.keys())),
    }
