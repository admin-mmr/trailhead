"""
Google Sheets Diagnostic Functions for MMR Admin

Provides diagnostic functions to read and update data in Google Sheets.
Uses the GAS webhook to communicate with Google Apps Script.
This is a leaf module — it only imports db and standard library.

Read helpers live here; write/compare helpers live in api_sheets_write.py and
the GAS webhook transport in api_sheets_gas.py. Both are re-exported below so
existing `from api_sheets_diags import ...` call sites keep working.
"""

from __future__ import annotations

import traceback
from datetime import datetime

from api_sheets_gas import _call_gas_webhook
# Re-exported for backward compatibility (see diagnostics.py).
from api_sheets_write import (
    update_sheets_members,
    update_sheets_payments,
    update_sheets_events,
    compare_sheets_vs_db,
)


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
