#!/usr/bin/env python3
"""
Auto-Guess Payment Matching
============================
Python port of the GAS autoMatchUnmatchedPayments() logic.

Scans gmail_transactions for unprocessed rows where:
  - Amount is exactly $30 (individual) or $50 (family)
  - Memo contains a valid MemberID (A0001–A9999)
  - Transaction date falls within the configured collection window
  - The row has not already been processed (ProcessedTime IS NULL, Source IS NULL)

For each match:
  1. Creates a payment record in the `payments` table
  2. Updates the member (and family members for $50) in the `members` table
  3. Marks the gmail_transactions row as processed (Source='AutoGuess')

Configuration is read from environment variables (with sensible defaults):
  MEMBERSHIP_COLLECTION_START  e.g. "2026-03-01"
  MEMBERSHIP_COLLECTION_END    e.g. "2026-04-30"
  MEMBERSHIP_YEAR_END          e.g. "2027-03-31" (optional, fixed year-end mode)
  MEMBERSHIP_RENEWAL_YEARS     e.g. "1" (default: 1)
  INDIVIDUAL_PRICE             e.g. "30" (default: 30)
  FAMILY_PRICE                 e.g. "50" (default: 50)

Database connection uses the same env vars as sync_sheets_to_mysql.py:
  MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE

Usage:
  # Dry run (default) — shows what would be matched, changes nothing
  python3 auto_guess_payments.py

  # Live run — actually writes to DB
  python3 auto_guess_payments.py --commit

  # Override collection window
  python3 auto_guess_payments.py --commit --start 2026-03-01 --end 2026-04-30
"""

from __future__ import annotations

import argparse
import os
import re
import sys
import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Optional

import mysql.connector


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

def get_env(key: str, default: str = '') -> str:
    return os.environ.get(key, default).strip()


def get_db_connection():
    """Connect to MySQL.

    Prefers individual MYSQL_* env vars (used in GitHub Actions).
    Falls back to parsing DATABASE_URL (used locally via Keychain).
    DATABASE_URL format: mysql://user:password@host/database
    """
    if os.environ.get('MYSQL_HOST'):
        host = os.environ['MYSQL_HOST']
        user = os.environ['MYSQL_USER']
        password = os.environ['MYSQL_PASSWORD']
        database = os.environ['MYSQL_DATABASE']
    elif os.environ.get('DATABASE_URL'):
        from urllib.parse import urlparse
        u = urlparse(os.environ['DATABASE_URL'])
        host = u.hostname
        user = u.username
        password = u.password
        database = u.path.lstrip('/')
    else:
        raise RuntimeError(
            'No database credentials found. '
            'Set MYSQL_HOST/USER/PASSWORD/DATABASE or DATABASE_URL.'
        )
    return mysql.connector.connect(
        host=host,
        user=user,
        password=password,
        database=database,
        ssl_disabled=False,
        autocommit=False,
    )


# ---------------------------------------------------------------------------
# Helpers — ported from GAS jobs.ts
# ---------------------------------------------------------------------------

MEMBER_ID_PATTERN = re.compile(r'\b(A\d{4})\b', re.IGNORECASE)


def extract_member_id_from_memo(memo: str) -> Optional[str]:
    """Scan a memo string for a valid MemberID (A0001–A9999)."""
    if not memo or not memo.strip():
        return None
    m = MEMBER_ID_PATTERN.search(memo)
    return m.group(1).upper() if m else None


def compute_membership_expiration(
    base_date: date,
    current_expiration: Optional[date],
    renewal_years: int,
    membership_year_end: Optional[date],
) -> date:
    """
    Compute new expiration date.

    Fixed year-end mode (membership_year_end is set):
      Result = max(membership_year_end, current_expiration)

    Rolling mode (no year-end):
      Result = max(base_date + renewal_years, current_expiration + renewal_years)
    """
    if membership_year_end:
        result = membership_year_end
        if current_expiration and current_expiration > membership_year_end:
            result = current_expiration
        return result

    # Rolling mode
    new_exp = base_date.replace(year=base_date.year + renewal_years)
    if current_expiration and current_expiration > base_date:
        extended = current_expiration.replace(year=current_expiration.year + renewal_years)
        if extended > new_exp:
            new_exp = extended
    return new_exp


def generate_payment_id() -> str:
    """Generate a unique PaymentID like 'AG-xxxxxxxx'."""
    return f'AG-{uuid.uuid4().hex[:8]}'


# ---------------------------------------------------------------------------
# Main logic
# ---------------------------------------------------------------------------

