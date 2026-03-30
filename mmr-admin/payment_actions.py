"""
Payment reconciliation orchestrator for mmr-admin.

Handles the 2-step async workflow:
  Step 1 — Payment submitted (webapp_event created, status=pending)
  Step 2 — Admin matches & approves → category-specific fulfillment

This module coordinates: auto-match, manual-match, approve, reject,
admin-create. Business logic lives in payment_handlers.py,
Sheets sync in sheets_sync.py.

Imports: db, payment_handlers, sheets_sync.
"""

from __future__ import annotations

import re
import time
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from db import query, execute

# Re-export commonly used functions so api_payments.py can import from here
from payment_handlers import (  # noqa: F401
    get_config,
    get_member,
    get_family_member_ids,
    dispatch_fulfillment,
)
from sheets_sync import (  # noqa: F401
    sync_member_to_sheets,
    sync_event_to_sheets,
    sync_payment_to_sheets,
)
from email_client import (  # noqa: F401
    send_payment_approved_email,
    send_payment_rejected_email,
    send_membership_activated_email,
)


# ---------------------------------------------------------------------------
# ID generation
# ---------------------------------------------------------------------------

def _gen_id(prefix: str) -> str:
    """Generate a unique ID like EV-1711234567890-1234."""
    ts = int(time.time() * 1000)
    rand = int(time.time() * 10000) % 10000
    return f'{prefix}-{ts}-{rand:04d}'


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
    event: Dict,
    unmatched_gmail: List[Dict],
) -> Optional[Dict]:
    """
    Find a matching gmail_transaction for a pending webapp_event.

    Scoring rules (mirrors GAS dues.ts logic):
      1. Amount must match exactly
      2. Transaction date within ±7 days of event timestamp
      3. At least ONE identifier match:
         a) Last4Digits matches end of TransactionNumber
         b) MemberID found in memo
         c) Payer name fuzzy match
    """
    event_amount = float(event.get('Amount') or 0)
    event_ts = event.get('Timestamp')
    if isinstance(event_ts, str):
        try:
            event_ts = datetime.fromisoformat(event_ts)
        except ValueError:
            event_ts = None
    elif not isinstance(event_ts, datetime):
        event_ts = None

    event_last4 = (event.get('Last4Digits') or '').strip()
    event_member_id = (event.get('MemberID') or '').strip().upper()
    event_payer = (event.get('PayerName') or '').strip()

    for gmail in unmatched_gmail:
        # Rule 1: amount match
        gmail_amount = float(gmail.get('Amount') or 0)
        if abs(gmail_amount - event_amount) > 0.01:
            continue

        # Rule 2: date within ±7 days
        gmail_date = gmail.get('TransactionDate')
        if event_ts and gmail_date:
            if isinstance(gmail_date, date) and not isinstance(gmail_date, datetime):
                gmail_dt = datetime.combine(gmail_date, datetime.min.time())
            elif isinstance(gmail_date, datetime):
                gmail_dt = gmail_date
            else:
                gmail_dt = None

            if gmail_dt:
                delta = abs((gmail_dt - event_ts).days)
                if delta > 7:
                    continue

        # Rule 3: at least one identifier match
        gmail_tx_num = (gmail.get('TransactionNumber') or '').strip()
        gmail_memo = (gmail.get('Memo') or '') + ' ' + (gmail.get('OriginalMemo') or '')
        gmail_sender = (gmail.get('Sender') or '').strip()

        matched = False

        # 3a: last4 digits
        if event_last4 and gmail_tx_num and gmail_tx_num.endswith(event_last4):
            matched = True

        # 3b: MemberID in memo
        if not matched and event_member_id:
            extracted = _extract_member_id(gmail_memo)
            if extracted == event_member_id:
                matched = True

        # 3c: payer name
        if not matched and event_payer and _name_match(event_payer, gmail_sender):
            matched = True

        if matched:
            return gmail

    return None


