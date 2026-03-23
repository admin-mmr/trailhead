#!/usr/bin/env python3
"""
Daily Member Status Updater
============================
Recalculates Status for every member based on their current Expiration value.
Does NOT modify Expiration — that is handled by the payment reconciliation process.

Status logic:
  • active     → Expiration >= NOW()
  • pending    → Expiration < NOW() (or NULL)
                 AND EXISTS a webapp_events row where
                     MemberID = <this member>
                     AND Status = 'pending'
                     AND PaymentIntent LIKE '%Membership%'
  • not active → Expiration < NOW() (or NULL) AND no pending membership event

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
from datetime import datetime
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
    Returns counts: {active, not_active, pending, skipped}.
    """
    pe_exists = check_table_exists(conn, payment_events_table)
    if not pe_exists:
        logger.warning(
            "Table '%s' not found — pending detection disabled. "
            "Expired/NULL members will be set to 'not active' only.",
            payment_events_table,
        )

    cursor = conn.cursor(dictionary=True)
    cursor.execute("SELECT MemberID, Email, Status, Expiration FROM members")
    members = cursor.fetchall()
    cursor.close()

    now = datetime.now()
    counts = {"active": 0, "not_active": 0, "pending": 0, "skipped": 0}
    updates = []  # (new_status, member_id, email, old_status)

    for m in members:
        mid        = m["MemberID"]
        email      = m["Email"]
        expiration = m["Expiration"]   # datetime or None
        old_status = m["Status"]

        if expiration is not None and expiration >= now:
            new_status = "active"
        else:
            # Expired or no expiration — check for pending membership event
            if pe_exists and has_pending_membership_event(conn, payment_events_table, mid):
                new_status = "pending"
            elif expiration is None:
                # No expiration and no pending event — can't determine, skip
                counts["skipped"] += 1
                continue
            else:
                new_status = "not active"

        if new_status == "active":
            counts["active"] += 1
        elif new_status == "not active":
            counts["not_active"] += 1
        else:
            counts["pending"] += 1

        if old_status != new_status:
            updates.append((new_status, mid, email, old_status))

    logger.info(
        "Status breakdown: %d active, %d not active, %d pending, %d skipped (NULL expiration, no pending event)",
        counts["active"], counts["not_active"], counts["pending"], counts["skipped"],
    )
    logger.info("Status changes to apply: %d member(s)", len(updates))

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
            "Done: %d active / %d not active / %d pending / %d skipped",
            counts["active"], counts["not_active"], counts["pending"], counts["skipped"],
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
