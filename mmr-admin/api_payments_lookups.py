"""
Payments — per-member / per-submission lookups for the admin UI.

Endpoints:
  GET /api/payments/submissions-for-member/<member_id>
  GET /api/payments/gmail-matching-candidates/<member_id>
  GET /api/payments/member-quick/all
  GET /api/payments/member-quick/<member_id>
  GET /api/payments/debug-candidates/<submission_id>
  GET /api/payments/gmail-candidates/<submission_id>
  GET /api/payments/debug/match/<submission_id>

Routes register on the shared `payments_bp` defined in `api_payments`.
"""

from __future__ import annotations

import logging

from auth import login_required, require_role
from db import query
from helpers import json_response, handle_api_errors
from payment_helpers import get_member_by_id
from payment_matching import (
    fuzzy_select_transaction_to_submission,
    fuzzy_match_transaction_to_member,
    build_member_text,
    build_transaction_text,
)

from api_payments import payments_bp

logger = logging.getLogger(__name__)


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
# MEMBER QUICK LOOKUPS (for tooltips and quick-approve popover)
# ============================================================================

@payments_bp.route('/api/payments/member-quick/all', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_member_quick_all():
    """
    Fetch all members for fuzzy search in quick-approve popover.
    Must be registered BEFORE /<member_id> to avoid Flask routing /all as a member_id.
    Returns: {ok: true, data: [{MemberID, FirstName, LastName, Email, Expiration, Type, District}]}
    """
    members = query("""
        SELECT MemberID, FirstName, LastName, Email, Expiration, Type, District
        FROM members
        ORDER BY FirstName, LastName
    """)
    logger.info(f'[MEMBER-QUICK/ALL] query returned {len(members)} rows')
    if members:
        logger.info(f'[MEMBER-QUICK/ALL] sample: {members[0]}')
    else:
        # Diagnose: check if table is accessible and has rows at all
        cnt = query("SELECT COUNT(*) as cnt FROM members")
        logger.warning(f'[MEMBER-QUICK/ALL] members table COUNT(*) = {cnt[0]["cnt"] if cnt else "ERROR"}')
    return json_response({'ok': True, 'data': members})


@payments_bp.route('/api/payments/member-quick/<member_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_member_quick(member_id: str):
    """
    Quick member lookup for tooltips and quick-approve popover.
    Returns: {ok: true, data: {FirstName, LastName, MemberID, Email, Expiration, Type, Gender, District, WeChatID}}
    """
    member = get_member_by_id(member_id.upper())
    if not member:
        return json_response({'ok': False, 'error': 'Member not found'}, status=404)

    return json_response({
        'ok': True,
        'data': {
            'MemberID': member.get('MemberID'),
            'FirstName': member.get('FirstName'),
            'LastName': member.get('LastName'),
            'Email': member.get('Email'),
            'Expiration': member.get('Expiration'),
            'Type': member.get('Type'),
            'Gender': member.get('Gender'),
            'District': member.get('District'),
            'WeChatID': member.get('WeChatID'),
        }
    })


# ============================================================================
# CANDIDATE LOOKUPS / MATCH DEBUG (per submission)
# ============================================================================

@payments_bp.route('/api/payments/debug-candidates/<submission_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_debug_candidates(submission_id: str):
    """
    Step-by-step trace of gmail candidate matching for a submission.
    GET /api/payments/debug-candidates/<submission_id>

    Returns member_text, and for each candidate: tx_text + result of each rule.
    """
    sub = query("SELECT * FROM submissions WHERE SubmissionID = %s", (submission_id,))
    if not sub:
        return json_response({'error': 'Submission not found'}, status=404)
    sub = sub[0]

    member = get_member_by_id(sub['MemberID'])
    if not member:
        return json_response({'error': f'Member {sub["MemberID"]} not found'}, status=404)

    member_text = build_member_text(member)
    member_id   = member['MemberID'].upper()

    candidates = query("""
        SELECT MessageId, TransactionNumber, Sender, Amount, Memo, TransactionDate, Notes, UpdatedAt
        FROM gmail_transactions
        WHERE (Notes IS NULL OR UpdatedAt IS NULL) AND Amount = %s
        ORDER BY TransactionDate DESC LIMIT 100
    """, (sub['Amount'],))

    traced = []
    for g in candidates:
        tx_text = build_transaction_text(g)
        tx_number = g.get('TransactionNumber', '') or ''
        sender = (g.get('Sender') or '').lower()
        member_digits = member_id[1:] if len(member_id) >= 2 and member_id[1:].isdigit() else None
        tx_last4 = tx_number[-4:] if len(tx_number) >= 4 else tx_number

        rules = {
            'r1_memberid_in_tx': member_id.lower() in tx_text,
            'r2_tx_last4_eq_member_digits': bool(member_digits and tx_last4 == member_digits),
            'r3_all_sender_words_in_member': bool(sender and all(w in member_text for w in sender.split())),
            'r4_any_member_word_in_tx': bool(member_text and any(w in tx_text for w in member_text.split())),
        }
        matched_rule = next((k for k, v in rules.items() if v), None)
        traced.append({
            'TransactionNumber': tx_number,
            'Sender': g.get('Sender'),
            'Memo': g.get('Memo'),
            'TransactionDate': str(g.get('TransactionDate') or ''),
            'tx_text': tx_text,
            'rules': rules,
            'matched_rule': matched_rule,
            'priority': int(matched_rule[1]) if matched_rule else 0,
        })

    traced.sort(key=lambda x: x['priority'] if x['priority'] > 0 else 999)

    return json_response({
        'submission': {'SubmissionID': submission_id, 'MemberID': sub['MemberID'], 'Amount': float(sub['Amount'])},
        'member': {'MemberID': member_id, 'Name': f"{member['FirstName']} {member['LastName']}", 'member_text': member_text},
        'total_unmatched_at_amount': len(candidates),
        'candidates': traced,
    })


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


@payments_bp.route('/api/payments/debug/match/<submission_id>', methods=['GET'])
@login_required
@require_role('admin')
@handle_api_errors
def api_debug_match(submission_id: str):
    """
    Debug endpoint: show intermediate state for gmail-candidates matching.
    Returns submission, member record, member_text, raw candidate count,
    and full scored candidate list (up to 50) before truncation.
    """
    from db import query as db_query

    # Step 1: submission
    sub = db_query("SELECT * FROM submissions WHERE SubmissionID = %s", (submission_id,))
    if not sub:
        return json_response({'error': 'Submission not found', 'submission_id': submission_id}, 404)
    sub = sub[0]

    # Step 2: member
    member = get_member_by_id(sub['MemberID'])
    if not member:
        return json_response({'error': f"Member {sub['MemberID']} not found"}, 404)

    member_text = build_member_text(member)

    # Step 3: raw gmail candidates (before scoring)
    amount = sub['Amount']
    sub_amount = float(amount)
    member_id = sub['MemberID']
    mid_pattern = f'%{member_id}%'
    raw = db_query("""
        SELECT MessageId, TransactionNumber, Sender, Amount, Memo, Notes, TransactionDate, UpdatedAt
        FROM gmail_transactions
        WHERE (
            Amount = %s
            OR Memo  LIKE %s
            OR Notes LIKE %s
        )
        AND NOT EXISTS (
            SELECT 1 FROM payments
            WHERE payments.TransactionNumber = gmail_transactions.TransactionNumber
              AND payments.SubmissionID IS NOT NULL
              AND payments.SubmissionID != ''
        )
    """, (amount, mid_pattern, mid_pattern))

    # Step 4: score each
    scored = []
    for gmail in raw:
        matched, priority = fuzzy_match_transaction_to_member(gmail, member)
        amount_match = abs(float(gmail['Amount']) - sub_amount) < 0.01
        scored.append({
            'MessageId': gmail['MessageId'],
            'TransactionNumber': gmail['TransactionNumber'],
            'Sender': gmail['Sender'],
            'Memo': gmail['Memo'],
            'Notes': gmail['Notes'],
            'Amount': float(gmail['Amount']),
            'amount_match': amount_match,
            'TransactionDate': gmail['TransactionDate'].isoformat() if gmail['TransactionDate'] and hasattr(gmail['TransactionDate'], 'isoformat') else str(gmail['TransactionDate']),
            'tx_text': build_transaction_text(gmail),
            'priority': priority,
            'matched': matched,
        })

    scored.sort(key=lambda x: (
        x['amount_match'],
        6 if (x['matched'] and x['priority'] == 0) else ((5 - x['priority']) if x['priority'] > 0 else -1),
        x['TransactionDate'] or ''
    ), reverse=True)

    return json_response({
        'submission': {k: str(v) if v is not None else None for k, v in sub.items()},
        'member': {
            'MemberID': member.get('MemberID'),
            'FirstName': member.get('FirstName'),
            'LastName': member.get('LastName'),
            'Email': member.get('Email'),
            'WeChatID': member.get('WeChatID'),
            'member_text': member_text,
        },
        'raw_candidate_count': len(raw),
        'candidates': scored[:50],
    })
