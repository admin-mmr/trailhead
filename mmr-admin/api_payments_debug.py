"""
Payments — debug / diagnostic endpoints.

Endpoints:
  GET /api/payments/debug-autoguess/<transaction_number>  — trace autoguess decision step-by-step
  GET /api/payments/test-fuzzy-match/<submission_id>      — score all gmail txs for a submission

Routes register on the shared `payments_bp` defined in `api_payments`.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from auth import login_required, require_role
from db import query
from helpers import json_response, handle_api_errors
from payment_helpers import (
    get_member_by_id,
    get_renewal_period,
    parse_member_id_from_memo,
    is_within_renewal_period,
    expected_membership_amount,
)
from payment_matching import (
    fuzzy_match_transaction_to_member,
    build_member_text,
    build_transaction_text,
)

from api_payments import payments_bp

logger = logging.getLogger(__name__)


# ============================================================================
# AUTOGUESS DEBUG
# ============================================================================

@payments_bp.route('/api/payments/debug-autoguess/<transaction_number>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_debug_autoguess(transaction_number: str):
    """
    Trace autoguess decision for a single transaction — step by step.
    GET /api/payments/debug-autoguess/85071026
    """
    steps = []

    def step(name, passed, detail):
        steps.append({'step': name, 'passed': passed, 'detail': detail})

    # Fetch transaction
    rows = query("SELECT * FROM gmail_transactions WHERE TransactionNumber = %s", (transaction_number,))
    if not rows:
        return json_response({'ok': False, 'error': f'Transaction {transaction_number} not found'})
    tx = rows[0]

    step('found', True, {
        'TransactionNumber': tx.get('TransactionNumber'),
        'Sender': tx.get('Sender'),
        'Amount': str(tx.get('Amount')),
        'Memo': tx.get('Memo'),
        'TransactionDate': str(tx.get('TransactionDate')),
        'Notes': tx.get('Notes'),
        'UpdatedAt': str(tx.get('UpdatedAt')),
    })

    # Check if already matched
    already_matched = tx.get('Notes') is not None and tx.get('UpdatedAt') is not None
    step('unmatched_check', not already_matched,
         'Already matched (Notes + UpdatedAt both set)' if already_matched else 'Eligible — not yet matched')

    # Step 1: member ID in memo
    memo = tx.get('Memo') or ''
    member_id = parse_member_id_from_memo(memo)
    step('memo_member_id', bool(member_id),
         f'Extracted: {member_id}' if member_id else f'No A#### pattern found in memo: "{memo}"')
    if not member_id:
        return json_response({'ok': True, 'verdict': 'SKIP', 'steps': steps})

    # Step 2: member exists
    member = get_member_by_id(member_id)
    step('member_exists', bool(member),
         f'{member_id}: {member.get("FirstName")} {member.get("LastName")}, Type={member.get("Type")}, Status={member.get("Status")}' if member
         else f'Member {member_id} not found in DB')
    if not member:
        return json_response({'ok': True, 'verdict': 'SKIP', 'steps': steps})

    # Step 3: amount vs member type
    amount = Decimal(str(tx['Amount'])) if tx.get('Amount') else None
    expected = expected_membership_amount(member['Type'])
    step('amount_match', amount == expected,
         f'Got ${amount}, expected ${expected} for {member["Type"]} member')
    if amount != expected:
        return json_response({'ok': True, 'verdict': 'SKIP', 'steps': steps})

    # Step 4: renewal period
    start_str, end_str = get_renewal_period()
    tx_date = tx.get('TransactionDate')
    in_period = is_within_renewal_period(tx_date)
    step('renewal_period', in_period,
         f'TxDate={tx_date}, renewal={start_str} → {end_str}, in_period={in_period}')
    if not in_period:
        return json_response({'ok': True, 'verdict': 'SKIP', 'steps': steps})

    # Step 5: pending submission
    pending = query("""
        SELECT SubmissionID, Status, SubmissionType FROM submissions
        WHERE MemberID = %s AND Status = 'pending' AND SubmissionType LIKE '%Membership%'
        LIMIT 1
    """, (member_id,))
    step('pending_submission', True,
         f'Found: {pending[0]["SubmissionID"]}' if pending else 'None found (payment will be created without submission link)')

    # Step 6: duplicate payment check
    existing_payment = query("""
        SELECT PaymentID FROM payments WHERE TransactionNumber = %s LIMIT 1
    """, (transaction_number,))
    step('no_duplicate', not existing_payment,
         f'Duplicate found: {existing_payment[0]["PaymentID"]}' if existing_payment else 'No existing payment — safe to create')

    verdict = 'SKIP' if existing_payment else 'WOULD_CREATE'
    return json_response({'ok': True, 'verdict': verdict, 'steps': steps})


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
