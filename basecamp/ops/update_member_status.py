#!/usr/bin/env python3
"""
Daily Member Status Updater
============================
Recalculates Status for every member based on their current Expiration value.
Does NOT modify Expiration — that is handled by the payment reconciliation process.

Status logic (V10):
  • active     → Expiration >= TODAY()
  • expired    → TODAY() > Expiration >= 2026-01-01 (can renew; send reminders)
  • inactive   → LOCKED ONCE SET: Never changed by cron job (manual override)
  • pending    → Expiration IS NULL AND has a pending Membership payment event

⚠️ CRITICAL: If a member's status is 'inactive', the cron job will SKIP them entirely.
            To change an inactive member, update MySQL manually.
            This allows admins to mark members as "do not contact" without expiration date changes.

Usage:
    python update_member_status.py            # live run
    python update_member_status.py --dry-run  # preview only, no writes

Environment variables:
    DATABASE_URL   mysql://user:pass@host:3306/dbname
"""

import argparse
import logging
import os
import sys
from datetime import datetime, date
from urllib.parse import urlparse

import mysql.connector
from mysql.connector import Error as MySQLError

# Table synced from the "WebApp-Events" Google Sheet.
# sync-all-sheets-ordered.yml creates it as 'webapp_events'.
DEFAULT_PAYMENT_EVENTS_TABLE = "webapp_events"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger(__name__)


def parse_database_url(database_url: str) -> dict:
    parsed = urlparse(database_url)
    return {
        "user":     parsed.username or "root",
        "password": parsed.password or "",
        "host":     parsed.hostname or "localhost",
        "port":     parsed.port or 3306,
        "database": parsed.path.lstrip("/") if parsed.path else "",
    }


def connect() -> mysql.connector.MySQLConnection:
    database_url = os.environ.get("DATABASE_URL")
    if not database_url:
        raise ValueError("DATABASE_URL environment variable is not set")
    cfg = parse_database_url(database_url)
    cfg["auth_plugin"] = "mysql_native_password"
    conn = mysql.connector.connect(**cfg)
    logger.info("Connected to MySQL: %s/%s", cfg["host"], cfg["database"])
    return conn


def check_table_exists(conn, table_name: str) -> bool:
    cursor = conn.cursor()
    cursor.execute(
        "SELECT COUNT(*) FROM information_schema.TABLES "
        "WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s",
        (table_name,),
    )
    exists = cursor.fetchone()[0] > 0
    cursor.close()
    return exists


def has_pending_membership_event(conn, payment_events_table: str, member_id: str) -> bool:
    """Return True if there is a pending Membership payment event for this member."""
    if not member_id:
        return False
    try:
        cursor = conn.cursor()
        cursor.execute(
            f"""
            SELECT 1 FROM {payment_events_table}
            WHERE MemberID = %s
              AND Status = 'pending'
              AND PaymentIntent LIKE '%Membership%'
            LIMIT 1
            """,
            (member_id,),
        )
        found = cursor.fetchone() is not None
        cursor.close()
        return found
    except MySQLError as e:
        logger.warning("Error checking pending event for %s: %s", member_id, e)
        return False


