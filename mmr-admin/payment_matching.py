"""
Payment Matching — Fuzzy matching and autoguess logic for payment reconciliation.
Pure functions for transaction-to-member matching (no Flask routes).
"""
from __future__ import annotations
from typing import Optional

import logging
from decimal import Decimal
from db import query, execute
from payment_helpers import get_member_by_id, get_config, is_within_renewal_period, parse_member_id_from_memo, expected_membership_amount
import uuid

logger = logging.getLogger(__name__)


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
      - priority 0 = payment-linked (caller sets; not returned by this fn)
      - priority 1 = rule 1, 2 = rule 2, 3 = rule 3, 4 = rule 4
      - priority 0 / matched=False = no match
    """
    member_id = (member.get('MemberID') or '').upper()
    tx_number = gmail.get('TransactionNumber') or ''
    sender = (gmail.get('Sender') or '').lower()
    memo = (gmail.get('Memo') or '').lower()
    notes = (gmail.get('Notes') or '').lower()

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


def find_best_matching_submission(gmail: dict, amount: Decimal) -> Optional[dict]:
    """
    Find the best pending submission for a Gmail transaction using fuzzy matching.

    Returns: {submission_id, member_id, score} or None if no match found

    Algorithm:
      0. Check payments table: if this transaction is already linked to a MemberID,
         look for that member's pending submission first (priority 0)
      1. Get all pending membership submissions with matching amount
      2. For each submission's member, apply fuzzy_match_transaction_to_member
      3. Return submission with highest priority match (priority 0 > 1 > 2 > 3 > 4)
    """
    # Step 0: Check if transaction is already linked to a member via payments table
    tx_num = gmail.get('TransactionNumber')
    if tx_num:
        linked = query("""
            SELECT MemberID FROM payments
            WHERE TransactionNumber = %s AND MemberID IS NOT NULL
            LIMIT 1
        """, (tx_num,))
        if linked:
            hint_id = linked[0]['MemberID']
            hinted_sub = query("""
                SELECT SubmissionID, MemberID FROM submissions
                WHERE MemberID = %s AND Status = 'pending'
                  AND SubmissionType LIKE '%Membership%'
                ORDER BY CreatedAt DESC LIMIT 1
            """, (hint_id,))
            if hinted_sub:
                return {'submission_id': hinted_sub[0]['SubmissionID'],
                        'member_id': hint_id, 'priority': 0}

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

    # MemberID in memo is the most reliable signal (system-set) — always show these
    # regardless of existing payment linkage; admin makes the final call.
    # Amount-only matches still require the transaction to be unlinked.
    mid_pattern = f'%{member_id}%'
    candidates = query("""
        SELECT MessageId, TransactionNumber, Sender, Amount, Memo, TransactionDate,
               Notes, UpdatedAt, Timestamp
        FROM gmail_transactions
        WHERE
            -- MemberID in memo/notes: always a candidate, even if already linked
            Memo  LIKE %s
            OR Notes LIKE %s
            -- Amount match only: exclude already-linked transactions
            OR (
                Amount = %s
                AND NOT EXISTS (
                    SELECT 1 FROM payments
                    WHERE payments.TransactionNumber = gmail_transactions.TransactionNumber
                      AND payments.SubmissionID IS NOT NULL
                      AND payments.SubmissionID != ''
                )
            )
    """, (mid_pattern, mid_pattern, amount))

    # Batch-load transactions already linked to this member via payments (priority 0)
    tx_numbers = [c['TransactionNumber'] for c in candidates] or ['']
    placeholders = ','.join(['%s'] * len(tx_numbers))
    payment_linked_txns = query(f"""
        SELECT TransactionNumber FROM payments
        WHERE MemberID = %s AND TransactionNumber IN ({placeholders})
    """, (member_id, *tx_numbers))
    payment_linked_set = {r['TransactionNumber'] for r in payment_linked_txns}

    # Score each candidate using fuzzy matching
    sub_amount = float(amount)
    scored_candidates = []
    for gmail in candidates:
        matched, priority = fuzzy_match_transaction_to_member(gmail, member)
        # Override: existing payment link to this member = highest confidence
        if gmail['TransactionNumber'] in payment_linked_set:
            matched, priority = True, 0
        tx_date = gmail['TransactionDate']
        if tx_date and hasattr(tx_date, 'isoformat'):
            tx_date_str = tx_date.isoformat()
        elif isinstance(tx_date, str):
            tx_date_str = tx_date
        else:
            tx_date_str = None

        amount_match = abs(float(gmail['Amount']) - sub_amount) < 0.01

        scored_candidates.append({
            'MessageId': gmail['MessageId'],
            'TransactionNumber': gmail['TransactionNumber'],
            'Sender': gmail['Sender'],
            'Amount': float(gmail['Amount']),
            'Memo': gmail['Memo'],
            'TransactionDate': tx_date_str,
            'Notes': gmail['Notes'],
            'priority': priority,
            'matched': matched,
            'amount_match': amount_match,
        })

    # Sort: identity match (MemberID) is the primary signal, amount is secondary.
    # A strong identity match with wrong amount beats a weak/no identity match
    # with correct amount.
    # match_score: priority 0→6 (payment-linked), 1→4, 2→3, 3→2, 4→1, unmatched→-1
    def sort_key(x):
        if not x['matched']:
            match_score = -1
        elif x['priority'] == 0:
            match_score = 6   # payment-linked: above all fuzzy rules
        else:
            match_score = 5 - x['priority']
        date_val = x['TransactionDate'] or ''
        return (match_score, x['amount_match'], date_val)

    scored_candidates.sort(key=sort_key, reverse=True)

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


def autoguess_single_transaction(
    tx: dict, admin_email: str,
    all_members: dict = None,
    pending_subs_map: dict = None,
    renewal_start=None,
    renewal_end=None,
) -> dict:
    """
    Strict autoguess: Only link if memberID is explicitly in memo AND all conditions met.

    Returns {'created': bool, 'reason': str}

    Algorithm (FIRM):
      1. Extract memberID from memo (regex: \bA\d{4}\b)
      2. If memberID not found: skip
      3. Verify member exists
      4. Check amount matches membership type ($30 individual, $50 family)
      5. Check transaction date within renewal period (from config)
      6. Look for pending membership submission (optional, not required)
      7. Create payment directly (INSERT + UPDATE)
    """
    from datetime import datetime

    tx_num = tx['TransactionNumber']
    memo = tx['Memo'] or ''
    amount = Decimal(str(tx['Amount'])) if tx['Amount'] else None
    tx_date = tx['TransactionDate']

    if not amount:
        return {'created': False, 'reason': 'Invalid amount'}

    # Step 1: Extract memberID from memo (REQUIRED)
    member_id = parse_member_id_from_memo(memo)
    if not member_id:
        return {'created': False, 'reason': 'No memberID in memo'}

    # Step 2: Verify member exists (use pre-loaded dict if available)
    member = (all_members or {}).get(member_id) if all_members is not None else get_member_by_id(member_id)
    if not member:
        return {'created': False, 'reason': f'Member {member_id} not found'}

    # Step 3: Check amount matches membership type (config-driven, V033)
    expected_amt = expected_membership_amount(member['Type'])
    if amount != expected_amt:
        return {'created': False, 'reason': f'Amount {amount} != {expected_amt}'}

    # Step 4: Check within renewal period (use pre-parsed dates if available)
    if renewal_start and renewal_end:
        if isinstance(tx_date, str):
            try:
                tx_date = datetime.strptime(tx_date, '%Y-%m-%d').date()
            except ValueError:
                return {'created': False, 'reason': 'Invalid transaction date'}
        in_period = renewal_start <= tx_date <= renewal_end
    else:
        in_period = is_within_renewal_period(tx_date)
    if not in_period:
        return {'created': False, 'reason': 'Date outside renewal period'}

    # Step 5: Check for pending membership submission (use pre-loaded map if available)
    submission_id = (pending_subs_map or {}).get(member_id) if pending_subs_map is not None else None
    if submission_id is None and pending_subs_map is None:
        pending_subs = query("""
            SELECT SubmissionID FROM submissions
            WHERE MemberID = %s AND Status = 'pending' AND SubmissionType LIKE '%Membership%'
            LIMIT 1
        """, (member_id,))
        submission_id = pending_subs[0]['SubmissionID'] if pending_subs else None

    # Step 6: Create payment
    try:
        payment_id = str(uuid.uuid4())
        # Set PaymentType based on member type
        payment_type = 'Family Membership' if member['Type'] == 'Family' else 'Individual Membership'
        execute("""
            INSERT INTO payments (PaymentID, MemberID, TransactionNumber, Amount, SubmissionID, PaymentType, ProcessedBy)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (payment_id, member_id, tx_num, amount, submission_id, payment_type, admin_email))

        execute("""
            UPDATE gmail_transactions
            SET UpdatedAt = NOW(),
                Notes = CONCAT(IFNULL(Notes, ''), '\n[', NOW(), '] Linked: ', %s, ' (Membership) $', %s)
            WHERE TransactionNumber = %s
        """, (member_id, amount, tx_num))

        logger.info(f'[AUTOGUESS] ✓ {tx_num}: {member_id} ${amount}')
        return {'created': True, 'reason': f'Created payment for {member_id}'}
    except Exception as e:
        logger.error(f'[AUTOGUESS] ✗ {tx_num}: {str(e)[:80]}')
        return {'created': False, 'reason': f'Error: {str(e)[:80]}'}
