"""
Google Sheets Diagnostic Functions for MMR Admin

Provides diagnostic functions to read and update data in Google Sheets.
Uses the GAS webhook to communicate with Google Apps Script.
This is a leaf module — it only imports db and standard library.
"""

from __future__ import annotations

import traceback
from datetime import datetime
from typing import Dict, List, Any
import db as dbmod


def _get_config_value(key: str, default: str = '') -> str:
    """Get a single config value from MySQL Config table."""
    try:
        rows = dbmod.query("SELECT ConfigValue FROM Config WHERE ConfigKey = %s", [key])
        return rows[0]['ConfigValue'] if rows else default
    except Exception:
        return default


def _call_gas_webhook(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Call the Google Apps Script webhook to fetch/push Sheets data.

    Args:
        payload: {action: str, ...}

    Returns:
        Response data or empty dict on error
    """
    try:
        import requests

        webhook_url = _get_config_value('SheetsWebhookUrl', '')
        if not webhook_url:
            raise ValueError("SheetsWebhookUrl not configured in Config table")

        max_retries = 3
        timeout = 60

        for attempt in range(max_retries):
            try:
                resp = requests.post(webhook_url, json=payload, timeout=timeout)
                if resp.status_code != 200:
                    raise Exception(f"HTTP {resp.status_code}: {resp.text[:500]}")

                body = resp.json()
                if not body.get('ok'):
                    raise Exception(f"GAS error: {body.get('error', 'unknown')}")

                return body.get('data', {})
            except requests.exceptions.Timeout:
                if attempt < max_retries - 1:
                    continue
                raise

        return {}
    except Exception as e:
        raise


def get_sheets_members(limit: int = 50):
    """Read recent members from Google Sheets."""
    debug = {'queries': []}
    try:
        data = _call_gas_webhook({'action': 'get_members'})

        # Ensure data is a list
        members = data if isinstance(data, list) else []

        # Limit results
        members = members[:limit] if limit else members

        debug['queries'].append(f"✓ Fetched {len(members)} members from Google Sheets")
        debug['row_count'] = len(members)
        debug['sample_columns'] = [
            'MemberID', 'FirstName', 'LastName', 'Email', 'Phone',
            'MembershipStatus', 'MembershipExpiry', 'JoinDate'
        ] if members else []

        return {
            'status': 'ok',
            'function': 'get_sheets_members',
            'rows': members[:limit],
            'total_count': len(members),
            'debug': debug,
            'executed_at': datetime.utcnow().isoformat(),
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'debug': debug,
            'function': 'get_sheets_members',
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat(),
        }


def get_sheets_payments(limit: int = 50):
    """Read recent payments from Google Sheets."""
    debug = {'queries': []}
    try:
        data = _call_gas_webhook({'action': 'get_payments'})

        # Ensure data is a list
        payments = data if isinstance(data, list) else []

        # Limit results
        payments = payments[:limit] if limit else payments

        debug['queries'].append(f"✓ Fetched {len(payments)} payments from Google Sheets")
        debug['row_count'] = len(payments)
        debug['sample_columns'] = [
            'PaymentID', 'MemberID', 'Amount', 'PaymentDate',
            'PaymentMethod', 'PayerName', 'TransactionReference'
        ] if payments else []

        return {
            'status': 'ok',
            'function': 'get_sheets_payments',
            'rows': payments[:limit],
            'total_count': len(payments),
            'debug': debug,
            'executed_at': datetime.utcnow().isoformat(),
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'debug': debug,
            'function': 'get_sheets_payments',
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat(),
        }


def get_sheets_events(limit: int = 50):
    """Read recent webapp_events from Google Sheets."""
    debug = {'queries': []}
    try:
        data = _call_gas_webhook({'action': 'get_events'})

        # Ensure data is a list
        events = data if isinstance(data, list) else []

        # Limit results
        events = events[:limit] if limit else events

        debug['queries'].append(f"✓ Fetched {len(events)} events from Google Sheets")
        debug['row_count'] = len(events)
        debug['sample_columns'] = [
            'EventID', 'EventName', 'EventDate', 'Location',
            'MemberID', 'BibNumber', 'RegistrationDate'
        ] if events else []

        return {
            'status': 'ok',
            'function': 'get_sheets_events',
            'rows': events[:limit],
            'total_count': len(events),
            'debug': debug,
            'executed_at': datetime.utcnow().isoformat(),
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'debug': debug,
            'function': 'get_sheets_events',
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat(),
        }


def get_sheets_transactions(limit: int = 50):
    """Read recent transactions from Google Sheets (from email imports)."""
    debug = {'queries': []}
    try:
        data = _call_gas_webhook({'action': 'get_transactions'})

        # Ensure data is a list
        transactions = data if isinstance(data, list) else []

        # Limit results
        transactions = transactions[:limit] if limit else transactions

        debug['queries'].append(f"✓ Fetched {len(transactions)} transactions from Google Sheets")
        debug['row_count'] = len(transactions)
        debug['sample_columns'] = [
            'MessageId', 'TimeStamp', 'Sender', 'Amount',
            'TransactionNumber', 'Subject'
        ] if transactions else []

        return {
            'status': 'ok',
            'function': 'get_sheets_transactions',
            'rows': transactions[:limit],
            'total_count': len(transactions),
            'debug': debug,
            'executed_at': datetime.utcnow().isoformat(),
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'debug': debug,
            'function': 'get_sheets_transactions',
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat(),
        }


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
