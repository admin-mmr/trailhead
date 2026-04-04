"""
Payment Reconciliation API — MySQL-backed, no Sheets sync.

Blueprint: payments_bp
Prefix: /api/payments

Dashboard, listing, autoguess, manual approval, and admin operations.

Flow:
  1. Dashboard: Counts (pending submissions, unmatched gmail_transactions, approved/rejected/errors)
  2. List endpoints:
     - /pending-submissions: pending submissions needing payment match
     - /unmatched-gmail: gmail_transactions with Notes=NULL or UpdatedAt=NULL
  3. Autoguess: Scan unmatched gmail → check membership renew logic → attempt match
  4. Manual approval: Admin selects memberID + gmail_transaction → create payment
  5. DB triggers handle: member status updates, submission approvals, gmail Notes sync
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta
from decimal import Decimal
from flask import Blueprint, request, session

from auth import login_required, require_role
from db import query, execute
from helpers import json_response, handle_api_errors

logger = logging.getLogger(__name__)

payments_bp = Blueprint('payments', __name__)


# ============================================================================
# HELPERS: Member & Config Lookups
# ============================================================================

def get_member_by_id(member_id: str) -> dict | None:
    """Fetch member record by MemberID."""
    rows = query(
        "SELECT * FROM members WHERE MemberID = %s",
        (member_id,)
    )
    return rows[0] if rows else None


def get_pending_submissions_for_member(member_id: str) -> list[dict]:
    """Fetch pending submissions for a given memberID."""
    return query("""
        SELECT * FROM submissions
        WHERE MemberID = %s AND Status = 'pending'
        ORDER BY CreatedAt DESC
    """, (member_id,))


def get_config(key: str) -> str | None:
    """Fetch config value from config table."""
    rows = query("SELECT ConfigValue FROM config WHERE ConfigKey = %s", (key,))
    return rows[0]['ConfigValue'] if rows else None


def get_renewal_period():
    """Get renewal period (start, end) from config as (start_date, end_date)."""
    start = get_config('renewal_start_date')
    end = get_config('renewal_end_date')
    return start, end


def parse_member_id_from_memo(memo: str) -> str | None:
    """Extract memberID from memo (e.g., 'A0001', 'Member: A0001')."""
    if not memo:
        return None
    import re
    # Look for pattern like A0001, A0002, etc.
    match = re.search(r'\bA\d{4}\b', memo)
    return match.group(0) if match else None


def partial_name_match(submission_memberid: str, gmail_sender: str, gmail_memo: str) -> bool:
    """
    Check if pending submission's member name can be partially matched
    in Gmail sender or memo fields.
    """
    member = get_member_by_id(submission_memberid)
    if not member:
        return False

    name = f"{member['FirstName']} {member['LastName']}".lower()
    first_name = member['FirstName'].lower()
    last_name = member['LastName'].lower()

    sender_lower = (gmail_sender or "").lower()
    memo_lower = (gmail_memo or "").lower()

    # Exact name or first+last in sender/memo
    return (
        name in sender_lower or name in memo_lower or
        (first_name in sender_lower and last_name in sender_lower) or
        (first_name in memo_lower and last_name in memo_lower)
    )


def is_within_renewal_period(payment_date) -> bool:
    """Check if payment_date falls within renewal period from config."""
    start_str, end_str = get_renewal_period()
    if not start_str or not end_str:
        return False
    try:
        start = datetime.strptime(start_str, '%Y-%m-%d').date()
        end = datetime.strptime(end_str, '%Y-%m-%d').date()
        if isinstance(payment_date, str):
            payment_date = datetime.strptime(payment_date, '%Y-%m-%d').date()
        return start <= payment_date <= end
    except (ValueError, TypeError):
        return False


# ============================================================================
# DASHBOARD
# ============================================================================

@payments_bp.route('/dashboard', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_payments_dashboard():
    """Return counts for payments dashboard."""
    pending = query("SELECT COUNT(*) as cnt FROM submissions WHERE Status = 'pending'")
    matched = query("SELECT COUNT(*) as cnt FROM payments WHERE SubmissionID IS NOT NULL")
    unmatched_gmail = query("""
        SELECT COUNT(*) as cnt FROM gmail_transactions
        WHERE Notes IS NULL OR UpdatedAt IS NULL
    """)
    approved_30d = query("""
        SELECT COUNT(*) as cnt FROM submissions
        WHERE Status = 'approved' AND UpdatedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    """)
    rejected_30d = query("""
        SELECT COUNT(*) as cnt FROM submissions
        WHERE Status = 'cancelled' AND UpdatedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    """)
    errors = query("""
        SELECT COUNT(*) as cnt FROM error_context
        WHERE Status IN ('NEW', 'ACKNOWLEDGED') AND DetectedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
    """)

    return json_response({
        'pending': pending[0]['cnt'],
        'matched': matched[0]['cnt'],
        'unmatched_gmail': unmatched_gmail[0]['cnt'],
        'approved_30d': approved_30d[0]['cnt'],
        'rejected_30d': rejected_30d[0]['cnt'],
        'errors': errors[0]['cnt'],
    })


# ============================================================================
# LIST ENDPOINTS
# ============================================================================

@payments_bp.route('/pending-submissions', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_pending_submissions():
    """
    List all pending submissions.
    Query params: ?skip=0&limit=50&search=
    """
    skip = int(request.args.get('skip', 0))
    limit = int(request.args.get('limit', 50))
    search = request.args.get('search', '').strip()

    sql = """
        SELECT s.SubmissionID, s.MemberID, s.SubmissionType, s.Amount, s.CreatedAt,
               s.Status, s.ExpiresAt,
               m.FirstName, m.LastName, m.Email, m.Type as MemberType
        FROM submissions s
        JOIN members m ON s.MemberID = m.MemberID
        WHERE s.Status = 'pending'
    """
    params = []

    if search:
        sql += " AND (m.FirstName LIKE %s OR m.LastName LIKE %s OR m.Email LIKE %s OR s.MemberID LIKE %s)"
        params.extend([f"%{search}%"] * 4)

    sql += " ORDER BY s.CreatedAt DESC LIMIT %s OFFSET %s"
    params.extend([limit, skip])

    rows = query(sql, tuple(params))
    return json_response({'submissions': rows})


@payments_bp.route('/unmatched-gmail', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_unmatched_gmail():
    """
    List all unmatched Gmail transactions (Notes IS NULL or UpdatedAt IS NULL).
    Query params: ?skip=0&limit=50&search=
    """
    skip = int(request.args.get('skip', 0))
    limit = int(request.args.get('limit', 50))
    search = request.args.get('search', '').strip()

    sql = """
        SELECT TransactionNumber, Timestamp, Sender, Amount, Memo, TransactionDate,
               PaymentMethod, Notes, UpdatedAt
        FROM gmail_transactions
        WHERE (Notes IS NULL OR UpdatedAt IS NULL)
    """
    params = []

    if search:
        sql += " AND (Sender LIKE %s OR Memo LIKE %s OR TransactionNumber LIKE %s)"
        params.extend([f"%{search}%"] * 3)

    sql += " ORDER BY TransactionDate DESC LIMIT %s OFFSET %s"
    params.extend([limit, skip])

    rows = query(sql, tuple(params))
    return json_response({'transactions': rows})


# ============================================================================
# AUTOGUESS LOGIC
# ============================================================================

@payments_bp.route('/autoguess-all', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_autoguess_all():
    """
    Scan all unmatched Gmail transactions and attempt autoguess.

    Logic:
      1. If memberID in memo + amount matches ($30 individual, $50 family) +
         within renewal period + pending membership submission exists
         → create payment with submissionID
      2. If no memberID but pending submission member name matches sender/memo
         + amount matches → create payment with submissionID
      3. If no submission matches, create payment with just transactionNumber
    """
    unmatched = query("""
        SELECT TransactionNumber, Timestamp, Sender, Amount, Memo, TransactionDate,
               PaymentMethod, Notes
        FROM gmail_transactions
        WHERE Notes IS NULL OR UpdatedAt IS NULL
    """)

    created_count = 0
    skipped_count = 0
    errors = []

    for tx in unmatched:
        try:
            result = _autoguess_single_transaction(tx)
            if result['created']:
                created_count += 1
            else:
                skipped_count += 1
        except Exception as e:
            errors.append({'transactionNumber': tx['TransactionNumber'], 'error': str(e)})

    return json_response({
        'created': created_count,
        'skipped': skipped_count,
        'errors': errors,
    })


def _autoguess_single_transaction(tx: dict) -> dict:
    """
    Attempt to match a single unmatched Gmail transaction.
    Returns {'created': bool, 'reason': str}
    """
    tx_num = tx['TransactionNumber']
    sender = tx['Sender'] or ''
    memo = tx['Memo'] or ''
    amount = Decimal(str(tx['Amount'])) if tx['Amount'] else None
    tx_date = tx['TransactionDate']

    # Step 1: Try to extract memberID from memo
    member_id = parse_member_id_from_memo(memo)

    if member_id:
        member = get_member_by_id(member_id)
        if member:
            # Check amount matches renewal fee
            expected_amt = Decimal('50.00') if member['Type'] == 'Family' else Decimal('30.00')
            if amount != expected_amt:
                return {'created': False, 'reason': f'Amount mismatch: {amount} vs expected {expected_amt}'}

            # Check within renewal period
            if not is_within_renewal_period(tx_date):
                return {'created': False, 'reason': 'Outside renewal period'}

            # Check if pending membership submission exists
            pending_subs = query("""
                SELECT SubmissionID FROM submissions
                WHERE MemberID = %s AND Status = 'pending' AND SubmissionType LIKE '%Membership%'
                LIMIT 1
            """, (member_id,))

            if pending_subs:
                # Case 1a: Create payment with submissionID
                return _create_payment_from_autoguess(
                    tx_num, member_id, amount, tx_date, tx['PaymentMethod'],
                    sender, memo, 'Membership', 'admin_autoguess',
                    submission_id=pending_subs[0]['SubmissionID']
                )
            else:
                # Case 1b: Create payment without submissionID
                return _create_payment_from_autoguess(
                    tx_num, member_id, amount, tx_date, tx['PaymentMethod'],
                    sender, memo, 'Membership', 'admin_autoguess'
                )

    # Step 2: No memberID in memo; try to match by name
    pending_subs = query("""
        SELECT s.SubmissionID, s.MemberID FROM submissions s
        WHERE s.Status = 'pending' AND s.SubmissionType LIKE '%Membership%'
    """)

    for sub in pending_subs:
        member = get_member_by_id(sub['MemberID'])
        if not member:
            continue

        expected_amt = Decimal('50.00') if member['Type'] == 'Family' else Decimal('30.00')
        if amount != expected_amt:
            continue

        if not is_within_renewal_period(tx_date):
            continue

        # Partial name match
        if partial_name_match(sub['MemberID'], sender, memo):
            return _create_payment_from_autoguess(
                tx_num, sub['MemberID'], amount, tx_date, tx['PaymentMethod'],
                sender, memo, 'Membership', 'admin_autoguess',
                submission_id=sub['SubmissionID']
            )

    return {'created': False, 'reason': 'No match found'}


def _create_payment_from_autoguess(
    tx_num: str, member_id: str, amount: Decimal, payment_date,
    payment_method: str, payer_name: str, memo: str, payment_type: str,
    processed_by: str, submission_id: str | None = None
) -> dict:
    """Create a payment record and call sp_link_transaction."""
    payment_id = str(uuid.uuid4())

    try:
        execute("""
            CALL sp_link_transaction(%s, %s, %s, %s, %s, %s)
        """, (tx_num, member_id, payment_type, amount, processed_by, submission_id))

        return {'created': True, 'reason': f'Created payment {payment_id}'}
    except Exception as e:
        logger.error(f'Error creating payment for {tx_num}: {e}')
        raise


# ============================================================================
# MANUAL APPROVAL
# ============================================================================

@payments_bp.route('/manual-approve', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_manual_approve():
    """
    Admin approves a Gmail transaction by selecting memberID.

    Request body:
    {
      "transactionNumber": "tx_abc123",
      "memberID": "A0001"
    }

    Logic:
      1. Verify member exists
      2. Check if there are any pending submissions for this member
      3. If yes, link to first pending membership submission
      4. If no, create payment with blank submissionID
      5. Call sp_link_transaction to create payment + update gmail_transactions
    """
    data = request.json or {}
    tx_num = data.get('transactionNumber', '').strip()
    member_id = data.get('memberID', '').strip()

    if not tx_num or not member_id:
        return json_response({'error': 'Missing transactionNumber or memberID'}, status=400)

    # Fetch Gmail transaction
    tx_rows = query(
        "SELECT * FROM gmail_transactions WHERE TransactionNumber = %s",
        (tx_num,)
    )
    if not tx_rows:
        return json_response({'error': 'Gmail transaction not found'}, status=404)

    tx = tx_rows[0]

    # Verify member exists
    member = get_member_by_id(member_id)
    if not member:
        return json_response({'error': 'Member not found'}, status=404)

    # Check for pending membership submissions
    pending_subs = query("""
        SELECT SubmissionID FROM submissions
        WHERE MemberID = %s AND Status = 'pending' AND SubmissionType LIKE '%Membership%'
        ORDER BY CreatedAt DESC
        LIMIT 1
    """, (member_id,))

    submission_id = pending_subs[0]['SubmissionID'] if pending_subs else None
    admin_email = session.get('email', 'admin')

    try:
        execute("""
            CALL sp_link_transaction(%s, %s, %s, %s, %s, %s)
        """, (tx_num, member_id, 'Membership', tx['Amount'], admin_email, submission_id))

        return json_response({
            'ok': True,
            'transactionNumber': tx_num,
            'memberID': member_id,
            'submissionID': submission_id,
        })
    except Exception as e:
        logger.error(f'Error in manual_approve: {e}')
        return json_response({'error': str(e)}, status=500)


# ============================================================================
# SUBMISSION SEARCH & FILTERING
# ============================================================================

@payments_bp.route('/submissions-for-member/<member_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_submissions_for_member(member_id: str):
    """Get all pending submissions for a specific member."""
    subs = query("""
        SELECT SubmissionID, SubmissionType, Amount, Status, CreatedAt, ExpiresAt
        FROM submissions
        WHERE MemberID = %s AND Status = 'pending'
        ORDER BY CreatedAt DESC
    """, (member_id,))
    return json_response({'submissions': subs})


@payments_bp.route('/gmail-matching-candidates/<member_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_gmail_matching_candidates(member_id: str):
    """
    Get unmatched Gmail transactions that could match this member.
    Filters by partial name/email match and amount.
    """
    member = get_member_by_id(member_id)
    if not member:
        return json_response({'error': 'Member not found'}, status=404)

    first_name = member['FirstName']
    last_name = member['LastName']
    email = member['Email']

    candidates = query("""
        SELECT TransactionNumber, Timestamp, Sender, Amount, Memo, TransactionDate,
               PaymentMethod, Notes, UpdatedAt
        FROM gmail_transactions
        WHERE (Notes IS NULL OR UpdatedAt IS NULL)
          AND (Sender LIKE %s OR Sender LIKE %s OR Memo LIKE %s OR Memo LIKE %s)
        ORDER BY TransactionDate DESC
        LIMIT 20
    """, (f"%{first_name}%", f"%{last_name}%", f"%{first_name}%", f"%{last_name}%"))

    return json_response({'candidates': candidates})


# ============================================================================
# MEMBER SEARCH
# ============================================================================

@payments_bp.route('/search-members', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_search_members():
    """
    Search members by name, email, memberID, notes, wechat, etc.
    Query params: ?q=search_term&limit=30
    Supports multiple space-separated terms (AND logic).
    """
    q = request.args.get('q', '').strip()
    limit = int(request.args.get('limit', 30))

    if len(q) < 2:
        return json_response({'error': 'Search term too short'}, status=400)

    results = query(
        "CALL sp_search_members_advanced(%s, %s)",
        (q, limit)
    )

    return json_response({'members': results})
