"""
sync_models.py — Sync configuration models and accessors.

Provides:
  - SYNC_CONFIG: Central config dict for all 6 sync operations
  - get_config(key): Lookup helper
  - list_configs(): List all config keys
"""

from __future__ import annotations
from typing import Optional

SYNC_CONFIG = {
    # ─────────────────────────────────────────────────────────────────────────
    # Direction: Sheets → MySQL (Import)
    # ─────────────────────────────────────────────────────────────────────────
    'import_members': {
        'table': 'members',
        'sheet': 'Main',
        'spreadsheet': 'MEMBERSHIP',
        'key': 'MemberID',
        'direction': 'sheet_to_mysql',
        'mode': 'insert_only',  # Only insert new; GAS returns new MemberIDs only
        'special_handling': 'send_existing_ids_to_gas',  # GAS filters to return only new
        'columns': [
            'MemberID', 'Status', 'Created', 'Expiration', 'Email', 'FirstName',
            'LastName', 'Type', 'FamilyID', 'Gender', 'WeChatID', 'District',
            'MembershipFeePaid', 'PaymentDate', 'PaymentTransaction', 'JoinYear',
            'PhoneNumber', 'Notes', 'NYRRRunnerName', 'YearBorn', 'YearBornGuess'
            # UpdatedAt intentionally omitted — MySQL stamps it via DEFAULT CURRENT_TIMESTAMP
        ]
    },

    'import_transactions': {
        'table': 'gmail_transactions',
        'sheet': 'Active',
        'spreadsheet': 'GMAIL',
        'key': 'MessageId',
        'direction': 'sheet_to_mysql',
        'mode': 'upsert',  # Default: insert or update
        'skip_timestamp_check': True,  # GAS timestamp may not be reliable; sync all rows
        'skip_if_unchanged': True,      # Diff against MySQL before upserting; skip rows with no changes
        'columns': [
            'Timestamp', 'Sender', 'Amount', 'Memo', 'TransactionDate',
            'TransactionNumber', 'MessageId', 'Subject', 'OriginalMemo', 'Source'
        ],
        'map_fields': {'Source': 'PaymentMethod'}  # Rename Source → PaymentMethod for SQL
    },

    # ─────────────────────────────────────────────────────────────────────────
    # Direction: MySQL → Sheets (Export)
    # ─────────────────────────────────────────────────────────────────────────
    'export_members': {
        'table': 'members',
        'sheet': 'SQL Members',
        'spreadsheet': 'MEMBERSHIP',
        'key': 'MemberID',
        'direction': 'mysql_to_sheet',
        'columns': [
            'MemberID', 'Status', 'Created', 'Expiration', 'Email', 'FirstName',
            'LastName', 'Type', 'FamilyID', 'Gender', 'WeChatID', 'District',
            'MembershipFeePaid', 'PaymentDate', 'PaymentTransaction', 'JoinYear',
            'PhoneNumber', 'Notes', 'NYRRRunnerName', 'YearBorn', 'YearBornGuess',
            'UpdatedAt'
        ]
    },

    'export_payments': {
        'table': 'payments',
        'sheet': 'SQL Payments',
        'spreadsheet': 'MEMBERSHIP',
        'key': 'PaymentID',
        'direction': 'mysql_to_sheet',
        'columns': [
            'PaymentID', 'MemberID', 'PaymentDate', 'Amount', 'CreatedAt',
            'TransactionNumber', 'SubmissionID', 'PaymentType', 'PaymentMethod',
            'PayerName', 'MemoField', 'Last4Digits', 'ProcessedBy', 'Source', 'Notes'
        ]
    },

    'export_submissions': {
        'table': 'submissions',
        'sheet': 'SQL Submissions',
        'spreadsheet': 'MEMBERSHIP',
        'key': 'SubmissionID',
        'direction': 'mysql_to_sheet',
        'columns': [
            'CreatedAt', 'SubmissionID', 'Status', 'MemberID', 'SubmissionType',
            'ExpiresAt', 'PaymentIntent', 'Amount', 'PaymentMethod', 'PayerName',
            'PaymentDate', 'MemoField', 'Last4Digits', 'PaymentID', 'UpdatedByID',
            'UpdatedAt'
        ]
    },

    'export_transaction_meta': {
        'table': 'gmail_transactions',
        'sheet': 'Active',
        'spreadsheet': 'GMAIL',
        'key': 'TransactionNumber',
        'direction': 'mysql_to_sheet',
        'columns': ['TransactionNumber', 'MessageId', 'Notes', 'UpdatedAt']  # Include keys for matching + 2 columns to update
    }
}


# ─────────────────────────────────────────────────────────────────────────────
# Diff helper
# ─────────────────────────────────────────────────────────────────────────────



def get_config(config_key: str) -> Optional[dict]:
    """Get sync config for a given operation key."""
    return SYNC_CONFIG.get(config_key)


def list_configs() -> list:
    """List all available sync config keys."""
    return list(SYNC_CONFIG.keys())
