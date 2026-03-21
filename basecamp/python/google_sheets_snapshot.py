"""
Google Sheets Snapshot Manager

Handles:
- Getting Google Sheets file metadata (modified time, revision ID)
- Checking if sheets have changed
- Creating snapshots and storing them in Azure Blob Storage
- Comparing snapshots to detect row-level changes
"""

import hashlib
import json
import logging
import os
from datetime import datetime
from typing import Optional, Dict, List, Any

logger = logging.getLogger(__name__)

from google.oauth2 import service_account
from googleapiclient.discovery import build
from azure.storage.blob import BlobServiceClient

# Google API scopes
SCOPES = ['https://www.googleapis.com/auth/drive', 'https://www.googleapis.com/auth/spreadsheets']


class GoogleSheetsSnapshot:
    """Snapshot and diff Google Sheets against previous state"""

    def __init__(self, google_credentials_path: Optional[str] = None):
        """
        Initialize with Google Cloud service account credentials.

        Args:
            google_credentials_path: Path to service account JSON.
                                   If None, uses GOOGLE_APPLICATION_CREDENTIALS env var.
        """
        if google_credentials_path is None:
            google_credentials_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')

        if not google_credentials_path or not os.path.exists(google_credentials_path):
            raise ValueError('GOOGLE_APPLICATION_CREDENTIALS not found')

        self.credentials = service_account.Credentials.from_service_account_file(
            google_credentials_path, scopes=SCOPES
        )
        self.drive_service = build('drive', 'v3', credentials=self.credentials)
        self.sheets_service = build('sheets', 'v4', credentials=self.credentials)

        # Azure Blob Storage — lazy init, only connects when actually uploading
        self._blob_client = None

    @property
    def blob_client(self) -> Optional['BlobServiceClient']:
        """Lazy-initialize blob client only when needed (skipped in dry-run)"""
        if self._blob_client is None:
            conn_str = os.environ.get('AZURE_STORAGE_CONNECTION_STRING', '')
            if conn_str:
                self._blob_client = BlobServiceClient.from_connection_string(conn_str)
        return self._blob_client

    def get_sheet_metadata(self, spreadsheet_id: str) -> Dict[str, Any]:
        """
        Get file metadata from Google Drive.
        Handles both regular Drive files and Shared Drive files.

        Returns:
            {
                'modified_time': ISO datetime string or None,
                'version': string or None
            }
        """
        try:
            # supportsAllDrives=True is required for files on Shared Drives
            file = self.drive_service.files().get(
                fileId=spreadsheet_id,
                fields='modifiedTime,version',
                supportsAllDrives=True
            ).execute()
            return {
                'modified_time': file.get('modifiedTime'),
                'version': file.get('version')
            }
        except Exception as e:
            # Drive metadata is optional — fall back gracefully
            # Change detection will use snapshot hash comparison instead
            logger.warning(f'Could not get Drive metadata (will use hash comparison): {e}')
            return {'modified_time': None, 'version': None}

    def has_changed_since(self, spreadsheet_id: str, last_check_time: Optional[str]) -> bool:
        """
        Check if spreadsheet was modified after last_check_time.
        Falls back to True (always sync) if Drive metadata is unavailable.
        """
        if last_check_time is None:
            return True  # First sync

        metadata = self.get_sheet_metadata(spreadsheet_id)

        if not metadata['modified_time']:
            # Drive API unavailable — let snapshot hash comparison decide
            logger.info('Drive modified_time unavailable — proceeding to snapshot for hash comparison')
            return True

        modified_time = datetime.fromisoformat(metadata['modified_time'].replace('Z', '+00:00'))
        last_check = datetime.fromisoformat(last_check_time)
        return modified_time > last_check

    def get_sheet_data(self, spreadsheet_id: str, sheet_range: str) -> List[Dict[str, Any]]:
        """
        Read sheet data as list of dicts.

        Args:
            spreadsheet_id: Google Sheets ID
            sheet_range: e.g., 'Membership Master!A:Z'

        Returns:
            List of row dicts, where first row is headers
        """
        # Sheets API requires single-quoting sheet names that contain spaces
        # e.g., 'Membership Master'!A:Z  (not  Membership Master!A:Z)
        if '!' in sheet_range:
            sheet_name_part, cell_range = sheet_range.split('!', 1)
            # Strip any existing quotes then re-add if name has spaces
            sheet_name_part = sheet_name_part.strip("'")
            if ' ' in sheet_name_part:
                sheet_name_part = f"'{sheet_name_part}'"
            sheet_range = f"{sheet_name_part}!{cell_range}"

        result = self.sheets_service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=sheet_range
        ).execute()

        values = result.get('values', [])

        if not values:
            return []

        headers = values[0]
        rows = []

        for row_values in values[1:]:
            # Pad row to match headers length
            row_values += [''] * (len(headers) - len(row_values))
            row = {header: value for header, value in zip(headers, row_values)}
            rows.append(row)

        return rows

    def create_snapshot(
        self,
        sheet_name: str,
        spreadsheet_id: str,
        sheet_range: str,
        key_field: str = 'Email'
    ) -> Dict[str, Any]:
        """
        Create a snapshot of the sheet and store in Azure Blob Storage.

        Args:
            sheet_name: e.g., 'Membership Master'
            spreadsheet_id: Google Sheets ID
            sheet_range: e.g., 'Membership Master!A:Z'
            key_field: Column to use as row key (usually 'Email')

        Returns:
            {
                'snapshot_id': for DB reference,
                'sheet_name': str,
                'timestamp': ISO datetime,
                'hash': SHA-256 hex,
                'row_count': int,
                'blob_url': str (Azure path)
            }
        """
        # Get metadata
        metadata = self.get_sheet_metadata(spreadsheet_id)
        modified_time = metadata['modified_time']

        # Get data
        rows = self.get_sheet_data(spreadsheet_id, sheet_range)

        # Create snapshot object
        snapshot = {
            'sheet_name': sheet_name,
            'timestamp': datetime.utcnow().isoformat() + 'Z',
            'google_modified_at': modified_time,
            'row_count': len(rows),
            'data': rows
        }

        # Hash
        snapshot_json = json.dumps(snapshot, sort_keys=True, default=str)
        snapshot_hash = hashlib.sha256(snapshot_json.encode()).hexdigest()
        snapshot['hash'] = snapshot_hash

        # Upload to Azure Blob Storage (skipped if AZURE_STORAGE_CONNECTION_STRING not set)
        blob_name = None
        if self.blob_client:
            container_name = 'mmr-snapshots'
            blob_name = f'sheets/{sheet_name}/{snapshot["timestamp"]}-{snapshot_hash[:8]}.json'
            try:
                container_client = self.blob_client.get_container_client(container_name)
                container_client.upload_blob(blob_name, snapshot_json)
            except Exception as e:
                logger.warning(f'Could not upload snapshot to blob storage: {e}')
                blob_name = None
        else:
            logger.info('AZURE_STORAGE_CONNECTION_STRING not set — skipping blob upload')

        return {
            'sheet_name': sheet_name,
            'timestamp': snapshot['timestamp'],
            'google_modified_at': modified_time,
            'hash': snapshot_hash,
            'row_count': len(rows),
            'blob_url': blob_name,
            'rows': rows,
            'key_field': key_field
        }

    def detect_changes(
        self,
        previous_snapshot: Dict[str, Any],
        current_snapshot: Dict[str, Any]
    ) -> Dict[str, List[Dict[str, Any]]]:
        """
        Compare two snapshots and detect row-level changes.

        Args:
            previous_snapshot: Previous snapshot dict
            current_snapshot: Current snapshot dict

        Returns:
            {
                'added': [rows],
                'modified': [{'old': row, 'new': row}],
                'deleted': [rows]
            }
        """
        key_field = current_snapshot.get('key_field', 'Email')

        # Index rows by key field
        prev_rows = {row.get(key_field): row for row in previous_snapshot.get('rows', [])}
        curr_rows = {row.get(key_field): row for row in current_snapshot.get('rows', [])}

        added = [row for key, row in curr_rows.items() if key not in prev_rows]

        modified = []
        for key in curr_rows:
            if key in prev_rows and prev_rows[key] != curr_rows[key]:
                modified.append({
                    'key': key,
                    'old': prev_rows[key],
                    'new': curr_rows[key]
                })

        deleted = [row for key, row in prev_rows.items() if key not in curr_rows]

        return {
            'added': added,
            'modified': modified,
            'deleted': deleted,
            'total_changes': len(added) + len(modified) + len(deleted)
        }


if __name__ == '__main__':
    # Test
    snapshot_mgr = GoogleSheetsSnapshot()

    # Check if "Membership Master" has changed
    spreadsheet_id = os.environ.get('GOOGLE_SHEETS_ID', '')

    if snapshot_mgr.has_changed_since(spreadsheet_id, None):
        print('Sheet has changed, creating snapshot...')
        snap = snapshot_mgr.create_snapshot(
            'Membership Master',
            spreadsheet_id,
            'Membership Master!A:Z'
        )
        print(f'Snapshot created: {snap["hash"][:8]}, {snap["row_count"]} rows')
