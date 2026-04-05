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


def build_member_text(member: dict) -> str:
    """
    Build searchable member text from member record.
    Format: "FirstName LastName WeChatID email_local NYRRRunnerName"
    """
    parts = [
        member.get('FirstName', ''),
        member.get('LastName', ''),
        member.get('WeChatID', ''),
    ]

    # Extract email local part (before @)
    email = member.get('Email', '')
    if email and '@' in email:
        parts.append(email.split('@')[0])

    # Add NYRR runner name if available
    if member.get('NYRRRunnerName'):
        parts.append(member['NYRRRunnerName'])

    # Join and normalize: lowercase, remove empty parts, single space separation
    text = ' '.join(p for p in parts if p).lower()
    return text


def build_transaction_text(gmail: dict) -> str:
    """
    Build searchable transaction text from Gmail transaction.
    Format: "Sender Memo Notes"
    """
    parts = [
        gmail.get('Sender', ''),
        gmail.get('Memo', ''),
        gmail.get('Notes', ''),
    ]
    text = ' '.join(p for p in parts if p).lower()
    return text


def fuzzy_match_transaction_to_member(gmail: dict, member: dict) -> tuple[bool, int]:
    """
    Fuzzy match a Gmail transaction to a member using 4 priority rules.

    Rules (in priority order):
    1. MemberID is substring of transaction text
    2. Last 4 digits of TransactionNumber match MemberID
    3. Every word in Sender is substring of member_text
    4. Any word in member_text is substring of transaction_text

    Returns: (matched: bool, priority: int)
      - priority 1 = rule 1, 2 = rule 2, 3 = rule 3, 4 = rule 4, 0 = no match
    """
    member_id = member.get('MemberID', '').upper()
    tx_number = gmail.get('TransactionNumber', '')
    sender = gmail.get('Sender', '').lower()
    memo = gmail.get('Memo', '').lower()
    notes = gmail.get('Notes', '').lower()

    member_text = build_member_text(member)
    tx_text = build_transaction_text(gmail)

    # Rule 1: MemberID is substring of transaction text
    if member_id and member_id.lower() in tx_text:
        return True, 1

    # Rule 2: Last 4 digits of TransactionNumber match MemberID (without A prefix)
    if tx_number and len(member_id) >= 2 and member_id[1:].isdigit():
        member_digits = member_id[1:]  # Remove 'A' prefix
        tx_last_4 = tx_number[-4:] if len(tx_number) >= 4 else tx_number
        if tx_last_4 == member_digits:
            return True, 2

    # Rule 3: Every word in Sender is substring of member_text
    if sender:
        sender_words = sender.split()
        if sender_words and all(word in member_text for word in sender_words):
            return True, 3

    # Rule 4: Any word in member_text is substring of transaction_text
    if member_text:
        member_words = member_text.split()
        if any(word in tx_text for word in member_words):
            return True, 4

    return False, 0


def find_best_matching_submission(gmail: dict, amount: Decimal) -> dict | None:
    """
    Find the best pending submission for a Gmail transaction using fuzzy matching.

    Returns: {submission_id, member_id, score} or None if no match found

    Algorithm:
      1. Get all pending membership submissions with matching amount
      2. For each submission's member, apply fuzzy_match_transaction_to_member
      3. Return submission with highest priority match (priority 1 > 2 > 3 > 4)
    """
    # Fetch pending submissions with matching amount
    pending_subs = query("""
        SELECT s.SubmissionID, s.MemberID, s.Amount
        FROM submissions s
        WHERE s.Status = 'pending' AND s.SubmissionType LIKE '%Membership%'
          AND s.Amount = %s
        ORDER BY s.CreatedAt DESC
    """, (amount,))

    best_match = None
    best_priority = 0

    for sub in pending_subs:
        member_id = sub['MemberID']
        member = get_member_by_id(member_id)
        if not member:
            continue

        matched, priority = fuzzy_match_transaction_to_member(gmail, member)
        if matched and priority > best_priority:
            best_match = {
                'submission_id': sub['SubmissionID'],
                'member_id': member_id,
                'priority': priority,
            }
            best_priority = priority

    return best_match


