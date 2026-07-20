"""
Google Sheets write + compare diagnostics (split from api_sheets_diags.py).

Push-side counterparts to the read helpers in api_sheets_diags.py:
  * update_sheets_members / update_sheets_payments / update_sheets_events
  * compare_sheets_vs_db  — row-count reconciliation against MySQL

Re-exported from api_sheets_diags.py so existing
`from api_sheets_diags import ...` call sites keep working. Pure move — SQL and
webhook behavior unchanged.
"""

from __future__ import annotations

import traceback
from datetime import datetime
from typing import Dict, List, Any

import db as dbmod
from api_sheets_gas import _call_gas_webhook


def update_sheets_members(rows: List[Dict[str, Any]]):
    """
    Update members in Google Sheets.

    Args:
        rows: List of member dicts with MemberID and fields to update

    Returns:
        Result with count of updated rows
    """
    debug = {'queries': []}
    try:
        if not rows:
            return {
                'status': 'warning',
                'function': 'update_sheets_members',
                'message': 'No rows provided',
                'debug': debug,
                'executed_at': datetime.utcnow().isoformat(),
            }

        data = _call_gas_webhook({'action': 'update_members', 'rows': rows})

        updated_count = data.get('updated', 0) if isinstance(data, dict) else 0
        debug['queries'].append(f"✓ Updated {updated_count} member rows in Google Sheets")

        return {
            'status': 'ok',
            'function': 'update_sheets_members',
            'rows_sent': len(rows),
            'rows_updated': updated_count,
            'debug': debug,
            'executed_at': datetime.utcnow().isoformat(),
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'debug': debug,
            'function': 'update_sheets_members',
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat(),
        }


def update_sheets_payments(rows: List[Dict[str, Any]]):
    """
    Update payments in Google Sheets.

    Args:
        rows: List of payment dicts with PaymentID and fields to update

    Returns:
        Result with count of updated rows
    """
    debug = {'queries': []}
    try:
        if not rows:
            return {
                'status': 'warning',
                'function': 'update_sheets_payments',
                'message': 'No rows provided',
                'debug': debug,
                'executed_at': datetime.utcnow().isoformat(),
            }

        data = _call_gas_webhook({'action': 'update_payments', 'rows': rows})

        updated_count = data.get('updated', 0) if isinstance(data, dict) else 0
        debug['queries'].append(f"✓ Updated {updated_count} payment rows in Google Sheets")

        return {
            'status': 'ok',
            'function': 'update_sheets_payments',
            'rows_sent': len(rows),
            'rows_updated': updated_count,
            'debug': debug,
            'executed_at': datetime.utcnow().isoformat(),
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'debug': debug,
            'function': 'update_sheets_payments',
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat(),
        }


def update_sheets_events(rows: List[Dict[str, Any]]):
    """
    Update events in Google Sheets.

    Args:
        rows: List of event dicts with EventID and fields to update

    Returns:
        Result with count of updated rows
    """
    debug = {'queries': []}
    try:
        if not rows:
            return {
                'status': 'warning',
                'function': 'update_sheets_events',
                'message': 'No rows provided',
                'debug': debug,
                'executed_at': datetime.utcnow().isoformat(),
            }

        data = _call_gas_webhook({'action': 'update_events', 'rows': rows})

        updated_count = data.get('updated', 0) if isinstance(data, dict) else 0
        debug['queries'].append(f"✓ Updated {updated_count} event rows in Google Sheets")

        return {
            'status': 'ok',
            'function': 'update_sheets_events',
            'rows_sent': len(rows),
            'rows_updated': updated_count,
            'debug': debug,
            'executed_at': datetime.utcnow().isoformat(),
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'debug': debug,
            'function': 'update_sheets_events',
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat(),
        }


def compare_sheets_vs_db():
    """
    Compare Google Sheets data against MySQL database for all major tables.
    Useful for spotting sync discrepancies.
    """
    debug = {'comparisons': [], 'summary': {}}
    try:
        # 1. Compare members
        sheets_members = _call_gas_webhook({'action': 'get_members'})
        sheets_members = sheets_members if isinstance(sheets_members, list) else []

        db_members_count = dbmod.query("SELECT COUNT(*) as cnt FROM members")
        db_members_count = db_members_count[0]['cnt'] if db_members_count else 0

        debug['comparisons'].append({
            'table': 'members',
            'sheets_count': len(sheets_members),
            'db_count': db_members_count,
            'status': '✓' if len(sheets_members) == db_members_count else '⚠',
        })

        # 2. Compare payments
        sheets_payments = _call_gas_webhook({'action': 'get_payments'})
        sheets_payments = sheets_payments if isinstance(sheets_payments, list) else []

        db_payments_count = dbmod.query("SELECT COUNT(*) as cnt FROM payments")
        db_payments_count = db_payments_count[0]['cnt'] if db_payments_count else 0

        debug['comparisons'].append({
            'table': 'payments',
            'sheets_count': len(sheets_payments),
            'db_count': db_payments_count,
            'status': '✓' if len(sheets_payments) == db_payments_count else '⚠',
        })

        # 3. Compare events
        sheets_events = _call_gas_webhook({'action': 'get_events'})
        sheets_events = sheets_events if isinstance(sheets_events, list) else []

        db_events_count = dbmod.query("SELECT COUNT(*) as cnt FROM webapp_events")
        db_events_count = db_events_count[0]['cnt'] if db_events_count else 0

        debug['comparisons'].append({
            'table': 'webapp_events',
            'sheets_count': len(sheets_events),
            'db_count': db_events_count,
            'status': '✓' if len(sheets_events) == db_events_count else '⚠',
        })

        # Summary
        all_synced = all(c['status'] == '✓' for c in debug['comparisons'])
        debug['summary']['overall_status'] = '✓ SYNCED' if all_synced else '⚠ OUT OF SYNC'
        debug['summary']['recommendation'] = (
            'All sheets are in sync with database.' if all_synced
            else 'Some discrepancies detected. Check individual tables.'
        )

        return {
            'status': 'ok',
            'function': 'compare_sheets_vs_db',
            'comparisons': debug['comparisons'],
            'summary': debug['summary'],
            'debug': debug,
            'executed_at': datetime.utcnow().isoformat(),
        }
    except Exception as e:
        debug['summary']['error'] = str(e)
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'debug': debug,
            'function': 'compare_sheets_vs_db',
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat(),
        }