def run_auto_guess(
    commit: bool = False,
    collection_start: Optional[str] = None,
    collection_end: Optional[str] = None,
) -> dict:
    """
    Run the auto-guess matching process.

    Returns dict with { matched, skipped, errors, details }.
    """
    # Parse config
    start_str = collection_start or get_env('MEMBERSHIP_COLLECTION_START')
    end_str = collection_end or get_env('MEMBERSHIP_COLLECTION_END')
    year_end_str = get_env('MEMBERSHIP_YEAR_END')
    renewal_years = int(get_env('MEMBERSHIP_RENEWAL_YEARS', '1') or '1')
    individual_price = Decimal(get_env('INDIVIDUAL_PRICE', '30') or '30')
    family_price = Decimal(get_env('FAMILY_PRICE', '50') or '50')

    if not start_str or not end_str:
        print('ERROR: MEMBERSHIP_COLLECTION_START and MEMBERSHIP_COLLECTION_END must be set.')
        print('  Set via env vars or --start / --end flags.')
        return {'matched': 0, 'skipped': 0, 'errors': 1, 'details': []}

    try:
        window_start = date.fromisoformat(start_str)
        window_end = date.fromisoformat(end_str)
    except ValueError as e:
        print(f'ERROR: Invalid date format: {e}')
        return {'matched': 0, 'skipped': 0, 'errors': 1, 'details': []}

    today = date.today()

    # Sanity check: dates must be in order
    if window_start > window_end:
        print(f'ERROR: Collection window is inverted: start {window_start} is after end {window_end}.')
        print('  Check MEMBERSHIP_COLLECTION_START and MEMBERSHIP_COLLECTION_END.')
        return {'matched': 0, 'skipped': 0, 'errors': 1, 'details': []}

    # Staleness check: if the window closed more than 60 days ago the vars are
    # almost certainly left over from a prior membership year.
    STALE_DAYS = 60
    days_since_end = (today - window_end).days
    if days_since_end > STALE_DAYS:
        print(f'ERROR: Collection window ended {days_since_end} days ago ({window_end}).')
        print(f'  Variables appear stale (threshold: {STALE_DAYS} days past window end).')
        print('  Update MEMBERSHIP_COLLECTION_START / MEMBERSHIP_COLLECTION_END in')
        print('  GitHub → Settings → Secrets and variables → Actions → Variables.')
        return {'matched': 0, 'skipped': 0, 'errors': 1, 'details': []}

    # Future check: window more than 1 year out is almost certainly a typo.
    FUTURE_DAYS = 366
    days_until_start = (window_start - today).days
    if days_until_start > FUTURE_DAYS:
        print(f'ERROR: Collection window starts {days_until_start} days from now ({window_start}).')
        print('  This looks like a typo — check the year in MEMBERSHIP_COLLECTION_START.')
        return {'matched': 0, 'skipped': 0, 'errors': 1, 'details': []}

    membership_year_end = None
    if year_end_str:
        try:
            membership_year_end = date.fromisoformat(year_end_str)
        except ValueError:
            print(f'WARNING: Invalid MEMBERSHIP_YEAR_END "{year_end_str}", ignoring (using rolling mode)')

    now = datetime.utcnow()
    now_str = now.strftime('%Y-%m-%d %H:%M:%S')

    print(f'Auto-Guess Payment Matching')
    print(f'  Mode:              {"LIVE — will write to DB" if commit else "DRY RUN — no changes"}')
    print(f'  Collection window: {window_start} to {window_end}')
    print(f'  Year-end:          {membership_year_end or "(rolling mode)"}')
    print(f'  Renewal years:     {renewal_years}')
    print(f'  Individual price:  ${individual_price}')
    print(f'  Family price:      ${family_price}')
    print()

    conn = get_db_connection()
    cursor = conn.cursor(dictionary=True)

    stats = {'matched': 0, 'skipped': 0, 'errors': 0, 'details': []}

    try:
        # ── Fetch unprocessed Gmail payments ──────────────────────
        cursor.execute("""
            SELECT MessageId, TimeStamp, Sender, Amount, Memo, TransactionDate,
                   TransactionNumber, OriginalMemo, Source, ProcessedTime
            FROM gmail_transactions
            WHERE (Source IS NULL OR Source = '')
              AND (ProcessedTime IS NULL)
              AND Amount IS NOT NULL
            ORDER BY TransactionDate ASC
        """)
        rows = cursor.fetchall()
        print(f'Found {len(rows)} unprocessed gmail_transactions rows')

        for row in rows:
            msg_id = row['MessageId']
            try:
                # ── 1. Check transaction date within window ───────
                tx_date = row['TransactionDate']
                if tx_date is None:
                    print(f'  SKIP {msg_id}: no TransactionDate')
                    stats['skipped'] += 1
                    continue

                if isinstance(tx_date, datetime):
                    tx_date = tx_date.date()

                if tx_date < window_start or tx_date > window_end:
                    stats['skipped'] += 1
                    continue

                # ── 2. Check amount is $30 or $50 ────────────────
                amount = Decimal(str(row['Amount']))
                if amount != individual_price and amount != family_price:
                    stats['skipped'] += 1
                    continue

                # ── 3. Extract MemberID from memo ────────────────
                combined_memo = ' '.join(filter(None, [row['Memo'], row['OriginalMemo']]))
                member_id = extract_member_id_from_memo(combined_memo)
                if not member_id:
                    print(f'  SKIP {msg_id}: no MemberID in memo "{combined_memo[:80]}"')
                    stats['skipped'] += 1
                    continue

                # ── 4. Verify member exists ──────────────────────
                cursor.execute("""
                    SELECT MemberID, Status, Expiration, Type, FamilyID,
                           FirstName, LastName, Email
                    FROM members
                    WHERE MemberID = %s
                """, (member_id,))
                member = cursor.fetchone()
                if not member:
                    print(f'  SKIP {msg_id}: MemberID {member_id} not found in members table')
                    stats['skipped'] += 1
                    continue

                # ── 5. Determine payment intent ──────────────────
                is_family = amount == family_price
                payment_intent = 'Family Membership' if is_family else 'Individual Membership'
                member_type = 'Family' if is_family else 'Individual'

                # ── 6. Determine which members to update ─────────
                members_to_update = [member]
                if is_family and member['FamilyID']:
                    cursor.execute("""
                        SELECT MemberID, Status, Expiration, Type, FamilyID
                        FROM members
                        WHERE FamilyID = %s
                    """, (member['FamilyID'],))
                    family_members = cursor.fetchall()
                    if family_members:
                        members_to_update = family_members

                # ── 7. Compute new expiration ────────────────────
                current_exp = member['Expiration']
                if isinstance(current_exp, datetime):
                    current_exp = current_exp.date()
                new_expiration = compute_membership_expiration(
                    tx_date, current_exp, renewal_years, membership_year_end
                )

                detail = {
                    'message_id': msg_id,
                    'member_id': member_id,
                    'member_name': f"{member['FirstName']} {member['LastName']}",
                    'amount': float(amount),
                    'intent': payment_intent,
                    'tx_date': str(tx_date),
                    'new_expiration': str(new_expiration),
                    'members_updated': [m['MemberID'] for m in members_to_update],
                }
                stats['details'].append(detail)

                print(f'  MATCH {msg_id}: {member_id} ({member["FirstName"]} {member["LastName"]}) '
                      f'${amount} → {payment_intent}, exp={new_expiration}')

                if not commit:
                    stats['matched'] += 1
                    continue

                # ── 8. Write payment record ──────────────────────
                payment_id = generate_payment_id()
                cursor.execute("""
                    INSERT INTO payments
                        (PaymentID, EventID, MemberID, PaymentDate, Amount,
                         PaymentIntent, MembershipType, PaymentMethod,
                         PayerName, MemoField, TransactionReference,
                         PeriodStart, PeriodEnd, ProcessedBy, ProcessedDate,
                         Source, Notes)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    payment_id,
                    '',  # no webapp EventID for direct payments
                    member_id,
                    tx_date,
                    float(amount),
                    payment_intent,
                    member_type,
                    'Unknown',  # payment method not always clear from Gmail
                    row['Sender'] or '',
                    row['Memo'] or '',
                    row['TransactionNumber'] or '',
                    tx_date,  # PeriodStart
                    new_expiration,  # PeriodEnd
                    'auto-guess@system',
                    now_str,
                    'AutoGuess',
                    f'Auto-matched: MemberID {member_id} found in memo, ${amount} → {payment_intent}',
                ))

                # ── 9. Update members ────────────────────────────
                for m in members_to_update:
                    cursor.execute("""
                        UPDATE members
                        SET Status = 'active',
                            Expiration = %s,
                            Type = %s,
                            UpdatedAt = %s
                        WHERE MemberID = %s
                    """, (new_expiration, member_type, now_str, m['MemberID']))

                # ── 10. Mark gmail_transactions row as processed ─
                cursor.execute("""
                    UPDATE gmail_transactions
                    SET ProcessedTime = %s,
                        Source = 'AutoGuess',
                        PaymentID = %s
                    WHERE MessageId = %s
                """, (now_str, payment_id, msg_id))

                stats['matched'] += 1

            except Exception as e:
                print(f'  ERROR {msg_id}: {e}')
                stats['errors'] += 1

        if commit and stats['matched'] > 0:
            conn.commit()
            print(f'\nCommitted {stats["matched"]} matches to DB.')
        elif commit:
            print('\nNothing to commit.')

    except Exception as e:
        print(f'\nFATAL ERROR: {e}')
        if commit:
            conn.rollback()
        stats['errors'] += 1

    finally:
        cursor.close()
        conn.close()

    print(f'\nSummary: matched={stats["matched"]}, skipped={stats["skipped"]}, errors={stats["errors"]}')
    return stats


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description='Auto-guess payment matching (Gmail → members)')
    parser.add_argument('--commit', action='store_true',
                        help='Actually write changes to DB (default is dry-run)')
    parser.add_argument('--start', type=str, default=None,
                        help='Override collection window start (YYYY-MM-DD)')
    parser.add_argument('--end', type=str, default=None,
                        help='Override collection window end (YYYY-MM-DD)')
    args = parser.parse_args()

    stats = run_auto_guess(
        commit=args.commit,
        collection_start=args.start,
        collection_end=args.end,
    )

    # Exit code: 0 if no errors, 1 if any errors
    sys.exit(1 if stats['errors'] > 0 else 0)


if __name__ == '__main__':
    main()