def fuzzy_select_transaction_to_submission(submission_id: str, max_candidates: int = 20) -> dict:
    """
    Find candidate Gmail transactions for a pending submission, ranked by fuzzy match score.

    Used in quick-approve UI to show admin a short list of transactions to choose from.

    Returns: {
      'submission': {SubmissionID, MemberID, Amount},
      'member': {MemberID, FirstName, LastName, Email, ...},
      'candidates': [
        {
          'TransactionNumber', 'Sender', 'Amount', 'Memo', 'TransactionDate',
          'priority': int (1-4, 0 if no match),
          'matched': bool
        },
        ...
      ]
    }

    Algorithm:
      1. Get submission + member
      2. Query unmatched Gmail transactions matching amount
      3. For each transaction, apply fuzzy_match_transaction_to_member
      4. Sort by priority (highest first), then by TransactionDate (newest first)
      5. Return top N candidates
    """
    # Get submission
    sub = query(
        "SELECT * FROM submissions WHERE SubmissionID = %s",
        (submission_id,)
    )
    if not sub or len(sub) == 0:
        return {'error': 'Submission not found', 'candidates': []}

    sub = sub[0]
    member_id = sub['MemberID']
    amount = sub['Amount']

    # Get member
    member = get_member_by_id(member_id)
    if not member:
        return {'error': f'Member {member_id} not found', 'candidates': []}

    # Get unmatched Gmail transactions matching amount
    candidates = query("""
        SELECT MessageId, TransactionNumber, Sender, Amount, Memo, TransactionDate,
               Notes, UpdatedAt, Timestamp
        FROM gmail_transactions
        WHERE (Notes IS NULL OR UpdatedAt IS NULL)
          AND Amount = %s
        ORDER BY TransactionDate DESC
        LIMIT 100
    """, (amount,))

    # Score each candidate using fuzzy matching
    scored_candidates = []
    for gmail in candidates:
        matched, priority = fuzzy_match_transaction_to_member(gmail, member)
        scored_candidates.append({
            'MessageId': gmail['MessageId'],
            'TransactionNumber': gmail['TransactionNumber'],
            'Sender': gmail['Sender'],
            'Amount': float(gmail['Amount']),
            'Memo': gmail['Memo'],
            'TransactionDate': gmail['TransactionDate'].isoformat() if gmail['TransactionDate'] else None,
            'Notes': gmail['Notes'],
            'priority': priority,
            'matched': matched,
        })

    # Sort by priority (descending), then by matched (True first), then by TransactionDate (newest first)
    scored_candidates.sort(
        key=lambda x: (x['priority'], x['matched'], x['TransactionDate']),
        reverse=True
    )

    # Return top N
    return {
        'submission': {
            'SubmissionID': sub['SubmissionID'],
            'MemberID': sub['MemberID'],
            'Amount': float(sub['Amount']),
        },
        'member': {
            'MemberID': member['MemberID'],
            'FirstName': member['FirstName'],
            'LastName': member['LastName'],
            'Email': member['Email'],
            'WeChatID': member.get('WeChatID'),
            'Type': member.get('Type'),
            'Expiration': member.get('Expiration'),
        },
        'candidates': scored_candidates[:max_candidates],
        'total_candidates': len(scored_candidates),
        'count': len(scored_candidates[:max_candidates]),
    }


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

