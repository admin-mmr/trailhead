# type: ignore
#!/usr/bin/env python3
"""
Nightly Sync: Google Sheets → MySQL

This script runs nightly to:
1. Check if Google Sheets (Membership Master) has changed
2. Create a snapshot and store in Azure Blob Storage
3. Compare to previous snapshot to detect row changes
4. Sync added/modified/deleted rows to MySQL
5. Log all changes to sync_changes and sync_conflicts tables
6. Handle bidirectional sync (MySQL → Google Sheets for GAS-driven updates)

Usage:
    python sync_sheets_to_mysql.py --sheet "Active" --table "gmail_transactions" --spreadsheet-id <ID> --key-field "TransactionID" [--dry-run]
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime
from typing import Dict, List, Optional, Any
from urllib.parse import urlparse

import mysql.connector
from mysql.connector import Error as MySQLError

# Add basecamp to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'python'))

from google_sheets_snapshot import GoogleSheetsSnapshot

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def validate_status(value: str) -> str:
    """
    Validate and normalize Status field.

    MySQL Status column is ENUM('active','not active','pending')
    Maps common variations to valid values.
    """
    if not value:
        return 'pending'

    value = value.strip().lower()

    # Map variations to valid ENUM values
    valid_statuses = {
        'active': 'active',
        'inactive': 'not active',
        'not active': 'not active',
        'notactive': 'not active',
        'pending': 'pending',
        'draft': 'pending',
    }

    return valid_statuses.get(value, 'pending')


def parse_enum_values(col_type: str) -> Optional[List[str]]:
    """
    Parse ENUM allowed values from a MySQL column type string.

    E.g. "enum('Zelle','Venmo','Other')" → ['Zelle', 'Venmo', 'Other']
    Returns None if the type is not an ENUM.
    """
    import re
    col_type = col_type.strip()
    if not col_type.lower().startswith('enum('):
        return None
    # Extract quoted values inside enum(...)
    matches = re.findall(r"'([^']*)'", col_type)
    return matches if matches else []


def validate_enum_value(value: str, col_type: str) -> Optional[str]:
    """
    Validate a value against a MySQL ENUM column type.

    Returns the correctly-cased value if valid, or None if not a valid option.
    Comparison is case-insensitive.
    """
    allowed = parse_enum_values(col_type)
    if allowed is None:
        return value  # not an enum column, pass through

    value_lower = value.strip().lower()
    for option in allowed:
        if option.lower() == value_lower:
            return option  # return with correct casing

    return None  # not a valid enum value


def parse_database_url(database_url: str) -> Dict[str, str]:
    """
    Parse DATABASE_URL in format: mysql://user:password@host:port/database
    Returns dict suitable for mysql.connector.connect()
    """
    parsed = urlparse(database_url)

    config = {
        'user': parsed.username or 'root',
        'password': parsed.password or '',
        'host': parsed.hostname or 'localhost',
        'port': parsed.port or 3306,
        'database': parsed.path.lstrip('/') if parsed.path else '',
    }

    return config


def convert_datetime_to_mysql(value: str, date_only: bool = False) -> Optional[str]:
    """
    Convert any date/datetime format from Google Sheets to MySQL DATE or DATETIME.

    Handles all formats Google Sheets can produce:
    - ISO 8601:           "2026-03-19T20:26:21.843Z"          → "2026-03-19 20:26:21"
    - ISO 8601 no Z:      "2026-03-19T20:26:21"               → "2026-03-19 20:26:21"
    - JavaScript:         "Sun Jan 11 2026 00:00:00 GMT-0500"  → "2026-01-11 00:00:00"
    - MySQL datetime:     "2026-03-19 20:26:21"               → "2026-03-19 20:26:21"
    - MySQL date:         "2026-03-19"                        → "2026-03-19"
    - Short month:        "Mar 21, 2026"                      → "2026-03-21"
    - Long month:         "March 21, 2026"                    → "2026-03-21"
    - Month with time:    "Mar 21, 2026 10:30 AM"             → "2026-03-21 10:30:00"
    - US slash:           "03/21/2026"                        → "2026-03-21"
    - US slash short:     "3/21/2026"                         → "2026-03-21"
    - US slash datetime:  "03/21/2026 10:30 AM"               → "2026-03-21 10:30:00"
    - Reverse slash:      "2026/03/21"                        → "2026-03-21"
    - Sheets serial:      "45842"                             → "2026-03-21" (Excel epoch)
    - dateutil fallback:  any other recognizable format

    Args:
        date_only: If True, return YYYY-MM-DD. If False, return YYYY-MM-DD HH:MM:SS.

    Returns None for empty/invalid values.
    """
    if not value or not isinstance(value, str):
        return None

    value = value.strip()
    if not value:
        return None

    dt = None

    try:
        # ── 1. Google Sheets / Excel serial number (integer-like, e.g. "45842") ──
        if value.isdigit() and len(value) <= 6:
            serial = int(value)
            if 1 <= serial <= 99999:          # plausible date range
                from datetime import timedelta
                # Sheets uses Dec 30 1899 epoch (same as Excel, skipping the 1900 leap-year bug)
                epoch = datetime(1899, 12, 30)
                dt = epoch + timedelta(days=serial)

        # ── 2. JavaScript Date.toString() ──────────────────────────────────────
        # "Sun Jan 11 2026 00:00:00 GMT-0500 (Eastern Standard Time)"
        if dt is None and ' GMT' in value:
            part = value.split(' GMT')[0].strip()
            dt = datetime.strptime(part, '%a %b %d %Y %H:%M:%S')

        # ── 3. ISO 8601 with Z ─────────────────────────────────────────────────
        if dt is None and 'T' in value and value.endswith('Z'):
            clean = value.replace('Z', '+00:00')
            if '.' in clean:
                clean = clean.split('.')[0] + '+00:00'
            dt = datetime.fromisoformat(clean).replace(tzinfo=None)

        # ── 4. ISO 8601 without Z ──────────────────────────────────────────────
        if dt is None and 'T' in value:
            dt = datetime.fromisoformat(value.split('.')[0])

        # ── 5. Explicit named-month patterns ──────────────────────────────────
        if dt is None:
            named_month_patterns = [
                '%b %d, %Y %I:%M %p',   # Mar 21, 2026 10:30 AM
                '%B %d, %Y %I:%M %p',   # March 21, 2026 10:30 AM
                '%b %d, %Y %H:%M:%S',   # Mar 21, 2026 10:30:00
                '%B %d, %Y %H:%M:%S',   # March 21, 2026 10:30:00
                '%b %d, %Y',            # Mar 21, 2026
                '%B %d, %Y',            # March 21, 2026
                '%b %d %Y',             # Mar 21 2026
                '%B %d %Y',             # March 21 2026
            ]
            for fmt in named_month_patterns:
                try:
                    dt = datetime.strptime(value, fmt)
                    break
                except ValueError:
                    continue

        # ── 6. Numeric date patterns ───────────────────────────────────────────
        if dt is None:
            numeric_patterns = [
                '%Y-%m-%d %H:%M:%S',    # 2026-03-21 10:30:00  (MySQL)
                '%Y-%m-%d %H:%M',       # 2026-03-21 10:30
                '%Y-%m-%d %I:%M %p',    # 2026-03-21 10:30 AM
                '%Y-%m-%d',             # 2026-03-21
                '%Y/%m/%d %H:%M:%S',    # 2026/03/21 10:30:00
                '%Y/%m/%d %H:%M',       # 2026/03/21 10:30
                '%Y/%m/%d',             # 2026/03/21
                '%m/%d/%Y %I:%M %p',    # 03/21/2026 10:30 AM
                '%m/%d/%Y %H:%M:%S',    # 03/21/2026 10:30:00
                '%m/%d/%Y %H:%M',       # 03/21/2026 10:30
                '%m/%d/%Y',             # 03/21/2026
                '%m-%d-%Y',             # 03-21-2026
            ]
            for fmt in numeric_patterns:
                try:
                    dt = datetime.strptime(value, fmt)
                    break
                except ValueError:
                    continue

        # ── 7. dateutil fallback (handles most remaining formats) ─────────────
        if dt is None:
            try:
                from dateutil import parser as dateutil_parser
                dt = dateutil_parser.parse(value, dayfirst=False)
                dt = dt.replace(tzinfo=None)   # strip timezone for MySQL
            except Exception:
                pass

        if dt is None:
            return None

        return dt.strftime('%Y-%m-%d') if date_only else dt.strftime('%Y-%m-%d %H:%M:%S')

    except Exception:
        return None


class SheetSyncer:
    """Syncs a single Google Sheet to MySQL"""

    def __init__(self, table_name: str, connection: mysql.connector.MySQLConnection):
        """
        Initialize syncer for a specific table.

        Args:
            table_name: MySQL table name (members, gmail_transactions, payments, events, etc.)
            connection: MySQL connection object
        """
        self.table_name = table_name
        self.connection = connection

    def get_table_schema(self) -> Dict[str, str]:
        """
        Get column definitions from MySQL database.
        Returns dict of {column_name: data_type}
        """
        try:
            cursor = self.connection.cursor(dictionary=True)
            cursor.execute(f"""
                SELECT COLUMN_NAME, COLUMN_TYPE
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
            """, (self.table_name,))
            columns = {}
            for row in cursor.fetchall():
                columns[row['COLUMN_NAME']] = row['COLUMN_TYPE']
            cursor.close()
            return columns
        except MySQLError as e:
            logger.error(f'Failed to get schema for {self.table_name}: {e}')
            return {}

    def get_required_columns(self) -> set:
        """
        Get the set of column names that are NOT NULL and have no default value.
        These columns MUST be present and non-empty in any INSERT or the row must be skipped.

        Returns a set of column name strings.
        """
        try:
            cursor = self.connection.cursor(dictionary=True)
            cursor.execute("""
                SELECT COLUMN_NAME
                FROM information_schema.COLUMNS
                WHERE TABLE_SCHEMA = DATABASE()
                  AND TABLE_NAME = %s
                  AND IS_NULLABLE = 'NO'
                  AND COLUMN_DEFAULT IS NULL
                  AND EXTRA NOT LIKE '%auto_increment%'
            """, (self.table_name,))
            required = {row['COLUMN_NAME'] for row in cursor.fetchall()}
            cursor.close()
            return required
        except MySQLError as e:
            logger.warning(f'Could not determine required columns for {self.table_name}: {e}')
            return set()

    def record_snapshot_in_db(self, current_snapshot: Dict[str, Any]) -> int:
        """Record snapshot metadata in sync_snapshots table"""
        try:
            snapshot_ts = convert_datetime_to_mysql(current_snapshot['timestamp'])
            google_modified_at = convert_datetime_to_mysql(current_snapshot.get('google_modified_at')) if current_snapshot.get('google_modified_at') else None
            blob_url = current_snapshot.get('blob_url')

            # Store snapshot data as JSON in the database for later retrieval
            snapshot_json = json.dumps({
                'rows': current_snapshot.get('rows', []),
                'hash': current_snapshot['hash'],
                'key_field': current_snapshot.get('key_field', 'Email'),
                'row_count': current_snapshot['row_count']
            })

            cursor = self.connection.cursor()
            cursor.execute("""
                INSERT INTO sync_snapshots
                (sheet_name, row_count, snapshot_hash, snapshot_timestamp, google_modified_at, snapshot_data_url)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                self.table_name,
                current_snapshot['row_count'],
                current_snapshot['hash'],
                snapshot_ts,
                google_modified_at,
                snapshot_json  # Store the JSON here instead of blob URL
            ))

            snapshot_id = cursor.lastrowid
            self.connection.commit()
            cursor.close()

            logger.info(f'Recorded snapshot {snapshot_id} in DB')
            return snapshot_id

        except MySQLError as e:
            logger.error(f'Failed to record snapshot: {e}')
            self.connection.rollback()
            raise

    def record_change(
        self,
        sheet_name: str,
        snapshot_id: int,
        change_type: str,
        key_value: str,
        old_data: Optional[Dict[str, str]],
        new_data: Optional[Dict[str, str]]
    ) -> None:
        """Record a sync change in sync_changes table"""
        try:
            old_json = json.dumps(old_data) if old_data else None
            new_json = json.dumps(new_data) if new_data else None

            cursor = self.connection.cursor()
            cursor.execute("""
                INSERT INTO sync_changes
                (sheet_name, snapshot_id, change_type, row_key, old_values, new_values)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                sheet_name,
                snapshot_id,
                change_type,
                key_value,
                old_json,
                new_json
            ))

            self.connection.commit()
            cursor.close()

        except MySQLError as e:
            logger.error(f'Failed to record change: {e}')
            self.connection.rollback()
            raise

    def sync_row(self, row: Dict[str, str], change_type: str, key_field: str, key_value: str) -> bool:
        """
        Sync a single row (generic for any table).

        Returns True if synced successfully, False if skipped/error
        """
        try:
            if not key_value:
                return False

            cursor = self.connection.cursor(dictionary=True)

            # Check if row exists
            cursor.execute(f"SELECT * FROM {self.table_name} WHERE {key_field} = %s", (key_value,))
            existing = cursor.fetchone()

            if change_type == 'added':
                if existing:
                    # Row exists - skip (update handled separately if needed)
                    cursor.close()
                    return False
                else:
                    # New row - insert with columns that exist in this table
                    schema = self.get_table_schema()
                    required_cols = self.get_required_columns()
                    insert_cols = []
                    insert_vals = []
                    insert_params = []

                    for col_name, col_value in row.items():
                        # Only insert columns that exist in this table
                        if col_name in schema:
                            col_value_clean = col_value.strip() if isinstance(col_value, str) else col_value
                            if not col_value_clean:
                                continue

                            col_type = schema[col_name]       # preserve original casing for ENUM parsing
                            col_type_lower = col_type.lower()

                            # Handle date/datetime conversion
                            if 'date' in col_type_lower or 'timestamp' in col_type_lower:
                                date_only = col_type_lower.startswith('date') and 'datetime' not in col_type_lower
                                converted = convert_datetime_to_mysql(str(col_value_clean), date_only=date_only)
                                if converted:
                                    col_value_clean = converted
                                else:
                                    logger.debug(f'Skipping unparseable date in {col_name}: {col_value_clean}')
                                    continue

                            # Handle ENUM validation generically (Status, Source, etc.)
                            if 'enum' in col_type_lower:
                                if col_name == 'Status':
                                    col_value_clean = validate_status(str(col_value_clean))
                                else:
                                    validated = validate_enum_value(str(col_value_clean), col_type)
                                    if validated is None:
                                        logger.warning(
                                            f'Skipping invalid ENUM value for {col_name}={col_value_clean!r} '
                                            f'in {self.table_name} (allowed: {parse_enum_values(col_type)})'
                                        )
                                        continue  # skip this column; it's NULL-able so omit it
                                    col_value_clean = validated

                            insert_cols.append(col_name)
                            insert_vals.append('%s')
                            insert_params.append(col_value_clean)

                    # Check that all NOT NULL / no-default columns are covered
                    missing_required = required_cols - set(insert_cols)
                    if missing_required:
                        logger.warning(
                            f'Skipping row {key_field}={key_value!r} in {self.table_name}: '
                            f'missing required column(s) with no default: {sorted(missing_required)}'
                        )
                        cursor.close()
                        return False

                    if insert_cols:
                        query = f"INSERT INTO {self.table_name} ({', '.join(insert_cols)}) VALUES ({', '.join(insert_vals)})"
                        cursor.execute(query, insert_params)
                        self.connection.commit()
                        logger.info(f'Added row to {self.table_name} with {key_field}={key_value}')
                        cursor.close()
                        return True
                    else:
                        cursor.close()
                        return False

            elif change_type == 'modified':
                if not existing:
                    cursor.close()
                    return False

                # Update row
                schema = self.get_table_schema()
                update_fields = []
                update_params = []

                for col_name, col_value in row.items():
                    if col_name in schema and col_name != key_field:
                        col_value_clean = col_value.strip() if isinstance(col_value, str) else col_value
                        if col_value_clean:
                            col_type = schema[col_name]       # preserve original casing for ENUM parsing
                            col_type_lower = col_type.lower()

                            # Handle date/datetime conversion
                            if 'date' in col_type_lower or 'timestamp' in col_type_lower:
                                date_only = col_type_lower.startswith('date') and 'datetime' not in col_type_lower
                                converted = convert_datetime_to_mysql(str(col_value_clean), date_only=date_only)
                                if converted:
                                    col_value_clean = converted
                                else:
                                    logger.debug(f'Skipping unparseable date in {col_name}: {col_value_clean}')
                                    continue

                            # Handle ENUM validation generically (Status, Source, etc.)
                            if 'enum' in col_type_lower:
                                if col_name == 'Status':
                                    col_value_clean = validate_status(str(col_value_clean))
                                else:
                                    validated = validate_enum_value(str(col_value_clean), col_type)
                                    if validated is None:
                                        logger.warning(
                                            f'Skipping invalid ENUM value for {col_name}={col_value_clean!r} '
                                            f'in {self.table_name} (allowed: {parse_enum_values(col_type)})'
                                        )
                                        continue  # skip this field update; leave DB value unchanged
                                    col_value_clean = validated

                            update_fields.append(f'{col_name} = %s')
                            update_params.append(col_value_clean)

                if update_fields:
                    update_params.append(key_value)
                    query = f"UPDATE {self.table_name} SET {', '.join(update_fields)} WHERE {key_field} = %s"
                    cursor.execute(query, update_params)
                    self.connection.commit()
                    logger.info(f'Updated row in {self.table_name} with {key_field}={key_value}')
                    cursor.close()
                    return True
                else:
                    cursor.close()
                    return False

            elif change_type == 'deleted':
                if not existing:
                    cursor.close()
                    return False

                # Soft delete if Status column exists, otherwise hard delete
                schema = self.get_table_schema()
                if 'Status' in schema:
                    cursor.execute(
                        f"UPDATE {self.table_name} SET Status = 'deleted' WHERE {key_field} = %s",
                        (key_value,)
                    )
                else:
                    cursor.execute(f"DELETE FROM {self.table_name} WHERE {key_field} = %s", (key_value,))

                self.connection.commit()
                logger.info(f'Deleted row in {self.table_name} with {key_field}={key_value}')
                cursor.close()
                return True

            cursor.close()
            return False

        except Exception as e:
            logger.error(f'Error syncing row: {e}', exc_info=True)
            return False

    def sync_changes(
        self,
        sheet_name: str,
        spreadsheet_id: str,
        sheet_range: str,
        key_field: str,
        dry_run: bool = False
    ) -> None:
        """
        Full sync workflow: detect changes in Google Sheets and sync to MySQL.
        """
        try:
            # Create snapshot
            snapshot_mgr = GoogleSheetsSnapshot()
            current_snapshot = snapshot_mgr.create_snapshot(
                sheet_name,
                spreadsheet_id,
                sheet_range,
                key_field
            )

            logger.info(f'Created snapshot: {current_snapshot["hash"][:8]}, {current_snapshot["row_count"]} rows')

            # Try to get previous snapshot
            previous_snapshot = self._get_previous_snapshot(sheet_name)

            # Detect changes
            if previous_snapshot:
                changes = snapshot_mgr.detect_changes(previous_snapshot, current_snapshot)
                logger.info(f'Detected changes: {changes["added"].__len__()} added, {changes["modified"].__len__()} modified, {changes["deleted"].__len__()} deleted')
            else:
                # First sync - treat all rows as added
                changes = {
                    'added': current_snapshot['rows'],
                    'modified': [],
                    'deleted': [],
                    'total_changes': len(current_snapshot['rows'])
                }
                logger.info(f'First sync for this sheet, treating all rows as added')

            if dry_run:
                logger.info('DRY RUN: Not syncing changes')
                return

            # Record snapshot in DB
            snapshot_id = self.record_snapshot_in_db(current_snapshot)

            # Sync changes
            rows_synced = 0
            rows_added = 0
            rows_modified = 0
            rows_deleted = 0

            for row in changes['added']:
                key_value = row.get(key_field, '').strip()
                if self.sync_row(row, 'added', key_field, key_value):
                    rows_added += 1
                self.record_change(sheet_name, snapshot_id, 'added', key_value, None, row)
                rows_synced += 1

            for change in changes['modified']:
                key_value = change['key']
                if self.sync_row(change['new'], 'modified', key_field, key_value):
                    rows_modified += 1
                self.record_change(
                    sheet_name, snapshot_id, 'modified',
                    key_value,
                    change['old'],
                    change['new']
                )
                rows_synced += 1

            for row in changes['deleted']:
                key_value = row.get(key_field, '').strip()
                if self.sync_row(row, 'deleted', key_field, key_value):
                    rows_deleted += 1
                self.record_change(sheet_name, snapshot_id, 'deleted', key_value, row, None)
                rows_synced += 1

            # Mark snapshot as processed (optional)
            try:
                cursor = self.connection.cursor()
                cursor.execute("""
                    UPDATE sync_snapshots SET status = 'processed'
                    WHERE snapshot_id = %s
                """, (snapshot_id,))
                self.connection.commit()
                cursor.close()
            except Exception:
                pass

            # Update sync_metadata (optional)
            try:
                cursor = self.connection.cursor()
                cursor.execute("""
                    UPDATE sync_metadata
                    SET last_synced_at = NOW(),
                        last_snapshot_hash = %s,
                        sync_status = 'idle',
                        rows_synced = %s,
                        rows_added = %s,
                        rows_modified = %s,
                        rows_deleted = %s
                    WHERE sheet_name = %s
                """, (
                    current_snapshot['hash'],
                    rows_synced,
                    rows_added,
                    rows_modified,
                    rows_deleted,
                    sheet_name
                ))
                self.connection.commit()
                cursor.close()
            except Exception:
                pass

            logger.info(f'Sync completed: {rows_synced} total, {rows_added} added, {rows_modified} modified, {rows_deleted} deleted')

        except Exception as e:
            logger.error(f'Sync failed: {e}', exc_info=True)
            raise

    def _get_previous_snapshot(self, sheet_name: str) -> Optional[Dict[str, Any]]:
        """Get previous snapshot from database"""
        try:
            cursor = self.connection.cursor(dictionary=True)
            cursor.execute("""
                SELECT snapshot_data_url
                FROM sync_snapshots
                WHERE sheet_name = %s
                ORDER BY snapshot_id DESC
                LIMIT 1
            """, (sheet_name,))
            result = cursor.fetchone()
            cursor.close()

            if not result or not result.get('snapshot_data_url'):
                logger.info(f'No previous snapshot found for {sheet_name} - first sync')
                return None

            snapshot_data = result['snapshot_data_url']

            # Try to parse as JSON (new format - stored in DB)
            try:
                previous_snapshot = json.loads(snapshot_data)
                logger.info(f'Retrieved previous snapshot for {sheet_name}: hash={previous_snapshot.get("hash", "")[:8]}, rows={previous_snapshot.get("row_count", 0)}')
                return previous_snapshot
            except json.JSONDecodeError:
                # Might be old format (blob URL) - just treat as first sync
                logger.info(f'Previous snapshot format unrecognized - treating as first sync')
                return None

        except MySQLError as e:
            logger.warning(f'Could not get previous snapshot from DB: {e}')
            return None


def main():
    parser = argparse.ArgumentParser(description='Sync Google Sheets to MySQL')
    parser.add_argument('--sheet', required=True, help='Sheet name (e.g., "Active")')
    parser.add_argument('--table', required=True, help='MySQL table name (e.g., "gmail_transactions")')
    parser.add_argument('--spreadsheet-id', required=True, help='Google Sheets ID')
    parser.add_argument('--sheet-range', default=None, help='Sheet range to sync (e.g. "Active!A:Z"). Defaults to <sheet>!A:Z.')
    parser.add_argument('--key-field', default='Email', help='Column to use as row key')
    parser.add_argument('--dry-run', action='store_true', help='Detect changes but do not sync')

    args = parser.parse_args()

    # Default sheet_range to <sheet>!A:Z if not provided
    if not args.sheet_range:
        args.sheet_range = f'{args.sheet}!A:Z'

    # In dry-run mode: just snapshot + diff Google Sheets, no MySQL needed
    if args.dry_run:
        logger.info('DRY RUN — connecting to Google Sheets only (no MySQL)')
        snapshot_mgr = GoogleSheetsSnapshot()
        snapshot = snapshot_mgr.create_snapshot(
            args.sheet,
            args.spreadsheet_id,
            args.sheet_range,
            args.key_field
        )
        logger.info(f'Snapshot created: hash={snapshot["hash"][:8]}, rows={snapshot["row_count"]}')
        logger.info('DRY RUN complete. Pass --no-dry-run or omit --dry-run to sync to MySQL.')

        # Print a sample of the data
        sample = snapshot['rows'][:3]
        if sample:
            logger.info(f'Sample rows (first 3): {json.dumps(sample, indent=2, default=str)[:500]}...')
        return

    # Connect to MySQL
    try:
        database_url = os.environ.get('DATABASE_URL')
        if not database_url:
            raise ValueError('DATABASE_URL environment variable not set')

        db_config = parse_database_url(database_url)
        db_config['auth_plugin'] = 'mysql_native_password'

        conn = mysql.connector.connect(**db_config)
        logger.info('Connected to MySQL')
    except MySQLError as e:
        logger.error(f'Failed to connect to MySQL: {e}')
        sys.exit(1)

    try:
        syncer = SheetSyncer(args.table, conn)
        syncer.sync_changes(args.sheet, args.spreadsheet_id, args.sheet_range, args.key_field, args.dry_run)
    finally:
        conn.close()


if __name__ == '__main__':
    main()
