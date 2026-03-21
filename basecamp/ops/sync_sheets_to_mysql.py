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
    python sync_sheets_to_mysql.py --sheet "Membership Master" --spreadsheet-id <ID> [--dry-run]
"""

import argparse
import json
import logging
import os
import sys
from datetime import datetime
from typing import Dict, List, Optional, Any

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


class SheetsToMySQLSync:
    """Sync Google Sheets to MySQL with conflict detection"""

    def __init__(self, mysql_config: Dict[str, str]):
        """Initialize MySQL connection"""
        self.mysql_config = mysql_config
        self.connection = None
        self.snapshot_mgr = GoogleSheetsSnapshot()

    def connect(self):
        """Connect to MySQL"""
        try:
            self.connection = mysql.connector.connect(**self.mysql_config)
            logger.info('Connected to MySQL')
        except MySQLError as e:
            logger.error(f'MySQL connection failed: {e}')
            raise

    def close(self):
        """Close MySQL connection"""
        if self.connection:
            self.connection.close()
            logger.info('MySQL connection closed')

    def get_last_snapshot(self, sheet_name: str) -> Optional[Dict[str, Any]]:
        """Get the last processed snapshot from DB"""
        try:
            cursor = self.connection.cursor(dictionary=True)

            # Get the last processed snapshot
            cursor.execute("""
                SELECT snapshot_id, sheet_name, snapshot_hash, row_count, snapshot_timestamp
                FROM sync_snapshots
                WHERE sheet_name = %s AND status = 'processed'
                ORDER BY snapshot_timestamp DESC
                LIMIT 1
            """, (sheet_name,))

            result = cursor.fetchone()
            cursor.close()

            return result
        except MySQLError as e:
            logger.error(f'Failed to get last snapshot: {e}')
            return None

    def record_snapshot_in_db(
        self,
        snapshot: Dict[str, Any]
    ) -> int:
        """Record snapshot metadata in sync_snapshots table. Returns snapshot_id."""
        try:
            cursor = self.connection.cursor()

            cursor.execute("""
                INSERT INTO sync_snapshots
                (sheet_name, snapshot_hash, row_count, snapshot_timestamp, google_modified_at, snapshot_data_url)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                snapshot['sheet_name'],
                snapshot['hash'],
                snapshot['row_count'],
                snapshot['timestamp'],
                snapshot['google_modified_at'],
                snapshot['blob_url']
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
        change_type: str,  # 'added', 'modified', 'deleted'
        row_key: str,
        old_values: Optional[Dict],
        new_values: Optional[Dict]
    ) -> int:
        """Record a detected change. Returns change_id."""
        try:
            cursor = self.connection.cursor()

            cursor.execute("""
                INSERT INTO sync_changes
                (sheet_name, snapshot_id, change_type, row_key, old_values, new_values)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (
                sheet_name,
                snapshot_id,
                change_type,
                row_key,
                json.dumps(old_values) if old_values else None,
                json.dumps(new_values) if new_values else None
            ))

            change_id = cursor.lastrowid
            self.connection.commit()
            cursor.close()

            return change_id

        except MySQLError as e:
            logger.error(f'Failed to record change: {e}')
            self.connection.rollback()
            raise

    def sync_member_row(self, row: Dict[str, str], change_type: str) -> bool:
        """
        Sync a member row from Google Sheets to MySQL.

        Returns:
            True if synced successfully, False if conflict/error
        """
        try:
            email = row.get('Email', '').strip()
            if not email:
                logger.warning(f'Skipping row with missing email: {row}')
                return False

            cursor = self.connection.cursor(dictionary=True)

            # Check if member exists
            cursor.execute('SELECT MemberID FROM members WHERE Email = %s', (email,))
            existing = cursor.fetchone()

            if change_type == 'added':
                if existing:
                    logger.warning(f'Member {email} already exists (conflict)')
                    cursor.close()
                    return False  # Conflict

                # Create new member
                first_name = row.get('FirstName', 'Unknown')
                last_name = row.get('LastName', 'Unknown')
                status = row.get('Status', 'pending')

                cursor.execute("""
                    INSERT INTO members (MemberID, Email, FirstName, LastName, Status, CreatedAt)
                    VALUES (UUID(), %s, %s, %s, %s, NOW())
                """, (email, first_name, last_name, status))

                self.connection.commit()
                logger.info(f'Added member: {email}')

            elif change_type == 'modified':
                if not existing:
                    logger.warning(f'Member {email} not found for update')
                    cursor.close()
                    return False

                # Update member
                member_id = existing['MemberID']

                update_fields = []
                update_values = []

                # Map Google Sheets columns to MySQL
                column_mapping = {
                    'FirstName': 'FirstName',
                    'LastName': 'LastName',
                    'Status': 'Status',
                    'District': 'District',
                    'Gender': 'Gender',
                    'PhoneNumber': 'PhoneNumber',
                }

                for sheets_col, mysql_col in column_mapping.items():
                    if sheets_col in row:
                        update_fields.append(f'{mysql_col} = %s')
                        update_values.append(row[sheets_col])

                if update_fields:
                    update_values.append(member_id)
                    query = f"UPDATE members SET {', '.join(update_fields)} WHERE MemberID = %s"
                    cursor.execute(query, update_values)
                    self.connection.commit()
                    logger.info(f'Updated member: {email}')

            elif change_type == 'deleted':
                if not existing:
                    logger.warning(f'Member {email} not found for deletion')
                    cursor.close()
                    return False

                # Mark as deleted (soft delete)
                cursor.execute("""
                    UPDATE members SET Status = 'deleted' WHERE Email = %s
                """, (email,))
                self.connection.commit()
                logger.info(f'Marked member as deleted: {email}')

            cursor.close()
            return True

        except MySQLError as e:
            logger.error(f'Failed to sync member {email}: {e}')
            self.connection.rollback()
            return False

    def sync_changes(
        self,
        sheet_name: str,
        spreadsheet_id: str,
        sheet_range: str,
        key_field: str = 'Email',
        dry_run: bool = False
    ):
        """
        Main sync logic:
        1. Check if sheet changed
        2. Create snapshot
        3. Detect changes
        4. Sync to MySQL
        5. Update sync_metadata
        """
        logger.info(f'Starting sync for {sheet_name}')

        try:
            # Update sync status to 'syncing'
            cursor = self.connection.cursor()
            cursor.execute("""
                UPDATE sync_metadata SET sync_status = 'syncing' WHERE sheet_name = %s
            """, (sheet_name,))
            self.connection.commit()
            cursor.close()

            # Check if sheet changed
            last_sync_metadata = self._get_sync_metadata(sheet_name)
            last_synced_at = last_sync_metadata['last_synced_at'] if last_sync_metadata else None

            if not self.snapshot_mgr.has_changed_since(spreadsheet_id, last_synced_at):
                logger.info(f'{sheet_name} has not changed, skipping sync')
                return

            # Create snapshot
            current_snapshot = self.snapshot_mgr.create_snapshot(
                sheet_name,
                spreadsheet_id,
                sheet_range,
                key_field
            )

            logger.info(f'Created snapshot: {current_snapshot["hash"][:8]}, {current_snapshot["row_count"]} rows')

            # Get last processed snapshot
            last_snapshot = self.get_last_snapshot(sheet_name)

            if not last_snapshot:
                logger.info('First sync for this sheet, treating all rows as added')
                changes = {
                    'added': current_snapshot['rows'],
                    'modified': [],
                    'deleted': []
                }
            else:
                # Load last snapshot data
                last_snapshot_data = {
                    'rows': last_snapshot.get('data', []),
                    'key_field': key_field
                }
                changes = self.snapshot_mgr.detect_changes(last_snapshot_data, current_snapshot)

            logger.info(f'Detected changes: {len(changes["added"])} added, {len(changes["modified"])} modified, {len(changes["deleted"])} deleted')

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
                if self.sync_member_row(row, 'added'):
                    rows_added += 1
                self.record_change(sheet_name, snapshot_id, 'added', row.get(key_field), None, row)
                rows_synced += 1

            for change in changes['modified']:
                if self.sync_member_row(change['new'], 'modified'):
                    rows_modified += 1
                self.record_change(
                    sheet_name, snapshot_id, 'modified',
                    change['key'],
                    change['old'],
                    change['new']
                )
                rows_synced += 1

            for row in changes['deleted']:
                if self.sync_member_row(row, 'deleted'):
                    rows_deleted += 1
                self.record_change(sheet_name, snapshot_id, 'deleted', row.get(key_field), row, None)
                rows_synced += 1

            # Mark snapshot as processed
            cursor = self.connection.cursor()
            cursor.execute("""
                UPDATE sync_snapshots SET status = 'processed', processed_at = NOW()
                WHERE snapshot_id = %s
            """, (snapshot_id,))
            self.connection.commit()
            cursor.close()

            # Update sync_metadata
            cursor = self.connection.cursor()
            cursor.execute("""
                UPDATE sync_metadata
                SET last_synced_at = NOW(),
                    last_sheets_modified = %s,
                    last_snapshot_hash = %s,
                    sync_status = 'idle',
                    rows_synced = %s,
                    rows_added = %s,
                    rows_modified = %s,
                    rows_deleted = %s
                WHERE sheet_name = %s
            """, (
                current_snapshot['google_modified_at'],
                current_snapshot['hash'],
                rows_synced,
                rows_added,
                rows_modified,
                rows_deleted,
                sheet_name
            ))
            self.connection.commit()
            cursor.close()

            logger.info(f'Sync completed: {rows_synced} total, {rows_added} added, {rows_modified} modified, {rows_deleted} deleted')

        except Exception as e:
            logger.error(f'Sync failed: {e}', exc_info=True)
            cursor = self.connection.cursor()
            cursor.execute("""
                UPDATE sync_metadata
                SET sync_status = 'error', last_error = %s
                WHERE sheet_name = %s
            """, (str(e), sheet_name))
            self.connection.commit()
            cursor.close()
            raise

    def _get_sync_metadata(self, sheet_name: str) -> Optional[Dict]:
        """Get sync metadata for a sheet"""
        try:
            cursor = self.connection.cursor(dictionary=True)
            cursor.execute("""
                SELECT * FROM sync_metadata WHERE sheet_name = %s
            """, (sheet_name,))
            result = cursor.fetchone()
            cursor.close()
            return result
        except MySQLError as e:
            logger.error(f'Failed to get sync metadata: {e}')
            return None


def main():
    parser = argparse.ArgumentParser(description='Sync Google Sheets to MySQL')
    parser.add_argument('--sheet', required=True, help='Sheet name (e.g., "Membership Master")')
    parser.add_argument('--spreadsheet-id', required=True, help='Google Sheets ID')
    parser.add_argument('--sheet-range', default='Membership Master!A:Z', help='Sheet range to sync')
    parser.add_argument('--key-field', default='Email', help='Column to use as row key')
    parser.add_argument('--dry-run', action='store_true', help='Detect changes but do not sync')

    args = parser.parse_args()

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
        logger.info(f'Sample rows (first 3): {sample}')
        return

    # Real sync: MySQL required
    mysql_password = os.environ.get('MYSQL_PASSWORD', '')
    if not mysql_password:
        logger.error(
            'MYSQL_PASSWORD is not set. Export it first:\n'
            '  export MYSQL_PASSWORD="your-azure-mysql-password"'
        )
        sys.exit(1)

    mysql_config = {
        'host': os.environ.get('MYSQL_HOST', 'mmr-mysql-v4.mysql.database.azure.com'),
        'user': os.environ.get('MYSQL_USER', 'mmradmin'),
        'password': mysql_password,
        'database': os.environ.get('MYSQL_DATABASE', 'mmrdb'),
    }

    syncer = SheetsToMySQLSync(mysql_config)
    try:
        syncer.connect()
        syncer.sync_changes(
            args.sheet,
            args.spreadsheet_id,
            args.sheet_range,
            args.key_field,
            dry_run=False
        )
    finally:
        syncer.close()


if __name__ == '__main__':
    main()