@payments_bp.route('/api/payments/dashboard', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_payments_dashboard():
    """Return counts for payments dashboard."""
    logger.info('[DASHBOARD] Fetching payment dashboard stats...')

    try:
        pending = query("SELECT COUNT(*) as cnt FROM submissions WHERE Status = 'pending'")
        logger.info(f'[DASHBOARD] Pending submissions: {pending}')

        matched = query("SELECT COUNT(*) as cnt FROM payments WHERE SubmissionID IS NOT NULL")
        logger.info(f'[DASHBOARD] Matched payments: {matched}')

        unmatched_gmail = query("""
            SELECT COUNT(*) as cnt FROM gmail_transactions
            WHERE Notes IS NULL OR UpdatedAt IS NULL
        """)
        logger.info(f'[DASHBOARD] Unmatched gmail: {unmatched_gmail}')

        approved_30d = query("""
            SELECT COUNT(*) as cnt FROM submissions
            WHERE Status = 'approved' AND UpdatedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        """)
        logger.info(f'[DASHBOARD] Approved (30d): {approved_30d}')

        rejected_30d = query("""
            SELECT COUNT(*) as cnt FROM submissions
            WHERE Status = 'cancelled' AND UpdatedAt >= DATE_SUB(NOW(), INTERVAL 30 DAY)
        """)
        logger.info(f'[DASHBOARD] Rejected (30d): {rejected_30d}')

        errors = query("""
            SELECT COUNT(*) as cnt FROM error_context
            WHERE Status IN ('NEW', 'ACKNOWLEDGED') AND DetectedAt >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        """)
        logger.info(f'[DASHBOARD] Errors (7d): {errors}')

        result = {
            'ok': True,
            'pending': pending[0]['cnt'],
            'matched': matched[0]['cnt'],
            'unmatched_gmail': unmatched_gmail[0]['cnt'],
            'approved_30d': approved_30d[0]['cnt'],
            'rejected_30d': rejected_30d[0]['cnt'],
            'errors': errors[0]['cnt'],
        }
        logger.info(f'[DASHBOARD] Returning response: {result}')
        return json_response(result)
    except Exception as e:
        logger.exception(f'[DASHBOARD] Exception in dashboard endpoint: {e}')
        raise


# ============================================================================
# LIST ENDPOINTS
# ============================================================================

@payments_bp.route('/api/payments/pending-submissions', methods=['GET'])
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


@payments_bp.route('/api/payments/unmatched-gmail', methods=['GET'])
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

@payments_bp.route('/api/payments/autoguess-all', methods=['POST'])
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

    logger.info(f'[AUTOGUESS] Starting autoguess for {len(unmatched)} unmatched transactions')

    for tx in unmatched:
        try:
            result = _autoguess_single_transaction(tx)
            if result['created']:
                created_count += 1
                logger.info(f'[AUTOGUESS] Created payment for {tx["TransactionNumber"]}: {result["reason"]}')
            else:
                skipped_count += 1
                logger.debug(f'[AUTOGUESS] Skipped {tx["TransactionNumber"]}: {result["reason"]}')
        except Exception as e:
            logger.exception(f'[AUTOGUESS] Error processing {tx["TransactionNumber"]}: {e}')
            errors.append({'transactionNumber': tx['TransactionNumber'], 'error': str(e)})

    message = f'Autoguess complete: {created_count} payments created, {skipped_count} skipped'
    if errors:
        message += f', {len(errors)} errors'

    logger.info(f'[AUTOGUESS] {message}')

    return json_response({
        'ok': True,
        'message': message,
        'details': {
            'created': created_count,
            'skipped': skipped_count,
            'errors': errors,
        }
    })


def _autoguess_single_transaction(tx: dict) -> dict:
    """
    Strict autoguess: Only link if memberID is explicitly in memo AND all conditions met.

    Returns {'created': bool, 'reason': str}

    Algorithm (FIRM):
      1. Extract memberID from memo (regex: \bA\d{4}\b)
      2. If memberID not found: skip
      3. Verify member exists
      4. Check amount matches membership type ($30 individual, $50 family)
      5. Check transaction date within renewal period (from config)
      6. Check pending membership submission exists
      7. Create payment via sp_link_transaction
    """
    tx_num = tx['TransactionNumber']
    sender = tx['Sender'] or ''
    memo = tx['Memo'] or ''
    amount = Decimal(str(tx['Amount'])) if tx['Amount'] else None
    tx_date = tx['TransactionDate']

    if not amount:
        return {'created': False, 'reason': 'Invalid or missing amount'}

    # Step 1: Extract memberID from memo (REQUIRED)
    member_id = parse_member_id_from_memo(memo)
    if not member_id:
        return {'created': False, 'reason': 'No memberID found in memo'}

    # Step 2: Verify member exists
    member = get_member_by_id(member_id)
    if not member:
        return {'created': False, 'reason': f'Member {member_id} not found'}

    # Step 3: Check amount matches membership type
    expected_amt = Decimal('50.00') if member['Type'] == 'Family' else Decimal('30.00')
    if amount != expected_amt:
        return {'created': False, 'reason': f'Amount mismatch: {amount} vs {expected_amt} for {member["Type"]}'}

    # Step 4: Check within renewal period
    if not is_within_renewal_period(tx_date):
        return {'created': False, 'reason': f'Transaction date {tx_date} outside renewal period'}

    # Step 5: Check pending membership submission exists
    pending_subs = query("""
        SELECT SubmissionID FROM submissions
        WHERE MemberID = %s AND Status = 'pending' AND SubmissionType LIKE '%Membership%'
        LIMIT 1
    """, (member_id,))

    if not pending_subs or len(pending_subs) == 0:
        return {'created': False, 'reason': f'No pending membership submission for {member_id}'}

    submission_id = pending_subs[0]['SubmissionID']

    # Step 6: Create payment
    try:
        admin_email = session.get('user', {}).get('email', 'admin_autoguess')
        execute("""
            CALL sp_link_transaction(%s, %s, %s, %s, %s, %s)
        """, (tx_num, member_id, 'Membership', amount, admin_email, submission_id))

        logger.info(f'[AUTOGUESS] Created payment for {member_id} (strict match: memo={member_id}, amount={amount}, renewal OK)')
        return {'created': True, 'reason': f'Created payment for {member_id}'}
    except Exception as e:
        logger.exception(f'[AUTOGUESS] Error creating payment for {tx_num}: {e}')
        return {'created': False, 'reason': f'Error creating payment: {str(e)}'}


# ============================================================================
# MANUAL APPROVAL
# ============================================================================

@payments_bp.route('/api/payments/manual-approve', methods=['POST'])
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

    logger.info(f'[MANUAL-APPROVE] Approving tx={tx_num}, member={member_id}')

    # Fetch Gmail transaction
    tx_rows = query(
        "SELECT * FROM gmail_transactions WHERE TransactionNumber = %s",
        (tx_num,)
    )
    if not tx_rows:
        logger.warning(f'[MANUAL-APPROVE] Transaction not found: {tx_num}')
        return json_response({'error': 'Gmail transaction not found'}, status=404)

    tx = tx_rows[0]

    # Verify member exists
    member = get_member_by_id(member_id)
    if not member:
        logger.warning(f'[MANUAL-APPROVE] Member not found: {member_id}')
        return json_response({'error': 'Member not found'}, status=404)

    # Check for pending membership submissions
    pending_subs = query("""
        SELECT SubmissionID FROM submissions
        WHERE MemberID = %s AND Status = 'pending' AND SubmissionType LIKE '%Membership%'
        ORDER BY CreatedAt DESC
        LIMIT 1
    """, (member_id,))

    submission_id = pending_subs[0]['SubmissionID'] if pending_subs else None
    admin_email = session.get('user', {}).get('email', 'admin')

    logger.info(f'[MANUAL-APPROVE] Linking transaction: amount={tx["Amount"]}, submissionID={submission_id}, admin={admin_email}')

    try:
        execute("""
            CALL sp_link_transaction(%s, %s, %s, %s, %s, %s)
        """, (tx_num, member_id, 'Membership', tx['Amount'], admin_email, submission_id))

        logger.info(f'[MANUAL-APPROVE] Success: tx={tx_num}, member={member_id}, submission={submission_id}')
        return json_response({
            'ok': True,
            'message': f'Payment approved for {member["FirstName"]} {member["LastName"]}',
            'transactionNumber': tx_num,
            'memberID': member_id,
            'submissionID': submission_id,
        })
    except Exception as e:
        logger.exception(f'[MANUAL-APPROVE] Error: {e}')
        return json_response({'error': str(e)}, status=500)


# ============================================================================
# SUBMISSION SEARCH & FILTERING
# ============================================================================

@payments_bp.route('/api/payments/submissions-for-member/<member_id>', methods=['GET'])
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


@payments_bp.route('/api/payments/gmail-matching-candidates/<member_id>', methods=['GET'])
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

    return json_response({'transactions': candidates})


# ============================================================================
# MISSING ENDPOINTS FOR FRONTEND
# ============================================================================

@payments_bp.route('/api/payments/member-quick/<member_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_member_quick(member_id: str):
    """
    Quick member lookup for tooltips and quick-approve popover.
    Returns: {FirstName, LastName, MemberID, Email, Expiration, Type, Gender, District, WeChatID}
    """
    member = get_member_by_id(member_id.upper())
    if not member:
        return json_response({'error': 'Member not found'}, status=404)

    return json_response({
        'MemberID': member.get('MemberID'),
        'FirstName': member.get('FirstName'),
        'LastName': member.get('LastName'),
        'Email': member.get('Email'),
        'Expiration': member.get('Expiration'),
        'Type': member.get('Type'),
        'Gender': member.get('Gender'),
        'District': member.get('District'),
        'WeChatID': member.get('WeChatID'),
    })


@payments_bp.route('/api/payments/member-quick/all', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_member_quick_all():
    """
    Fetch all members for fuzzy search in quick-approve popover.
    Returns: [{MemberID, FirstName, LastName, Email, Expiration, Type, District}]
    """
    members = query("""
        SELECT MemberID, FirstName, LastName, Email, Expiration, Type, District
        FROM members
        ORDER BY FirstName, LastName
    """)
    return json_response({'data': members})


@payments_bp.route('/api/payments/gmail-candidates/<submission_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_gmail_candidates(submission_id: str):
    """
    Get ranked Gmail transaction candidates for a submission using fuzzy matching.

    Returns unmatched Gmail transactions matching the submission amount, scored by fuzzy rules.
    Sorted by priority (highest first) for admin to choose from in quick-approve UI.

    Response:
    {
      'submission': {SubmissionID, MemberID, Amount},
      'member': {MemberID, FirstName, LastName, Email, WeChatID, Type, Expiration},
      'candidates': [
        {TransactionNumber, Sender, Amount, Memo, TransactionDate, priority, matched},
        ...
      ],
      'count': int,
      'total_candidates': int
    }
    """
    result = fuzzy_select_transaction_to_submission(submission_id, max_candidates=20)

    if 'error' in result:
        return json_response(result, status=404)

    return json_response(result)


@payments_bp.route('/api/payments/admin-create', methods=['POST'])
@login_required
@require_role('admin')
@handle_api_errors
def api_admin_create():
    """
    Admin creates a payment directly from Gmail transaction.
    Body: {memberId, messageId, paymentIntent, notes}
    """
    data = request.get_json()
    member_id = data.get('memberId', '').upper()
    message_id = data.get('messageId')
    payment_intent = data.get('paymentIntent', 'Individual Membership')
    notes = data.get('notes', '')

    if not member_id or not message_id:
        return json_response({'error': 'memberId and messageId required'}, status=400)

    # Get member & gmail transaction
    member = get_member_by_id(member_id)
    if not member:
        return json_response({'error': f'Member {member_id} not found'}, status=404)

    gmail = query(
        "SELECT * FROM gmail_transactions WHERE MessageId = %s",
        (message_id,)
    )
    if not gmail or len(gmail) == 0:
        return json_response({'error': 'Gmail transaction not found'}, status=404)

    gmail = gmail[0]
    amount = gmail.get('Amount')
    tx_date = gmail.get('TransactionDate')

    # Create payment
    try:
        execute("""
            INSERT INTO payments (
                PaymentID, MemberID, Amount, PaymentIntent, PaymentDate,
                Source, ProcessedBy, CreatedAt
            ) VALUES (%s, %s, %s, %s, %s, 'Gmail', %s, NOW())
        """, (
            str(uuid.uuid4()),
            member_id,
            amount,
            payment_intent,
            tx_date,
            session.get('user_id', 'admin')
        ))

        # Update gmail transaction
        execute("""
            UPDATE gmail_transactions
            SET Notes = %s, UpdatedAt = NOW()
            WHERE MessageId = %s
        """, (f"Linked to {member_id}: {payment_intent}", message_id))

        # Update member if membership
        if 'membership' in payment_intent.lower():
            execute("""
                UPDATE members
                SET Status = 'active', Expiration = DATE_ADD(NOW(), INTERVAL 1 YEAR)
                WHERE MemberID = %s
            """, (member_id,))

        return json_response({
            'ok': True,
            'message': f'Payment created for {member_id}',
            'updated_members': [member_id]
        })
    except Exception as e:
        logger.error(f'[admin-create] Error: {e}')
        return json_response({'error': str(e)}, status=500)


# ============================================================================
# MEMBER SEARCH
# ============================================================================

@payments_bp.route('/api/payments/search-members', methods=['GET'])
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


# ============================================================================
# FUZZY MATCHING DEBUG / TEST ENDPOINTS
# ============================================================================

@payments_bp.route('/api/payments/test-fuzzy-match/<submission_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_test_fuzzy_match(submission_id: str):
    """
    Test endpoint: Score all unmatched Gmail transactions against a submission.
    Used for debugging fuzzy matching logic.

    Returns: {submission, candidates: [{gmail, member, matched, priority, scores}]}
    """
    # Get submission
    sub = query(
        "SELECT * FROM submissions WHERE SubmissionID = %s",
        (submission_id,)
    )
    if not sub or len(sub) == 0:
        return json_response({'error': 'Submission not found'}, status=404)

    sub = sub[0]
    member_id = sub['MemberID']
    amount = sub['Amount']

    # Get member
    member = get_member_by_id(member_id)
    if not member:
        return json_response({'error': f'Member {member_id} not found'}, status=404)

    # Get unmatched Gmail transactions with matching amount
    candidates = query("""
        SELECT TransactionNumber, MessageId, Sender, Amount, Memo, TransactionDate,
               Notes, UpdatedAt
        FROM gmail_transactions
        WHERE (Notes IS NULL OR UpdatedAt IS NULL)
          AND Amount = %s
        ORDER BY TransactionDate DESC
        LIMIT 30
    """, (amount,))

    # Score each candidate
    scored = []
    for gmail in candidates:
        matched, priority = fuzzy_match_transaction_to_member(gmail, member)
        scored.append({
            'gmail': gmail,
            'matched': matched,
            'priority': priority,
            'member_text': build_member_text(member),
            'tx_text': build_transaction_text(gmail),
        })

    return json_response({
        'submission': {
            'SubmissionID': sub['SubmissionID'],
            'MemberID': sub['MemberID'],
            'Amount': float(sub['Amount']),
        },
        'member': {
            'MemberID': member['MemberID'],
            'FirstName': member['FirstName'],
            'LastName': member['LastName'],
            'Email': member['Email'],
            'WeChatID': member.get('WeChatID'),
            'NYRRRunnerName': member.get('NYRRRunnerName'),
        },
        'candidates': scored,
        'count': len(scored),
    })
