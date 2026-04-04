"""
Membership renewal audit routes for mmr-admin.

Blueprint: audit_bp
Prefix: /api/audit

Implements membership renewal audit workflow:
  1. Admin specifies date range and target expiration date
  2. Find transactions matching membership fee amounts
  3. Trace transaction through members, payments, submissions tables
  4. Verify expiration dates match target date
  5. Generate audit report with trace routes and red flags
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, date
from flask import Blueprint, request

from auth import login_required, require_role
from db import query, execute
from helpers import json_response, handle_api_errors
from config_cache import get_config

logger = logging.getLogger(__name__)

audit_bp = Blueprint('audit', __name__)


# ─────────────────────────────────────────────────────────────────────────
# Helper: Convert date objects to ISO strings for JSON serialization
# ─────────────────────────────────────────────────────────────────────────

def _serialize_for_json(obj):
    """Convert date objects in dict/list to ISO format strings."""
    if isinstance(obj, dict):
        return {k: _serialize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [_serialize_for_json(item) for item in obj]
    elif isinstance(obj, date) and not isinstance(obj, datetime):
        return obj.isoformat()
    elif isinstance(obj, datetime):
        return obj.isoformat()
    return obj


# ---------------------------------------------------------------------------
# Unmatch Transaction Endpoint
# ---------------------------------------------------------------------------

@audit_bp.route('/api/audit/unmatch', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_unmatch_transaction():
    """
    Reset a gmail_transaction to unprocessed state.

    Request body:
      {
        "message_id": "19cb3da76e6b20b4"
      }

    Updates:
      - ProcessedTime = NULL
      - PaymentID = NULL
    """
    data = request.get_json(silent=True)
    if isinstance(data, str):
        data = json.loads(data)

    if not isinstance(data, dict):
        return json_response({'error': 'Invalid JSON payload'}, 400)

    message_id = data.get('message_id', '').strip()
    if not message_id:
        return json_response({'error': 'Missing message_id'}, 400)

    try:
        sql = """
            UPDATE gmail_transactions
            SET ProcessedTime = NULL, PaymentID = NULL
            WHERE MessageId = %s
        """
        execute(sql, [message_id])
        logger.info(f"Unmatched transaction: {message_id}")

        return json_response({
            'success': True,
            'message': f'Transaction {message_id} unmatched',
            'message_id': message_id
        })
    except Exception as e:
        logger.error(f"Error unmatching transaction {message_id}: {e}")
        raise


# ---------------------------------------------------------------------------
# Config Endpoint
# ---------------------------------------------------------------------------

@audit_bp.route('/api/config/get')
@handle_api_errors
def api_get_config():
    """Get a config value by key."""
    key = request.args.get('key', '')
    if not key:
        return json_response({'error': 'Missing key parameter'}, 400)

    value = get_config(key, None)
    return json_response({
        'success': True,
        'key': key,
        'value': value
    })


# ---------------------------------------------------------------------------
# Renewal Audit Endpoint
# ---------------------------------------------------------------------------

@audit_bp.route('/api/audit/renewal', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_renewal_audit():
    """
    Run membership renewal audit.

    Request body:
      {
        "start_date": "2026-03-01",      # Transaction search start
        "end_date": "2026-03-31",        # Transaction search end
        "target_expiration": "2027-03-31" # Expected member expiration
      }

    Returns:
      {
        "success": true,
        "audit_results": [...],
        "summary": {...}
      }
    """
    logger.info("=== Audit: Start renewal audit ===")

    try:
        # Try multiple ways to get the JSON data
        data = request.get_json(silent=True)
        logger.info(f"Step 1 - get_json() returned type: {type(data)}")

        # If get_json() returned a string, parse it
        if isinstance(data, str):
            logger.warning(f"get_json() returned string, parsing manually")
            data = json.loads(data)
            logger.info(f"Step 2 - manual parse returned type: {type(data)}")

        # If still not a dict, try parsing request body
        if not isinstance(data, dict):
            logger.warning(f"Still not dict after parsing, trying request.data")
            try:
                body = request.get_data(as_text=True)
                logger.info(f"Request body: {body}")
                if body:
                    data = json.loads(body)
                    logger.info(f"Step 3 - parsed request.data returned type: {type(data)}")
            except Exception as e:
                logger.error(f"Failed to parse request.data: {e}")

        # Final validation
        if not isinstance(data, dict):
            logger.error(f"Expected dict, got {type(data)}: {data}")
            return json_response({'error': f'Invalid JSON payload (expected object, got {type(data).__name__}). Raw: {data}'}, 400)

        start_date = data.get('start_date')
        end_date = data.get('end_date')
        target_expiration = data.get('target_expiration')

        # Validate inputs
        if not all([start_date, end_date, target_expiration]):
            msg = f"Missing required fields: start_date={start_date}, end_date={end_date}, target_expiration={target_expiration}"
            logger.warning(msg)
            return json_response({'error': msg}, 400)

        logger.info(f"Audit parameters: start={start_date}, end={end_date}, target_exp={target_expiration}")

        # Parse dates
        try:
            start_date = datetime.strptime(start_date, '%Y-%m-%d').date()
            end_date = datetime.strptime(end_date, '%Y-%m-%d').date()
            target_expiration = datetime.strptime(target_expiration, '%Y-%m-%d').date()
            logger.info(f"Parsed dates: start={start_date}, end={end_date}, target_exp={target_expiration}")
        except ValueError as e:
            msg = f"Invalid date format (use YYYY-MM-DD): {e}"
            logger.error(msg)
            return json_response({'error': msg}, 400)

        # Get membership fee amounts from config
        try:
            individual_fee_str = get_config('MembershipFeeIndividual', '30.00')
            family_fee_str = get_config('MembershipFeeFamily', '50.00')
            logger.info(f"Config fees: individual={individual_fee_str}, family={family_fee_str}")

            individual_fee = float(individual_fee_str) if individual_fee_str else 30.00
            family_fee = float(family_fee_str) if family_fee_str else 50.00
            logger.info(f"Parsed fees: individual={individual_fee}, family={family_fee}")
        except (ValueError, TypeError) as e:
            logger.warning(f"Error parsing config fees, using defaults: {e}")
            individual_fee = 30.00
            family_fee = 50.00

        # Run the audit
        logger.info("Running audit...")
        audit_results = _run_renewal_audit(
            start_date, end_date, target_expiration,
            individual_fee, family_fee
        )

        logger.info(f"Audit complete: {audit_results['summary']['total_transactions']} transactions found")

        # Serialize dates to ISO format for JSON response
        serialized = _serialize_for_json({
            'success': True,
            'audit_results': audit_results['entries'],
            'summary': audit_results['summary']
        })

        logger.info("=== Audit: Success ===")
        return json_response(serialized)

    except Exception as e:
        logger.error(f"Audit error: {type(e).__name__}: {e}", exc_info=True)
        raise


# ---------------------------------------------------------------------------
# Core Audit Logic
# ---------------------------------------------------------------------------

def _run_renewal_audit(start_date: date, end_date: date, target_expiration: date,
                       individual_fee: float, family_fee: float) -> dict:
    """
    Run the audit: find transactions, trace them, verify expirations.

    Returns:
      {
        'entries': [...],  # audit results
        'summary': {...}   # counts
      }
    """

    # Find all transactions in the date range matching the fee amounts
    transactions = _get_matching_transactions(start_date, end_date, individual_fee, family_fee)

    audit_entries = []
    total_traced = 0
    total_matched = 0
    total_mismatched = 0
    not_traced = 0

    for txn in transactions:
        entry = _audit_transaction(txn, target_expiration)
        audit_entries.append(entry)

        # Track statistics
        if entry['trace_route'] and entry['trace_route'] != 'NOT TRACED':
            total_traced += 1
            if entry['match_status'] == '✓ MATCH':
                total_matched += 1
            elif entry['match_status'] == '✗ MISMATCH':
                total_mismatched += 1
        else:
            not_traced += 1

    return {
        'entries': audit_entries,
        'summary': {
            'total_transactions': len(transactions),
            'traced_members': total_traced,
            'expirations_matched': total_matched,
            'expirations_mismatched': total_mismatched,
            'not_traced': not_traced
        }
    }


def _get_matching_transactions(start_date: date, end_date: date,
                               individual_fee: float, family_fee: float) -> list:
    """
    Find all gmail_transactions in date range matching membership fee amounts.

    Returns list of transaction rows with all needed fields.
    """
    sql = """
        SELECT
            MessageId, Amount, TransactionDate, TransactionNumber,
            Sender, Subject, OriginalMemo, Memo
        FROM gmail_transactions
        WHERE
            TransactionDate BETWEEN %s AND %s
            AND Amount IN (%s, %s)
        ORDER BY TransactionDate DESC, MessageId
    """

    try:
        rows = query(sql, [start_date, end_date, individual_fee, family_fee])
        logger.info(f"Found {len(rows) if rows else 0} matching transactions")

        # Validate that rows are dictionaries
        if rows:
            for row in rows:
                if not isinstance(row, dict):
                    logger.error(f"Query returned non-dict row: {type(row)} = {row}")
                    raise TypeError(f"Expected dict, got {type(row)}: {row}")

        return rows if rows else []
    except Exception as e:
        logger.error(f"Error querying matching transactions: {e}")
        raise


def _audit_transaction(txn: dict, target_expiration: date) -> dict:
    """
    Audit a single transaction: trace it and verify expiration.

    Returns audit entry with trace route and red flags.
    """
    # Safely extract transaction fields with defaults
    try:
        message_id = txn.get('MessageId', '')
        amount = float(txn.get('Amount', 0)) if txn.get('Amount') else None
        txn_date = txn.get('TransactionDate')
        txn_number = txn.get('TransactionNumber', '')
        sender = txn.get('Sender', '')
        memo = txn.get('Memo', '') or txn.get('OriginalMemo', '')
    except (KeyError, ValueError, TypeError) as e:
        logger.error(f"Error extracting transaction fields: {e}")
        return {
            'transaction_id': 'unknown',
            'amount': None,
            'transaction_date': None,
            'member_id': None,
            'member_name': None,
            'membership_type': None,
            'sender': '',
            'memo': '',
            'trace_route': 'ERROR',
            'expiration_date': None,
            'target_expiration': target_expiration.isoformat(),
            'match_status': '❌ ERROR',
            'family_check': None,
            'red_flags': [f'Failed to parse transaction: {str(e)}']
        }

    # Prepare result structure
    result = {
        'transaction_id': message_id,
        'amount': amount,
        'transaction_date': txn_date.isoformat() if isinstance(txn_date, date) else txn_date,
        'member_id': None,
        'member_name': None,
        'membership_type': None,
        'sender': sender,
        'memo': memo,
        'trace_route': None,
        'expiration_date': None,
        'target_expiration': target_expiration.isoformat(),
        'match_status': None,
        'family_check': None,
        'red_flags': []
    }

    # Try trace paths in order of preference

    # PATH 1: gmail_transactions → TransactionNumber → members.PaymentTransaction
    if txn_number:
        trace = _trace_via_txn_number(txn_number, message_id)
        if trace:
            result.update(trace)
            result['trace_route'] = 'gmail_transactions → TransactionNumber → members'
            return _verify_expiration(result, target_expiration)

    # PATH 2: gmail_transactions → TransactionNumber → payments → members
    if txn_number:
        trace = _trace_via_payments_txn(txn_number, message_id)
        if trace:
            result.update(trace)
            result['trace_route'] = 'gmail_transactions → payments.TransactionReference → members'
            return _verify_expiration(result, target_expiration)

    # PATH 3: gmail_transactions → MessageId → submissions → members
    trace = _trace_via_submissions(message_id)
    if trace:
        result.update(trace)
        result['trace_route'] = 'gmail_transactions → MatchedMessageId → submissions → members'
        return _verify_expiration(result, target_expiration)

    # No trace found
    result['trace_route'] = 'NOT TRACED'
    result['red_flags'] = ['No matching member/payment found']
    result['match_status'] = '⚠ NOT TRACED'

    return result


def _trace_via_paymentid(payment_id: str, message_id: str) -> dict | None:
    """
    Trace: payments.PaymentID → payments.MemberID → members
    """
    sql = """
        SELECT
            p.MemberID, p.Amount, p.PaymentDate,
            m.FirstName, m.LastName, m.Type, m.FamilyID, m.Expiration
        FROM payments p
        LEFT JOIN members m ON p.MemberID = m.MemberID
        WHERE p.PaymentID = %s
    """

    rows = query(sql, [payment_id])
    if not rows:
        return None

    row = rows[0]
    member_id = row['MemberID']
    if not member_id:
        return None

    return {
        'member_id': member_id,
        'member_name': f"{row['FirstName']} {row['LastName']}" if row['FirstName'] else None,
        'membership_type': row['Type'],
        'expiration_date': row['Expiration'].isoformat() if row['Expiration'] else None
    }


def _trace_via_txn_number(txn_number: str, message_id: str) -> dict | None:
    """
    Trace: members.PaymentTransaction = TransactionNumber
    """
    sql = """
        SELECT
            MemberID, FirstName, LastName, Type, FamilyID, Expiration
        FROM members
        WHERE PaymentTransaction = %s
        LIMIT 1
    """

    rows = query(sql, [txn_number])
    if not rows:
        return None

    row = rows[0]
    return {
        'member_id': row['MemberID'],
        'member_name': f"{row['FirstName']} {row['LastName']}",
        'membership_type': row['Type'],
        'expiration_date': row['Expiration'].isoformat() if row['Expiration'] else None
    }


def _trace_via_payments_txn(txn_number: str, message_id: str) -> dict | None:
    """
    Trace: payments.TransactionReference → payments.MemberID → members
    """
    sql = """
        SELECT
            p.MemberID, p.Amount, p.PaymentDate,
            m.FirstName, m.LastName, m.Type, m.FamilyID, m.Expiration
        FROM payments p
        LEFT JOIN members m ON p.MemberID = m.MemberID
        WHERE p.TransactionReference = %s
    """

    rows = query(sql, [txn_number])
    if not rows:
        return None

    row = rows[0]
    member_id = row['MemberID']
    if not member_id:
        return None

    return {
        'member_id': member_id,
        'member_name': f"{row['FirstName']} {row['LastName']}" if row['FirstName'] else None,
        'membership_type': row['Type'],
        'expiration_date': row['Expiration'].isoformat() if row['Expiration'] else None
    }


def _trace_via_submissions(message_id: str) -> dict | None:
    """
    Trace: submissions.MatchedMessageId → submissions.MemberID → members
    """
    sql = """
        SELECT
            w.MemberID, w.Amount, w.PaymentDate, w.MatchedTransactionNumber,
            m.FirstName, m.LastName, m.Type, m.FamilyID, m.Expiration
        FROM submissions w
        LEFT JOIN members m ON w.MemberID = m.MemberID
        WHERE w.MatchedMessageId = %s
        LIMIT 1
    """

    rows = query(sql, [message_id])
    if not rows:
        return None

    row = rows[0]
    member_id = row['MemberID']
    if not member_id:
        return None

    return {
        'member_id': member_id,
        'member_name': f"{row['FirstName']} {row['LastName']}" if row['FirstName'] else None,
        'membership_type': row['Type'],
        'expiration_date': row['Expiration'].isoformat() if row['Expiration'] else None
    }


def _verify_expiration(entry: dict, target_expiration: date) -> dict:
    """
    Verify member expiration matches target and check family consistency.
    Adds match_status and red_flags to entry.
    """
    member_id = entry['member_id']
    member_expiration = entry['expiration_date']
    target_iso = target_expiration.isoformat()

    # Check if expiration matches target
    if not member_expiration:
        entry['match_status'] = '✗ NO EXPIRATION'
        entry['red_flags'].append('Member has no expiration date set')
        return entry

    if member_expiration != target_iso:
        entry['match_status'] = '✗ MISMATCH'
        entry['red_flags'].append(
            f"Expiration mismatch: {member_expiration} ≠ {target_iso}"
        )
    else:
        entry['match_status'] = '✓ MATCH'

    # For family members, check all family members have same expiration
    if entry['membership_type'] == 'Family':
        family_check = _check_family_consistency(member_id, member_expiration)
        entry['family_check'] = family_check

        if not family_check['all_consistent']:
            entry['red_flags'].append(
                f"Family inconsistency: {len(family_check['inconsistent'])} members differ"
            )

    return entry


def _check_family_consistency(member_id: str, expected_expiration: str) -> dict:
    """
    For a family member, check if all family members have the same expiration.

    Returns:
      {
        'all_consistent': bool,
        'family_members': [...],  # All family members
        'inconsistent': [...]     # Members with different expiration
      }
    """
    # Get the member's FamilyID
    sql = "SELECT FamilyID FROM members WHERE MemberID = %s"
    rows = query(sql, [member_id])
    if not rows or not rows[0]['FamilyID']:
        return {
            'all_consistent': True,
            'family_members': [member_id],
            'inconsistent': []
        }

    family_id = rows[0]['FamilyID']

    # Get all family members
    sql = """
        SELECT MemberID, FirstName, LastName, Expiration
        FROM members
        WHERE FamilyID = %s
        ORDER BY MemberID
    """

    family_members = query(sql, [family_id])
    family_list = []
    inconsistent = []

    for member in family_members:
        member_exp = member['Expiration'].isoformat() if member['Expiration'] else None
        member_info = {
            'member_id': member['MemberID'],
            'name': f"{member['FirstName']} {member['LastName']}",
            'expiration': member_exp
        }
        family_list.append(member_info)

        if member_exp != expected_expiration:
            inconsistent.append(member_info)

    return {
        'all_consistent': len(inconsistent) == 0,
        'family_members': family_list,
        'inconsistent': inconsistent
    }