def update_statuses(conn, payment_events_table: str, dry_run: bool) -> dict:
    """
    Recalculate Status for every member based on Expiration and pending events.

    Logic (V10):
      • active   → Expiration >= TODAY()
      • expired  → TODAY() > Expiration >= 2026-01-01 (can renew; send reminders)
      • inactive → LOCKED: Once set to 'inactive', never changed by this job
      • pending  → Expiration IS NULL AND has pending Membership event

    CRITICAL: If Status = 'inactive', it is NOT recalculated. This is a manual override
    that persists across cron runs. To change an inactive member back, update MySQL manually.

    Returns counts: {active, expired, inactive, pending, skipped}.
    """
    pe_exists = check_table_exists(conn, payment_events_table)
    if not pe_exists:
        logger.warning(
            "Table '%s' not found — pending detection disabled. "
            "NULL expiration members will be set to 'inactive' only.",
            payment_events_table,
        )

    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT MemberID, Email, Status, Expiration FROM members")
    members = cursor.fetchall()
    cursor.close()

    today = date.today()
    cutoff_inactive = date(2026, 1, 1)

    counts = {"active": 0, "expired": 0, "inactive": 0, "pending": 0, "skipped": 0}
    updates = []  # (new_status, member_id, email, old_status)

    for m in members:
        mid        = m["MemberID"]
        email      = m["Email"]
        expiration = m["Expiration"]   # datetime or None
        old_status = m["Status"]

        # RULE: If already inactive, skip (it's a manual override, don't change it)
        if old_status == "inactive":
            counts["inactive"] += 1
            continue

        # Convert expiration to date (handle both datetime and date objects)
        if expiration is None:
            exp_date = None
        elif isinstance(expiration, datetime):
            # It's a datetime object, convert to date
            exp_date = expiration.date()
        else:
            # It's already a date object
            exp_date = expiration

        # Determine new status based on expiration
        if exp_date is not None and exp_date >= today:
            # Expiration is today or in future → active
            new_status = "active"
        elif exp_date is not None and exp_date >= cutoff_inactive:
            # Expiration is in past but >= 2026-01-01 → expired (may renew)
            new_status = "expired"
        elif exp_date is not None and exp_date < cutoff_inactive:
            # Expiration is before 2026-01-01 → would be inactive, but respect existing active/expired
            # If they were previously marked inactive manually, we already skipped them above
            # Here we only auto-set to inactive if they were active/expired/pending
            new_status = "inactive"
        else:
            # Expiration is NULL — check for pending membership event
            if pe_exists and has_pending_membership_event(conn, payment_events_table, mid):
                new_status = "pending"
            else:
                # NULL expiration and no pending event → inactive
                new_status = "inactive"

        if new_status == "active":
            counts["active"] += 1
        elif new_status == "expired":
            counts["expired"] += 1
        elif new_status == "inactive":
            counts["inactive"] += 1
        else:
            counts["pending"] += 1

        if old_status != new_status:
            updates.append((new_status, mid, email, old_status))

    logger.info(
        "Status breakdown: %d active, %d expired, %d inactive (locked), %d pending",
        counts["active"], counts["expired"], counts["inactive"], counts["pending"],
    )
    logger.info("Status changes to apply: %d member(s)", len(updates))
    if counts["inactive"] > 0:
        logger.info("  ℹ️  %d member(s) already marked as 'inactive' — SKIPPED (locked status)", counts["inactive"])

    if dry_run:
        for (new_s, mid, email, old_s) in updates[:20]:
            logger.info("  [DRY] %-40s  %s → %s", email, old_s, new_s)
        if len(updates) > 20:
            logger.info("  [DRY] … and %d more", len(updates) - 20)
        return counts

    if updates:
        cursor = conn.cursor()
        cursor.executemany(
            "UPDATE members SET Status = %s WHERE MemberID = %s",
            [(new_s, mid) for (new_s, mid, _, _) in updates],
        )
        conn.commit()
        cursor.close()
        logger.info("Written: %d status change(s)", len(updates))

    return counts


def print_summary(conn):
    cursor = conn.cursor()
    cursor.execute("SELECT Status, COUNT(*) FROM members GROUP BY Status ORDER BY COUNT(*) DESC")
    rows = cursor.fetchall()
    cursor.execute("SELECT COUNT(*) FROM members WHERE Expiration IS NULL")
    null_exp = cursor.fetchone()[0]
    cursor.close()

    logger.info("=== Post-run summary ===")
    for status, cnt in rows:
        logger.info("  %-14s %d", repr(status), cnt)
    logger.info("  Expiration IS NULL: %d", null_exp)
    logger.info("========================")


def main():
    parser = argparse.ArgumentParser(description="Recalculate member Status in MySQL")
    parser.add_argument("--dry-run", action="store_true",
                        help="Preview changes without writing to the database")
    parser.add_argument("--payment-events-table", default=DEFAULT_PAYMENT_EVENTS_TABLE,
                        help=f"Payment events table name (default: {DEFAULT_PAYMENT_EVENTS_TABLE})")
    args = parser.parse_args()

    if args.dry_run:
        logger.info("=== DRY RUN — no changes will be written ===")

    try:
        conn = connect()
    except Exception as e:
        logger.error("Cannot connect to MySQL: %s", e)
        sys.exit(1)

    try:
        counts = update_statuses(conn, args.payment_events_table, args.dry_run)
        logger.info(
            "Done: %d active / %d expired / %d inactive (locked) / %d pending",
            counts["active"], counts["expired"], counts["inactive"], counts["pending"],
        )
        if not args.dry_run:
            print_summary(conn)
    except Exception as e:
        logger.error("Fatal error: %s", e, exc_info=True)
        conn.close()
        sys.exit(1)

    conn.close()


if __name__ == "__main__":
    main()