def run_auto_match() -> Dict[str, Any]:
    """
    Run auto-match on all pending webapp_events against unmatched gmail rows.

    Returns stats: {matched: N, skipped: N, errors: N, details: [...]}
    """
    pending = query("""
        SELECT * FROM webapp_events
        WHERE Status = 'pending'
          AND EventCategory = 'payment'
        ORDER BY Timestamp ASC
    """)

    unmatched_gmail = query("""
        SELECT * FROM gmail_transactions
        WHERE ProcessedTime IS NULL
          AND IsArchived = FALSE
        ORDER BY TransactionDate DESC
    """)

    stats: Dict[str, Any] = {'matched': 0, 'skipped': 0, 'errors': 0, 'details': []}
    matched_message_ids: set = set()

    for event in pending:
        available_gmail = [
            g for g in unmatched_gmail
            if g['MessageId'] not in matched_message_ids
        ]

        gmail_match = find_gmail_match(event, available_gmail)

        if gmail_match:
            try:
                event_id = event['EventID']
                message_id = gmail_match['MessageId']
                tx_num = gmail_match.get('TransactionNumber', '')

                execute("""
                    UPDATE webapp_events SET
                        Status = 'matched',
                        MatchedMessageId = %s,
                        MatchedTransactionNumber = %s,
                        UpdatedAt = NOW()
                    WHERE EventID = %s
                """, [message_id, tx_num, event_id])

                execute("""
                    UPDATE gmail_transactions SET
                        ProcessedTime = NOW(),
                        Source = 'AutoMatch',
                        WebAppID = %s
                    WHERE MessageId = %s
                """, [event_id, message_id])

                matched_message_ids.add(message_id)
                stats['matched'] += 1
                stats['details'].append({
                    'eventId': event_id,
                    'messageId': message_id,
                    'amount': float(event.get('Amount', 0)),
                    'member': event.get('MemberID', ''),
                })
            except Exception as e:
                stats['errors'] += 1
                stats['details'].append({
                    'eventId': event.get('EventID'),
                    'error': str(e)[:200],
                })
        else:
            stats['skipped'] += 1

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
    rows = query("SELECT * FROM webapp_events WHERE EventID = %s", [event_id])
    if not rows:
        return {'ok': False, 'error': f'Event {event_id} not found'}

    event = rows[0]
    if event['Status'] not in ('pending', 'matched'):
        return {'ok': False, 'error': f'Event status is {event["Status"]}, expected pending or matched'}

    config = get_config()

    # Dispatch fulfillment (member updates + Sheets sync happen inside handlers)
    result = dispatch_fulfillment(event, admin_email, config)
    if not result.get('ok'):
        execute("""
            UPDATE webapp_events SET Status = 'error', Notes = %s, UpdatedAt = NOW()
            WHERE EventID = %s
        """, [result.get('error', 'Fulfillment failed')[:500], event_id])
        return result

    # Mark event as approved
    execute("""
        UPDATE webapp_events SET
            Status = 'approved',
            AdminApprover = %s,
            ApprovalDate = NOW(),
            Notes = %s,
            UpdatedAt = NOW()
        WHERE EventID = %s
    """, [admin_email, notes[:500] if notes else None, event_id])

    # Log activity
    log_id = _gen_id('AL')
    execute("""
        INSERT INTO activity_log (LogID, Timestamp, MemberID, Email, EventID, Action, State)
        VALUES (%s, NOW(), %s, %s, %s, %s, %s)
    """, [
        log_id,
        event.get('MemberID'),
        admin_email,
        event_id,
        'PAYMENT_APPROVED',
        f'intent={event.get("PaymentIntent")}, amount={event.get("Amount")}',
    ])

    # Fire-and-forget sheets sync: event status + payment record
    # (Member sync already happened inside update_member_expiration)
    sync_event_to_sheets(event_id, 'approved', admin_email)
    if result.get('payment_id'):
        sync_payment_to_sheets(
            payment_id=result['payment_id'],
            event_id=event_id,
            member_id=event.get('MemberID', ''),
            amount=str(event.get('Amount', '')),
            payment_intent=event.get('PaymentIntent', ''),
            period_end=result.get('new_expiration', ''),
        )

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
    rows = query("SELECT * FROM webapp_events WHERE EventID = %s", [event_id])
    if not rows:
        return {'ok': False, 'error': f'Event {event_id} not found'}

    event = rows[0]
    if event['Status'] not in ('pending', 'matched'):
        return {'ok': False, 'error': f'Event status is {event["Status"]}, expected pending or matched'}

    execute("""
        UPDATE webapp_events SET
            Status = 'rejected',
            AdminApprover = %s,
            ApprovalDate = NOW(),
            Notes = %s,
            UpdatedAt = NOW()
        WHERE EventID = %s
    """, [admin_email, notes[:500] if notes else None, event_id])

    # Log activity
    log_id = _gen_id('AL')
    execute("""
        INSERT INTO activity_log (LogID, Timestamp, MemberID, Email, EventID, Action, State)
        VALUES (%s, NOW(), %s, %s, %s, %s, %s)
    """, [
        log_id,
        event.get('MemberID'),
        admin_email,
        event_id,
        'PAYMENT_REJECTED',
        f'notes={notes[:100]}',
    ])

    sync_event_to_sheets(event_id, 'rejected', admin_email)

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
    Sets event status to 'matched' but does NOT auto-approve.
    """
    events = query("SELECT * FROM webapp_events WHERE EventID = %s", [event_id])
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
        UPDATE webapp_events SET
            Status = 'matched',
            MatchedMessageId = %s,
            MatchedTransactionNumber = %s,
            UpdatedAt = NOW()
        WHERE EventID = %s
    """, [message_id, tx_num, event_id])

    execute("""
        UPDATE gmail_transactions SET
            ProcessedTime = NOW(),
            Source = 'Manual',
            WebAppID = %s
        WHERE MessageId = %s
    """, [event_id, message_id])

    log_id = _gen_id('AL')
    execute("""
        INSERT INTO activity_log (LogID, Timestamp, MemberID, Email, EventID, Action, State)
        VALUES (%s, NOW(), %s, %s, %s, %s, %s)
    """, [
        log_id, event.get('MemberID'), admin_email, event_id,
        'MANUAL_MATCH', f'gmail={message_id}',
    ])

    return {
        'ok': True,
        'event_id': event_id,
        'message_id': message_id,
        'status': 'matched',
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
    without a pre-existing webapp_event.

    Creates a new webapp_event (status=approved) + payment record + member update.
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

    event_id = _gen_id('EV')
    execute("""
        INSERT INTO webapp_events
            (EventID, EventType, EventCategory, Timestamp, MemberID, Email,
             PaymentIntent, Amount, PaymentMethod, PayerName, MemoField,
             Status, MatchedMessageId, MatchedTransactionNumber,
             AdminApprover, ApprovalDate, Notes)
        VALUES (%s, 'Admin-Created', 'payment', NOW(), %s, %s,
                %s, %s, 'Zelle/Venmo', %s, %s,
                'approved', %s, %s,
                %s, NOW(), %s)
    """, [
        event_id,
        member_id,
        member.get('Email', ''),
        payment_intent,
        gmail.get('Amount'),
        gmail.get('Sender', ''),
        gmail.get('Memo', ''),
        message_id,
        gmail.get('TransactionNumber', ''),
        admin_email,
        notes[:500] if notes else None,
    ])

    event = {
        'EventID': event_id,
        'MemberID': member_id,
        'PaymentIntent': payment_intent,
        'Amount': gmail.get('Amount'),
        'PaymentMethod': 'Zelle/Venmo',
        'PayerName': gmail.get('Sender', ''),
        'MemoField': gmail.get('Memo', ''),
        'MatchedTransactionNumber': gmail.get('TransactionNumber', ''),
        'PaymentDate': gmail.get('TransactionDate'),
        'Notes': notes,
    }

    config = get_config()
    result = dispatch_fulfillment(event, admin_email, config)

    execute("""
        UPDATE gmail_transactions SET
            ProcessedTime = NOW(),
            Source = 'Admin-Created',
            WebAppID = %s
        WHERE MessageId = %s
    """, [event_id, message_id])

    result['event_id'] = event_id
    return result
