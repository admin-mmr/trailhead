"""
Category-specific payment fulfillment handlers for mmr-admin.

Each PaymentIntent maps to a handler function that executes the
business logic after a payment is approved (update members, etc.).

This module imports from: db, core, config_cache, datetime_utils.
Sheets syncing happens via scheduled sync jobs (not real-time).
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from db import query, execute
from core import gen_id
from config_cache import get_config
from datetime_utils import to_date, to_datetime


# ---------------------------------------------------------------------------
# Expiration computation
# ---------------------------------------------------------------------------

def compute_membership_expiration(
    current_expiration: Optional[datetime],
    transaction_date: Optional[date] = None,
    config: Optional[Dict[str, str]] = None,
) -> date:
    """
    Compute new membership expiration date.

    Two modes (mirrors GAS jobs.ts logic):
      - Fixed year-end: everyone expires on MembershipYearEnd
      - Rolling: add MembershipRenewalYears from today or current expiration

    Returns the new expiration as a date (never regresses).
    """
    if config is None:
        config = get_config()

    renewal_years = int(config.get('MembershipRenewalYears', '1'))
    year_end_str = config.get('MembershipYearEnd', '').strip()

    today = date.today()
    tx_date = transaction_date or today

    # Normalise current_expiration to date
    cur_exp = to_date(current_expiration)

    if year_end_str:
        # Fixed year-end mode
        try:
            year_end = datetime.strptime(year_end_str, '%Y-%m-%d').date()
        except ValueError:
            year_end = date(today.year + renewal_years, 3, 31)

        if cur_exp and cur_exp > year_end:
            return cur_exp  # never regress
        return year_end
    else:
        # Rolling mode
        if cur_exp and cur_exp > today:
            new_exp = date(cur_exp.year + renewal_years, cur_exp.month, cur_exp.day)
        else:
            new_exp = date(tx_date.year + renewal_years, tx_date.month, tx_date.day)

        # Never regress
        if cur_exp and cur_exp > new_exp:
            return cur_exp
        return new_exp


# ---------------------------------------------------------------------------
# Member + family update
# ---------------------------------------------------------------------------

def get_member(member_id: str) -> Optional[Dict]:
    """Fetch a single member row."""
    rows = query(
        "SELECT * FROM members WHERE MemberID = %s", [member_id]
    )
    return rows[0] if rows else None


def get_family_member_ids(family_id: str) -> List[str]:
    """Return all MemberIDs in a family."""
    if not family_id:
        return []
    rows = query(
        "SELECT MemberID FROM members WHERE FamilyID = %s",
        [family_id],
    )
    return [r['MemberID'] for r in rows]


def update_member_expiration(
    member_id: str,
    new_expiration: date,
    membership_type: str,
    amount: float,
    transaction_ref: str,
    changed_by: str,
) -> int:
    """
    Update a single member's expiration, type, status, and payment fields.
    The member_log trigger handles audit logging automatically.
    Sheets sync happens via scheduled sync jobs (not real-time).
    """
    affected = execute("""
        UPDATE members SET
            Expiration          = %s,
            Type                = %s,
            Status              = 'active',
            MembershipFeePaid   = %s,
            PaymentDate         = NOW(),
            PaymentTransaction  = %s,
            LastUpdated         = NOW()
        WHERE MemberID = %s
    """, [new_expiration, membership_type, amount, transaction_ref, member_id])

    return affected


def update_member_and_family(
    member_id: str,
    new_expiration: date,
    membership_type: str,
    amount: float,
    transaction_ref: str,
    changed_by: str,
) -> List[str]:
    """
    Update member (and all family members if Family type).
    Returns list of updated MemberIDs.
    """
    updated = []
    member = get_member(member_id)
    if not member:
        return updated

    if membership_type == 'Family' and member.get('FamilyID'):
        family_ids = get_family_member_ids(member['FamilyID'])
        for mid in family_ids:
            update_member_expiration(
                mid, new_expiration, membership_type,
                amount, transaction_ref, changed_by,
            )
            updated.append(mid)
    else:
        update_member_expiration(
            member_id, new_expiration, membership_type,
            amount, transaction_ref, changed_by,
        )
        updated.append(member_id)

    return updated


# ---------------------------------------------------------------------------
# Payment record creation
# ---------------------------------------------------------------------------

def create_payment_record(
    event: Dict,
    admin_email: str,
    period_start: date,
    period_end: date,
    source: str = 'WebApp',
    notes: str = '',
) -> str:
    """
    Insert a row into the payments table. Returns the PaymentID.
    """
    payment_id = gen_id('PY')
    execute("""
        INSERT INTO payments
            (PaymentID, EventID, MemberID, PaymentDate, Amount,
             PaymentIntent, MembershipType, PaymentMethod, PayerName,
             MemoField, Last4Digits, TransactionReference,
             PeriodStart, PeriodEnd, ProcessedBy, ProcessedDate,
             Source, Notes)
        VALUES (%s, %s, %s, NOW(), %s,
                %s, %s, %s, %s,
                %s, %s, %s,
                %s, %s, %s, NOW(),
                %s, %s)
    """, [
        payment_id,
        event.get('EventID'),
        event.get('MemberID'),
        event.get('Amount'),
        event.get('PaymentIntent'),
        _intent_to_type(event.get('PaymentIntent', '')),
        event.get('PaymentMethod'),
        event.get('PayerName'),
        event.get('MemoField'),
        event.get('Last4Digits'),
        event.get('MatchedTransactionNumber', ''),
        period_start,
        period_end,
        admin_email,
        source,
        notes,
    ])
    return payment_id


def _intent_to_type(intent: str) -> str:
    """Map PaymentIntent to membership type string."""
    intent_lower = (intent or '').lower()
    if 'family' in intent_lower:
        return 'Family'
    return 'Individual'


# ---------------------------------------------------------------------------
# Category-specific fulfillment handlers
# ---------------------------------------------------------------------------

def handle_membership_payment(
    event: Dict,
    admin_email: str,
    config: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Handle Individual Membership or Family Membership payment approval.

    1. Compute new expiration
    2. Create payment record
    3. Update member (+ family)
    4. Return summary
    """
    if config is None:
        config = get_config()

    member_id = event['MemberID']
    member = get_member(member_id)
    if not member:
        return {'ok': False, 'error': f'Member {member_id} not found'}

    intent = event.get('PaymentIntent', '')
    membership_type = _intent_to_type(intent)
    tx_ref = event.get('MatchedTransactionNumber', '')

    # Compute new expiration
    tx_date = to_date(event.get('PaymentDate'))
    new_exp = compute_membership_expiration(
        member.get('Expiration'), tx_date, config,
    )

    period_start = date.today()
    period_end = new_exp

    # Create payment record
    payment_id = create_payment_record(
        event, admin_email, period_start, period_end,
        source='WebApp',
        notes=event.get('Notes', ''),
    )

    # Update member + family (each update auto-syncs to Sheets)
    updated_ids = update_member_and_family(
        member_id, new_exp, membership_type,
        float(event.get('Amount', 0)),
        tx_ref, admin_email,
    )

    return {
        'ok': True,
        'payment_id': payment_id,
        'new_expiration': new_exp.isoformat(),
        'membership_type': membership_type,
        'updated_members': updated_ids,
    }


