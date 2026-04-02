#!/usr/bin/env python3
"""
Backfill Unix timestamp columns from existing ISO datetime columns.

This script runs AFTER the migration 0016_add_unix_timestamp_columns.sql
has been applied. It ensures all existing records have Unix timestamps set.

The migration's SQL UPDATE statements should handle most records, but this
script provides additional verification and can be run at any time.

Usage:
    python3 backfill_unix_timestamps.py

Prerequisites:
    - Migration 0016 applied to MySQL
    - db module configured with credentials
"""

import logging
import sys
from datetime import datetime
from db import query, execute

logging.basicConfig(
    level=logging.INFO,
    format='[%(asctime)s] %(levelname)s: %(message)s'
)
logger = logging.getLogger(__name__)


def backfill_members() -> int:
    """Backfill Unix timestamps in members table."""
    logger.info("Backfilling members table...")

    # For each NULL or 0 Unix column, calculate from ISO datetime
    tables_to_update = [
        ('updated_at', 'updated_at_unix'),
        ('last_login_date', 'last_login_date_unix'),
        ('profile_last_updated', 'profile_last_updated_unix'),
        ('created_at', 'created_at_unix'),
    ]

    total_updated = 0

    for iso_col, unix_col in tables_to_update:
        try:
            # Count records that need backfill
            count_result = query(
                f"SELECT COUNT(*) as cnt FROM members "
                f"WHERE {iso_col} IS NOT NULL AND {iso_col} != '0000-00-00 00:00:00' "
                f"AND ({unix_col} IS NULL OR {unix_col} = 0)"
            )
            to_update = count_result[0]['cnt'] if count_result else 0

            if to_update == 0:
                logger.info(f"  {unix_col}: already backfilled (0 records to update)")
                continue

            # Perform backfill
            affected = execute(
                f"UPDATE members "
                f"SET {unix_col} = UNIX_TIMESTAMP({iso_col}) "
                f"WHERE {iso_col} IS NOT NULL AND {iso_col} != '0000-00-00 00:00:00' "
                f"AND ({unix_col} IS NULL OR {unix_col} = 0)"
            )

            logger.info(f"  {unix_col}: updated {affected} records")
            total_updated += affected

        except Exception as e:
            logger.error(f"  {unix_col}: ERROR — {e}")
            return -1

    return total_updated


def backfill_webapp_events() -> int:
    """Backfill Unix timestamps in webapp_events table."""
    logger.info("Backfilling webapp_events table...")

    tables_to_update = [
        ('timestamp', 'timestamp_unix'),
        ('expires_at', 'expires_at_unix'),
        ('approval_date', 'approval_date_unix'),
    ]

    total_updated = 0

    for iso_col, unix_col in tables_to_update:
        try:
            # Count records that need backfill
            count_result = query(
                f"SELECT COUNT(*) as cnt FROM webapp_events "
                f"WHERE {iso_col} IS NOT NULL AND {iso_col} != '0000-00-00 00:00:00' "
                f"AND ({unix_col} IS NULL OR {unix_col} = 0)"
            )
            to_update = count_result[0]['cnt'] if count_result else 0

            if to_update == 0:
                logger.info(f"  {unix_col}: already backfilled (0 records to update)")
                continue

            # Perform backfill
            affected = execute(
                f"UPDATE webapp_events "
                f"SET {unix_col} = UNIX_TIMESTAMP({iso_col}) "
                f"WHERE {iso_col} IS NOT NULL AND {iso_col} != '0000-00-00 00:00:00' "
                f"AND ({unix_col} IS NULL OR {unix_col} = 0)"
            )

            logger.info(f"  {unix_col}: updated {affected} records")
            total_updated += affected

        except Exception as e:
            logger.error(f"  {unix_col}: ERROR — {e}")
            return -1

    return total_updated


def backfill_payment_history() -> int:
    """Backfill Unix timestamp in payment_history table."""
    logger.info("Backfilling payment_history table...")

    try:
        # Count records that need backfill
        count_result = query(
            "SELECT COUNT(*) as cnt FROM payment_history "
            "WHERE processed_date IS NOT NULL AND processed_date != '0000-00-00 00:00:00' "
            "AND (processed_date_unix IS NULL OR processed_date_unix = 0)"
        )
        to_update = count_result[0]['cnt'] if count_result else 0

        if to_update == 0:
            logger.info("  processed_date_unix: already backfilled (0 records to update)")
            return 0

        # Perform backfill
        affected = execute(
            "UPDATE payment_history "
            "SET processed_date_unix = UNIX_TIMESTAMP(processed_date) "
            "WHERE processed_date IS NOT NULL AND processed_date != '0000-00-00 00:00:00' "
            "AND (processed_date_unix IS NULL OR processed_date_unix = 0)"
        )

        logger.info(f"  processed_date_unix: updated {affected} records")
        return affected

    except Exception as e:
        logger.error(f"  processed_date_unix: ERROR — {e}")
        return -1


def verify_backfill() -> bool:
    """Verify that backfill was successful."""
    logger.info("Verifying backfill...")

    checks = [
        ("members", "updated_at_unix"),
        ("webapp_events", "timestamp_unix"),
        ("payment_history", "processed_date_unix"),
    ]

    all_good = True

    for table, unix_col in checks:
        try:
            result = query(
                f"SELECT COUNT(*) as cnt FROM {table} "
                f"WHERE {unix_col} IS NULL OR {unix_col} = 0"
            )
            nulls = result[0]['cnt'] if result else 0

            if nulls > 0:
                logger.warning(f"  {table}.{unix_col}: {nulls} records still NULL or 0")
                all_good = False
            else:
                logger.info(f"  {table}.{unix_col}: ✓ All records have Unix timestamps")

        except Exception as e:
            logger.error(f"  {table}.{unix_col}: ERROR — {e}")
            all_good = False

    return all_good


def main():
    """Run backfill on all tables."""
    logger.info("Starting Unix timestamp backfill...")

    try:
        members_count = backfill_members()
        events_count = backfill_webapp_events()
        payments_count = backfill_payment_history()

        if members_count < 0 or events_count < 0 or payments_count < 0:
            logger.error("Backfill encountered errors!")
            return 1

        total = members_count + events_count + payments_count
        logger.info(f"Backfill complete: {total} total records updated")

        # Verify
        if verify_backfill():
            logger.info("✓ Verification successful — all records have Unix timestamps")
            return 0
        else:
            logger.warning("⚠ Verification found issues — see above")
            return 1

    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        return 1


if __name__ == '__main__':
    sys.exit(main())
