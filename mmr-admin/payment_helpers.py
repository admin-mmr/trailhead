"""
Payment Helpers — Pure database lookups and utility functions (no Flask routes).
Used by api_payments.py for member/config queries and renewal period checks.
"""

from __future__ import annotations
from datetime import datetime
from decimal import Decimal
from typing import Optional
from db import query


# Stripe test-mode payments are stamped with this PaymentMethod (see MIGRATION_V035).
# Reports and reconciliation must never count them as real money.
TEST_PAYMENT_METHOD = 'Stripe (TEST)'


def exclude_test_payments(alias: str = 'p') -> str:
    """SQL fragment excluding Stripe test-mode rows from a payments/gmail_transactions
    query. NULL PaymentMethod is kept (legacy rows predate the column being populated).

        WHERE ... AND {exclude_test_payments('p')}
    """
    col = f'{alias}.PaymentMethod' if alias else 'PaymentMethod'
    return f"({col} IS NULL OR {col} <> '{TEST_PAYMENT_METHOD}')"


def get_member_by_id(member_id: str) -> Optional[dict]:
    """Fetch member record by MemberID.

    Single source of truth — also imported by api_members.py so all callers
    get the same explicit column list (no SELECT *).
    """
    rows = query("""
        SELECT MemberID, FirstName, LastName, Email, PhoneNumber, WeChatID,
               Type, FamilyID, District, Status, Expiration, MembershipFeePaid,
               PaymentDate, PaymentTransaction, UpdatedAt,
               NYRRRunnerName, YearBorn, YearBornGuess
        FROM members
        WHERE MemberID = %s
    """, (member_id,))
    return rows[0] if rows else None


def get_pending_submissions_for_member(member_id: str) -> list:
    """Fetch pending submissions for a given memberID."""
    return query("""
        SELECT * FROM submissions
        WHERE MemberID = %s AND Status = 'pending'
        ORDER BY CreatedAt DESC
    """, (member_id,))


def get_config(key: str) -> Optional[str]:
    """Fetch config value from config table."""
    rows = query("SELECT ConfigValue FROM config WHERE ConfigKey = %s", (key,))
    return rows[0]['ConfigValue'] if rows else None


def get_renewal_period():
    """Get renewal period (start, end) from config as (start_date, end_date)."""
    # Try new keys first, then fall back to old keys for backwards compatibility
    start = get_config('renewal_start_date') or get_config('MembershipCollectionStart')
    end = get_config('renewal_end_date') or get_config('MembershipCollectionEnd')
    return start, end


def expected_membership_amount(member_type: str) -> Decimal:
    """Membership price by member type, from config (FamilyPrice/IndividualPrice,
    seeded by MIGRATION_V033) with hardcoded fallbacks. Shared by autoguess
    matching, debug tracing, and the Stripe webhook's amount verification."""
    if member_type == 'Family':
        return Decimal(get_config('FamilyPrice') or '50.00')
    return Decimal(get_config('IndividualPrice') or '30.00')


def parse_member_id_from_memo(memo: str) -> Optional[str]:
    """Extract memberID from memo (e.g., 'A0001', 'Member: A0001')."""
    if not memo:
        return None
    import re
    # Look for pattern like A0001, A0002, etc.
    match = re.search(r'(?<![a-zA-Z0-9])[Aa]\d{4}(?![a-zA-Z0-9])', memo)
    return match.group(0).upper() if match else None


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
