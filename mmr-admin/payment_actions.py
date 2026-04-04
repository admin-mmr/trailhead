"""
Payment reconciliation orchestrator for mmr-admin.

Handles the 2-step async workflow:
  Step 1 — Payment submitted (submission created, status=pending)
  Step 2 — Admin matches & approves → category-specific fulfillment

This module coordinates: auto-match, manual-match, approve, reject,
admin-create. Business logic lives in payment_handlers.py.
Sheets syncing is deferred to scheduled sync jobs (not real-time webhooks).

Imports: db, payment_handlers, webhook_client.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

from db import query, execute
from core import gen_id
from config_cache import get_config
from activity_logger import log_activity
from datetime_utils import to_datetime

# Re-export commonly used functions so api_payments.py can import from here
from payment_handlers import (  # noqa: F401
    get_member,
    get_family_member_ids,
    dispatch_fulfillment,
)
from webhook_client import (  # noqa: F401
    send_payment_approved_email,
    send_payment_rejected_email,
    send_membership_activated_email,
)


# ---------------------------------------------------------------------------
# Auto-match heuristic
# ---------------------------------------------------------------------------

def _extract_member_id(text: str) -> Optional[str]:
    """Extract MemberID (A0001-A9999) from text."""
    if not text:
        return None
    m = re.search(r'\b(A\d{4})\b', text, re.IGNORECASE)
    return m.group(1).upper() if m else None


def _name_match(name1: str, name2: str) -> bool:
    """Fuzzy name match: one contains the other (case-insensitive)."""
    if not name1 or not name2:
        return False
    n1 = name1.strip().lower()
    n2 = name2.strip().lower()
    return n1 in n2 or n2 in n1


def find_gmail_match(
    submission: Dict,
    unmatched_gmail: List[Dict],
) -> Optional[Dict]:
    """
    Find a matching gmail_transaction for a pending submission.

    Scoring rules (mirrors GAS dues.ts logic):
      1. Amount must match exactly
      2. Transaction date within ±7 days of submission timestamp
      3. At least ONE identifier match:
         a) Last4Digits matches end of TransactionNumber
         b) MemberID found in memo
         c) Payer name fuzzy match
    """
    submission_amount = float(submission.get('Amount') or 0)
    submission_ts     = to_datetime(submission.get('CreatedAt'))

    submission_last4     = (submission.get('Last4Digits') or '').strip()
    submission_member_id = (submission.get('MemberID') or '').strip().upper()
    submission_payer     = (submission.get('PayerName') or '').strip()

    sid = submission.get('SubmissionID', '?')[:16]
    logger.debug(
        '[find_gmail_match] submission=%s amount=%.2f ts=%s last4=%r member_id=%r payer=%r | candidates=%d',
        sid, submission_amount, submission_ts, submission_last4, submission_member_id, submission_payer, len(unmatched_gmail)
    )

    for gmail in unmatched_gmail:
        mid = (gmail.get('MessageId') or '?')[:16]

        # Rule 1: amount match
        gmail_amount = float(gmail.get('Amount') or 0)
        if abs(gmail_amount - submission_amount) > 0.01:
            logger.debug('  [%s] SKIP amount mismatch: submission=%.2f gmail=%.2f', mid, submission_amount, gmail_amount)
            continue

        # Rule 2: date within ±7 days
        if submission_ts:
            gmail_dt = to_datetime(gmail.get('TransactionDate'))
            if gmail_dt:
                delta = abs((gmail_dt - submission_ts).days)
                if delta > 7:
                    logger.debug('  [%s] SKIP date delta=%d days (submission=%s gmail=%s)', mid, delta, submission_ts, gmail_dt)
                    continue
            else:
                logger.debug('  [%s] date unparseable: %r — skipping date check', mid, gmail.get('TransactionDate'))

        # Rule 3: at least one identifier match
        gmail_tx_num = (gmail.get('TransactionNumber') or '').strip()
        gmail_memo = (gmail.get('Memo') or '') + ' ' + (gmail.get('OriginalMemo') or '')
        gmail_sender = (gmail.get('Sender') or '').strip()

        matched = False
        match_reason = ''

        # 3a: last4 digits
        if submission_last4 and gmail_tx_num and gmail_tx_num.endswith(submission_last4):
            matched = True
            match_reason = f'last4={submission_last4}'

        # 3b: MemberID in memo
        if not matched and submission_member_id:
            extracted = _extract_member_id(gmail_memo)
            if extracted == submission_member_id:
                matched = True
                match_reason = f'member_id={submission_member_id}'
            else:
                logger.debug('  [%s] memo member_id extracted=%r expected=%r', mid, extracted, submission_member_id)

        # 3c: payer name
        if not matched and submission_payer and _name_match(submission_payer, gmail_sender):
            matched = True
            match_reason = f'name_match payer={submission_payer!r} sender={gmail_sender!r}'

        if matched:
            logger.info('[find_gmail_match] MATCH submission=%s → gmail=%s via %s', sid, mid, match_reason)
            return gmail

        logger.debug('  [%s] SKIP no identifier: last4=%r tx_num=%r sender=%r memo=%r',
                     mid, submission_last4, gmail_tx_num, gmail_sender, gmail_memo[:80])

    logger.debug('[find_gmail_match] NO MATCH for event=%s', eid)
    return None


def run_auto_match() -> Dict[str, Any]:
    """
    Run auto-match on all pending submissions against unmatched gmail rows.

    Returns stats: {matched: N, skipped: N, errors: N, details: [...]}
    """
    pending = query("""
        SELECT * FROM submissions
        WHERE Status = 'pending'
        ORDER BY CreatedAt ASC
    """)

    unmatched_gmail = query("""
        SELECT * FROM gmail_transactions
        WHERE ProcessedTime IS NULL
        ORDER BY TransactionDate DESC
    """)

    logger.info('[run_auto_match] START: %d pending submissions, %d unmatched gmail rows',
                len(pending), len(unmatched_gmail))

    stats: Dict[str, Any] = {'approved': 0, 'skipped': 0, 'errors': 0, 'details': []}
    matched_message_ids: set = set()

    for submission in pending:
        available_gmail = [
            g for g in unmatched_gmail
            if g['MessageId'] not in matched_message_ids
        ]

        gmail_match = find_gmail_match(submission, available_gmail)

        if gmail_match:
            try:
                submission_id = submission['SubmissionID']
                message_id = gmail_match['MessageId']
                tx_num = gmail_match.get('TransactionNumber', '')
                logger.info('[run_auto_match] Writing match: submission=%s → msg=%s tx=%s',
                            submission_id[:16], message_id[:16], tx_num)

                execute("""
                    UPDATE submissions SET
                        Status = 'approved',
                        MatchedMessageId = %s,
                        MatchedTransactionNumber = %s,
                        UpdatedAt = NOW()
                    WHERE SubmissionID = %s
                """, [message_id, tx_num, submission_id])

                execute("""
                    UPDATE gmail_transactions SET
                        Notes = 'AutoMatch',
                        PaymentID = %s
                    WHERE MessageId = %s
                """, [submission_id, message_id])

                matched_message_ids.add(message_id)
                stats['approved'] += 1
                stats['details'].append({
                    'submissionId': submission_id,
                    'messageId': message_id,
                    'amount': float(submission.get('Amount', 0)),
                    'member': submission.get('MemberID', ''),
                })
            except Exception as e:
                stats['errors'] += 1
                stats['details'].append({
                    'submissionId': submission.get('SubmissionID'),
                    'error': str(e)[:200],
                })
                logger.error('[run_auto_match] DB error for submission=%s: %s',
                             submission.get('SubmissionID', '?')[:16], e, exc_info=True)
        else:
            stats['skipped'] += 1
            logger.debug('[run_auto_match] SKIPPED submission=%s amount=%.2f member=%s',
                         submission.get('SubmissionID', '?')[:16],
                         float(submission.get('Amount') or 0),
                         submission.get('MemberID', '?'))

    logger.info('[run_auto_match] DONE: matched=%d skipped=%d errors=%d',
                stats['approved'], stats['skipped'], stats['errors'])
    return stats


# ---------------------------------------------------------------------------
# Full approval orchestrator
# ---------------------------------------------------------------------------

def approve_event(event_id: str, admin_email: str, notes: str = '') -> Dict[str, Any]:
    """
    Full approval flow:
      1. Validate event exists and is pending/matched
      2. Dispatch category-specific fulfillment
      3. Mark event as approved
      4. Log activity
      5. Trigger sheets sync (fire-and-forget)
    """
    rows = query("SELECT * FROM submissions WHERE SubmissionID = %s", [event_id])
    if not rows:
        return {'ok': False, 'error': f'Event {event_id} not found'}

    event = rows[0]
    if event['Status'] not in ('pending', 'approved'):
        return {'ok': False, 'error': f'Event status is {event["Status"]}, expected pending or matched'}

    config = get_config()

    # Dispatch fulfillment (member updates + Sheets sync happen inside handlers)
    result = dispatch_fulfillment(event, admin_email, config)
    if not result.get('ok'):
        execute("""
            UPDATE submissions SET Status = 'error', Notes = %s, UpdatedAt = NOW()
            WHERE SubmissionID = %s
        """, [result.get('error', 'Fulfillment failed')[:500], event_id])
        return result

    # Mark event as approved
    execute("""
        UPDATE submissions SET
            Status = 'approved',
            AdminApprover = %s,
            ApprovalDate = NOW(),
            Notes = %s,
            UpdatedAt = NOW()
        WHERE SubmissionID = %s
    """, [admin_email, notes[:500] if notes else None, event_id])

    # Mark the linked gmail transaction as processed (now, at actual approval time).
    # Guard: only set if not already stamped (e.g. GAS may have set it first).
    matched_message_id = event.get('MatchedMessageId')
    if matched_message_id:
        execute("""
            UPDATE gmail_transactions SET
                ProcessedTime = NOW()
            WHERE MessageId = %s AND ProcessedTime IS NULL
        """, [matched_message_id])

    # Log activity
    log_activity(
        'PAYMENT_APPROVED',
        member_id=event.get('MemberID', ''),
        admin_email=admin_email,
        event_id=event_id,
        state=f'intent={event.get("PaymentIntent")}, amount={event.get("Amount")}',
    )

    # Note: Sheets sync happens via scheduled sync jobs (export_events, export_payments)
    # not in real-time from payment approval

    # Send approval email to member
    try:
        member = get_member(event.get('MemberID', ''))
        if member:
            send_payment_approved_email(
                to=member.get('Email', ''),
                first_name=member.get('FirstName', 'Member'),
                member_id=event.get('MemberID', ''),
                payment_intent=event.get('PaymentIntent', ''),
                expires_at=result.get('new_expiration', ''),
                amount=float(event.get('Amount', 0)),
            )
    except Exception as e:
        print(f'[approve_event] Email send failed for {event_id}: {e}')

    result['event_id'] = event_id
    result['status'] = 'approved'
    return result


def reject_event(event_id: str, admin_email: str, notes: str = '') -> Dict[str, Any]:
    """Reject a pending/matched event."""
    rows = query("SELECT * FROM submissions WHERE SubmissionID = %s", [event_id])
    if not rows:
        return {'ok': False, 'error': f'Event {event_id} not found'}

    event = rows[0]
    if event['Status'] not in ('pending', 'approved'):
        return {'ok': False, 'error': f'Event status is {event["Status"]}, expected pending or matched'}

    execute("""
        UPDATE submissions SET
            Status = 'cancelled',
            AdminApprover = %s,
            ApprovalDate = NOW(),
            Notes = %s,
            UpdatedAt = NOW()
        WHERE SubmissionID = %s
    """, [admin_email, notes[:500] if notes else None, event_id])

    # Log activity
    log_activity(
        'PAYMENT_REJECTED',
        member_id=event.get('MemberID', ''),
        admin_email=admin_email,
        event_id=event_id,
        state=f'notes={notes[:100]}',
    )

    # Note: Sheets sync happens via scheduled sync jobs (not real-time)

    # Send rejection email to member
    try:
        member = get_member(event.get('MemberID', ''))
        if member:
            send_payment_rejected_email(
                to=member.get('Email', ''),
                first_name=member.get('FirstName', 'Member'),
                member_id=event.get('MemberID', ''),
                reason=notes or 'Payment could not be verified.',
                reference_id=event_id,
            )
    except Exception as e:
        print(f'[reject_event] Email send failed for {event_id}: {e}')

    return {'ok': True, 'event_id': event_id, 'status': 'rejected'}


# ---------------------------------------------------------------------------
# Manual match
# ---------------------------------------------------------------------------

def manual_match(event_id: str, message_id: str, admin_email: str) -> Dict[str, Any]:
    """
    Manually link a pending webapp_event to a gmail_transaction.
    Sets event status to 'approved' but does NOT auto-approve.
    """
    events = query("SELECT * FROM submissions WHERE SubmissionID = %s", [event_id])
    if not events:
        return {'ok': False, 'error': f'Event {event_id} not found'}
    event = events[0]
    if event['Status'] not in ('pending',):
        return {'ok': False, 'error': f'Event status is {event["Status"]}, expected pending'}

    gmails = query("SELECT * FROM gmail_transactions WHERE MessageId = %s", [message_id])
    if not gmails:
        return {'ok': False, 'error': f'Gmail transaction {message_id} not found'}
    gmail = gmails[0]
    if gmail.get('ProcessedTime'):
        return {'ok': False, 'error': 'Gmail transaction already processed'}

    tx_num = gmail.get('TransactionNumber', '')

    execute("""
        UPDATE submissions SET
            Status = 'approved',
            MatchedMessageId = %s,
            MatchedTransactionNumber = %s,
            UpdatedAt = NOW()
        WHERE SubmissionID = %s
    """, [message_id, tx_num, event_id])

    execute("""
        UPDATE gmail_transactions SET
            Notes = 'Manual',
            PaymentID = %s
        WHERE MessageId = %s
    """, [event_id, message_id])

    log_activity(
        'MANUAL_MATCH',
        member_id=event.get('MemberID', ''),
        admin_email=admin_email,
        event_id=event_id,
        state=f'gmail={message_id}',
    )

    return {
        'ok': True,
        'event_id': event_id,
        'message_id': message_id,
        'status': 'approved',
    }


# ---------------------------------------------------------------------------
# Admin-created payment (for unmatched gmail with no webapp event)
# ---------------------------------------------------------------------------

def admin_create_payment(
    member_id: str,
    message_id: str,
    payment_intent: str,
    admin_email: str,
    notes: str = '',
) -> Dict[str, Any]:
    """
    Admin creates a payment record directly from an unmatched gmail row,
    without a pre-existing submission.

    Creates a new submission (status=approved) + payment record + member update.
    """
    member = get_member(member_id)
    if not member:
        return {'ok': False, 'error': f'Member {member_id} not found'}

    gmails = query("SELECT * FROM gmail_transactions WHERE MessageId = %s", [message_id])
    if not gmails:
        return {'ok': False, 'error': f'Gmail transaction {message_id} not found'}
    gmail = gmails[0]
    if gmail.get('ProcessedTime'):
        return {'ok': False, 'error': 'Gmail transaction already processed'}

    submission_id = gen_id('SUB')
    execute("""
        INSERT INTO submissions
            (SubmissionID, SubmissionType, MemberID, PaymentIntent, Amount,
             PaymentMethod, PayerName, MemoField, PaymentDate,
             Status, MatchedMessageId, MatchedTransactionNumber,
             AdminApprover, ApprovalDate, Notes, UpdatedByID, UpdatedAt)
        VALUES (%s, 'Admin-Created', %s, %s, %s,
                %s, %s, %s, %s,
                'approved', %s, %s,
                %s, NOW(), %s, %s, NOW())
    """, [
        submission_id,
        member_id,
        payment_intent,
        gmail.get('Amount'),
        gmail.get('PaymentMethod') or 'Zelle',
        gmail.get('Sender', ''),
        gmail.get('Memo', ''),
        gmail.get('TransactionDate'),
        message_id,
        gmail.get('TransactionNumber', ''),
        admin_email,
        notes[:500] if notes else None,
        admin_email,
    ])

    submission = {
        'SubmissionID': submission_id,
        'MemberID': member_id,
        'PaymentIntent': payment_intent,
        'Amount': gmail.get('Amount'),
        'PaymentMethod': gmail.get('PaymentMethod') or 'Zelle',
        'PayerName': gmail.get('Sender', ''),
        'MemoField': gmail.get('Memo', ''),
        'MatchedTransactionNumber': gmail.get('TransactionNumber', ''),
        'PaymentDate': gmail.get('TransactionDate'),
        'Notes': notes,
    }

    config = get_config()
    result = dispatch_fulfillment(submission, admin_email, config)

    execute("""
        UPDATE gmail_transactions SET
            ProcessedTime = NOW(),
            Notes = 'Admin-Created',
            PaymentID = %s
        WHERE MessageId = %s
    """, [submission_id, message_id])

    result['submission_id'] = submission_id
    return result