def handle_family_upgrade(
    event: Dict,
    admin_email: str,
    config: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Handle Family Upgrade payment (type change only, no expiration change).
    """
    member_id = event['MemberID']
    member = get_member(member_id)
    if not member:
        return {'ok': False, 'error': f'Member {member_id} not found'}

    # Create payment record (no period change)
    current_exp = to_date(member.get('Expiration')) or date.today()

    payment_id = create_payment_record(
        event, admin_email,
        period_start=date.today(),
        period_end=current_exp,
        source='WebApp',
        notes=f'Family upgrade. {event.get("Notes", "")}',
    )

    # Update type for member + all family members (each auto-syncs to Sheets)
    tx_ref = event.get('MatchedTransactionNumber', '')
    updated_ids = update_member_and_family(
        member_id, current_exp, 'Family',
        float(event.get('Amount', 0)),
        tx_ref, admin_email,
    )

    return {
        'ok': True,
        'payment_id': payment_id,
        'membership_type': 'Family',
        'updated_members': updated_ids,
    }


def handle_event_registration(
    event: Dict, admin_email: str, config: Optional[Dict] = None,
) -> Dict[str, Any]:
    """[Future] Handle event registration payment."""
    payment_id = create_payment_record(
        event, admin_email,
        period_start=date.today(), period_end=date.today(),
        source='WebApp',
        notes=f'Event registration. {event.get("Notes", "")}',
    )
    return {'ok': True, 'payment_id': payment_id, 'action': 'event_registration_stub'}


def handle_donation(
    event: Dict, admin_email: str, config: Optional[Dict] = None,
) -> Dict[str, Any]:
    """[Future] Handle donation payment."""
    payment_id = create_payment_record(
        event, admin_email,
        period_start=date.today(), period_end=date.today(),
        source='WebApp',
        notes=f'Donation. {event.get("Notes", "")}',
    )
    return {'ok': True, 'payment_id': payment_id, 'action': 'donation_stub'}


# Dispatch table: PaymentIntent → handler
INTENT_HANDLERS = {
    'Individual Membership': handle_membership_payment,
    'Family Membership':     handle_membership_payment,
    'Family Upgrade':        handle_family_upgrade,
    'Event Registration':    handle_event_registration,
    'Donation':              handle_donation,
}


def dispatch_fulfillment(
    event: Dict,
    admin_email: str,
    config: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    """
    Route an approved event to the appropriate handler based on PaymentIntent.
    """
    intent = event.get('PaymentIntent', '')
    handler = INTENT_HANDLERS.get(intent)
    if not handler:
        # Default to membership payment for unknown intents
        if 'membership' in intent.lower() or 'dues' in intent.lower():
            handler = handle_membership_payment
        else:
            return {'ok': False, 'error': f'Unknown PaymentIntent: {intent}'}
    return handler(event, admin_email, config)
