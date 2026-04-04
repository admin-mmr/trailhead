#!/usr/bin/env python3
"""
test_export_timestamp_logging.py — Test the enhanced timestamp checking logic.

Run this to verify that:
1. sheets_sync_log is being queried correctly
2. Timestamp filtering is working as expected
3. Verbose logging shows what's happening
"""

import logging
from datetime import datetime, timedelta
import sys

# Configure logging to see all the [TIMESTAMP CHECK] and [TIMESTAMP FILTER] messages
logging.basicConfig(
    level=logging.DEBUG,
    format='%(asctime)s %(levelname)s %(name)s: %(message)s'
)

logger = logging.getLogger(__name__)

def mock_db_query(sql, params=None):
    """Mock database query for testing."""
    logger.debug(f"[MOCK DB] Executing query: {sql[:100]}...")

    if "MAX(CompletedAt)" in sql and "sheets_sync_log" in sql:
        # Simulate: there's a prior successful export that completed 10 minutes ago
        last_completed = (datetime.now() - timedelta(minutes=10)).strftime('%Y-%m-%d %H:%M:%S')
        logger.debug(f"[MOCK DB] Returning last completed: {last_completed}")
        return [{'LastCompletedTime': last_completed}]

    if "WHERE UpdatedAt >" in sql:
        # Simulate: found 42 rows updated since last sync
        logger.debug(f"[MOCK DB] Returning 42 rows")
        return [{'id': i} for i in range(42)]

    if "FROM members" in sql and "WHERE" not in sql:
        # Fallback: all members
        logger.debug(f"[MOCK DB] Returning all 624 members")
        return [{'id': i} for i in range(624)]

    return []

# Test case 1: Normal delta sync (should fetch only changed rows)
logger.info("=" * 80)
logger.info("TEST CASE 1: Delta sync (prior successful export exists)")
logger.info("=" * 80)

cols = ['MemberID', 'Email', 'UpdatedAt']
table = 'members'
config_key = 'export_members'

col_list = ", ".join(cols)
if 'UpdatedAt' in cols:
    logger.info(f"[TIMESTAMP CHECK] Looking for last successful sync: config_key={config_key}, table={table}, direction=mysql_to_sheet")
    try:
        last_sync_query = mock_db_query("""
            SELECT MAX(CompletedAt) as LastCompletedTime
            FROM sheets_sync_log
            WHERE ConfigKey = %s AND Direction = %s AND Status = 'success'
        """, [config_key, 'mysql_to_sheet'])

        last_sync_time = None
        if last_sync_query and last_sync_query[0]:
            last_sync_time = last_sync_query[0].get('LastCompletedTime')

        if last_sync_time:
            logger.info(f"[TIMESTAMP CHECK] ✓ Found last successful sync completed at: {last_sync_time}")
            rows = mock_db_query(f"SELECT {col_list} FROM {table} WHERE UpdatedAt > %s", [last_sync_time])
            logger.info(f"[TIMESTAMP FILTER] ✓ Applied UpdatedAt > {last_sync_time}. Result: {len(rows)} rows to export")
        else:
            logger.info(f"[TIMESTAMP CHECK] ⚠ No prior successful sync found for {config_key} — treating as first sync")
            rows = mock_db_query(f"SELECT {col_list} FROM {table}")
            logger.info(f"[TIMESTAMP FILTER] ⚠ First sync detected: exporting all {len(rows)} rows")
    except Exception as ts_err:
        logger.error(f"[TIMESTAMP CHECK] ✗ Failed to query sheets_sync_log: {str(ts_err)}")
        logger.warning(f"[TIMESTAMP FILTER] Falling back to unfiltered export (all rows)")
        rows = mock_db_query(f"SELECT {col_list} FROM {table}")
        logger.warning(f"[TIMESTAMP FILTER] Fetched all {len(rows)} rows (timestamp check unavailable)")

logger.info(f"Result: Would export {len(rows)} rows (expected ~42)")
logger.info("")

# Test case 2: First sync (no prior records)
logger.info("=" * 80)
logger.info("TEST CASE 2: First sync (no prior export)")
logger.info("=" * 80)

def mock_db_query_first_sync(sql, params=None):
    """Mock for first-ever sync scenario."""
    if "MAX(CompletedAt)" in sql:
        # No prior syncs
        return [{'LastCompletedTime': None}]
    if "FROM members" in sql:
        return [{'id': i} for i in range(624)]
    return []

col_list = ", ".join(cols)
if 'UpdatedAt' in cols:
    logger.info(f"[TIMESTAMP CHECK] Looking for last successful sync: config_key={config_key}, table={table}, direction=mysql_to_sheet")
    try:
        last_sync_query = mock_db_query_first_sync("""
            SELECT MAX(CompletedAt) as LastCompletedTime
            FROM sheets_sync_log
            WHERE ConfigKey = %s AND Direction = %s AND Status = 'success'
        """, [config_key, 'mysql_to_sheet'])

        last_sync_time = None
        if last_sync_query and last_sync_query[0]:
            last_sync_time = last_sync_query[0].get('LastCompletedTime')

        if last_sync_time:
            logger.info(f"[TIMESTAMP CHECK] ✓ Found last successful sync completed at: {last_sync_time}")
            rows = mock_db_query_first_sync(f"SELECT {col_list} FROM {table} WHERE UpdatedAt > %s", [last_sync_time])
            logger.info(f"[TIMESTAMP FILTER] ✓ Applied UpdatedAt > {last_sync_time}. Result: {len(rows)} rows to export")
        else:
            logger.info(f"[TIMESTAMP CHECK] ⚠ No prior successful sync found for {config_key} — treating as first sync")
            rows = mock_db_query_first_sync(f"SELECT {col_list} FROM {table}")
            logger.info(f"[TIMESTAMP FILTER] ⚠ First sync detected: exporting all {len(rows)} rows")
    except Exception as ts_err:
        logger.error(f"[TIMESTAMP CHECK] ✗ Failed to query sheets_sync_log: {str(ts_err)}")
        logger.warning(f"[TIMESTAMP FILTER] Falling back to unfiltered export (all rows)")
        rows = mock_db_query_first_sync(f"SELECT {col_list} FROM {table}")
        logger.warning(f"[TIMESTAMP FILTER] Fetched all {len(rows)} rows (timestamp check unavailable)")

logger.info(f"Result: Would export {len(rows)} rows (expected 624 for first sync)")
logger.info("")

logger.info("=" * 80)
logger.info("✓ Test complete — check log output above for [TIMESTAMP CHECK] and [TIMESTAMP FILTER] messages")
logger.info("=" * 80)
