"""
sync_config.py — Centralized sync configuration and generic sync runner.

Provides:
  - SYNC_CONFIG: Single source of truth for all sync mappings (Sheets ↔ MySQL)
  - generic_sync_runner: Unified helper to UPSERT data in any direction
  - Helper functions for Sheets I/O and MySQL operations

Used by:
  - mmr-admin/api_sheets_sync.py (Flask sync endpoints)
  - basecamp/ops/sync_sheets_to_mysql.py (GitHub cron jobs)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Centralized Sync Configuration
# ─────────────────────────────────────────────────────────────────────────────

SYNC_CONFIG = {
    # ─────────────────────────────────────────────────────────────────────────
    # Direction: Sheets → MySQL (Import)
    # ─────────────────────────────────────────────────────────────────────────
    'import_members': {
        'table': 'members',
        'sheet': 'Main',
        'key': 'MemberID',
        'direction': 'sheet_to_mysql',
        'mode': 'insert_only',  # NEW: only insert, never update
        'columns': [
            'MemberID', 'Status', 'Created', 'Expiration', 'Email', 'FirstName',
            'LastName', 'Type', 'FamilyID', 'Gender', 'WeChatID', 'District',
            'MembershipFeePaid', 'PaymentDate', 'PaymentTransaction', 'JoinYear',
            'PhoneNumber', 'Notes', 'NYRRRunnerName', 'YearBorn', 'YearBornGuess',
            'UpdatedAt'
        ]
    },

    'import_transactions': {
        'table': 'gmail_transactions',
        'sheet': 'Transactions',
        'key': 'MessageId',
        'direction': 'sheet_to_mysql',
        'mode': 'upsert',  # Default: insert or update
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
        'sheet': 'Main',
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
        'sheet': 'Payment-History',
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
        'sheet': 'Submissions',
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
        'sheet': 'Transactions',
        'key': 'TransactionNumber',
        'direction': 'mysql_to_sheet',
        'columns': ['Notes', 'UpdatedAt']  # Only sync back these two
    }
}


# ─────────────────────────────────────────────────────────────────────────────
# Generic Sync Runner
# ─────────────────────────────────────────────────────────────────────────────

def generic_sync_runner(
    job_id: str,
    config_key: str,
    db_query,
    db_execute,
    gas_webhook,
    update_job,
    direction: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generic UPSERT runner for bidirectional Sheets ↔ MySQL sync.

    Args:
        job_id: Job tracking ID (for progress updates)
        config_key: Key into SYNC_CONFIG (e.g., 'export_members', 'import_transactions')
        db_query: Callable(sql_str) -> List[Dict] (MySQL SELECT)
        db_execute: Callable(sql_str, params) -> int (MySQL INSERT/UPDATE)
        gas_webhook: Callable(payload) -> Dict (Google Apps Script webhook)
        update_job: Callable(job_id, message) -> None (Job progress callback)
        direction: Override direction from config ('mysql_to_sheet' or 'sheet_to_mysql')

    Returns:
        {
            'status': 'success' | 'error',
            'inserted': int,
            'updated': int,
            'skipped': int,
            'message': str
        }
    """
    cfg = SYNC_CONFIG.get(config_key)
    if not cfg:
        msg = f"Config key '{config_key}' not found in SYNC_CONFIG"
        logger.error(msg)
        return {'status': 'error', 'message': msg}

    cols = cfg['columns']
    table = cfg['table']
    pk = cfg['key']
    sheet_name = cfg['sheet']
    sync_direction = direction or cfg.get('direction', 'mysql_to_sheet')

    inserted, updated, skipped = 0, 0, 0
    errors = []

    try:
        if sync_direction == 'mysql_to_sheet':
            # MySQL → Google Sheets (Export)
            logger.info(f"Starting MySQL→Sheets sync for table={table}")
            update_job(job_id, message=f"Reading {len(cols)} columns from {table}...")

            try:
                col_list = ", ".join(cols)
                rows = db_query(f"SELECT {col_list} FROM {table}")
                logger.debug(f"Fetched {len(rows)} rows from {table}")
            except Exception as e:
                msg = f"Failed to query {table}: {str(e)}"
                logger.error(msg)
                errors.append(msg)
                return {
                    'status': 'error',
                    'inserted': 0,
                    'updated': 0,
                    'skipped': 0,
                    'message': msg
                }

            # Convert to Sheets format
            sheet_rows = _prepare_sheet_rows(rows, cfg)
            if not sheet_rows:
                msg = f"No data to write to {sheet_name}"
                logger.warning(msg)
                return {
                    'status': 'success',
                    'inserted': 0,
                    'updated': 0,
                    'skipped': len(rows),
                    'message': msg
                }

            # Write to Sheets
            logger.info(f"Writing {len(sheet_rows)} rows to sheet '{sheet_name}'")
            update_job(job_id, message=f"Writing {len(sheet_rows)} rows to {sheet_name}...")
            result = gas_webhook({
                'action': 'write_range',
                'sheetName': sheet_name,
                'rows': sheet_rows,
                'overwrite': False
            })

            if result.get('ok'):
                updated = result.get('updated', 0)
                inserted = result.get('inserted', 0)
                msg = f"✓ Wrote {inserted} new + {updated} updated rows to {sheet_name}"
                logger.info(msg)
                update_job(job_id, message=msg)
            else:
                msg = f"Sheets write failed: {result.get('error', result)}"
                logger.error(msg)
                errors.append(msg)

        else:  # sheet_to_mysql (Import)
            # Google Sheets → MySQL (Import)
            logger.info(f"Starting Sheets→MySQL sync for {config_key}")
            update_job(job_id, message=f"Reading {len(cols)} columns from sheet '{sheet_name}'...")

            # Fetch from Sheets
            try:
                result = gas_webhook({
                    'action': 'read_range',
                    'sheetName': sheet_name,
                    'columns': cols
                })
                rows = result.get('data', []) if result.get('ok') else []
                logger.debug(f"Fetched {len(rows)} rows from {sheet_name}")
            except Exception as e:
                msg = f"Failed to read {sheet_name}: {str(e)}"
                logger.error(msg)
                errors.append(msg)
                return {
                    'status': 'error',
                    'inserted': 0,
                    'updated': 0,
                    'skipped': 0,
                    'message': msg
                }

            # Get sync mode (upsert or insert_only)
            sync_mode = cfg.get('mode', 'upsert')
            action_verb = "Inserting" if sync_mode == 'insert_only' else "Upserting"
            update_job(job_id, message=f"{action_verb} {len(rows)} rows into {table}...")

            for idx, row in enumerate(rows):
                try:
                    # Apply field mappings (e.g., Source → PaymentMethod)
                    mapped_row = {}
                    for col in cols:
                        sql_col = cfg.get('map_fields', {}).get(col, col)
                        mapped_row[sql_col] = row.get(col)

                    if sync_mode == 'insert_only':
                        # INSERT IGNORE: skip if PK already exists
                        col_names = ", ".join(mapped_row.keys())
                        placeholders = ", ".join(["%s"] * len(mapped_row))
                        sql = f"""
                            INSERT IGNORE INTO {table} ({col_names})
                            VALUES ({placeholders})
                        """
                        res = db_execute(sql, list(mapped_row.values()))
                        if res == 1:
                            inserted += 1
                        else:
                            skipped += 1  # Row already existed
                    else:
                        # UPSERT (default): insert or update
                        col_names = ", ".join(mapped_row.keys())
                        placeholders = ", ".join(["%s"] * len(mapped_row))
                        update_stmt = ", ".join(
                            [f"{c}=VALUES({c})" for c in mapped_row.keys() if c != pk]
                        )

                        sql = f"""
                            INSERT INTO {table} ({col_names})
                            VALUES ({placeholders})
                            ON DUPLICATE KEY UPDATE {update_stmt}
                        """

                        res = db_execute(sql, list(mapped_row.values()))
                        if res == 1:
                            inserted += 1
                        else:
                            updated += 1

                except Exception as e:
                    error_msg = f"Row {idx} sync failed: {str(e)}"
                    logger.error(error_msg)
                    errors.append(error_msg)
                    skipped += 1

            if sync_mode == 'insert_only':
                msg = f"✓ Inserted {inserted} new rows to {table} ({skipped} skipped as duplicates)"
            else:
                msg = f"✓ Synced {inserted} new + {updated} updated rows to {table}"
            logger.info(msg)
            update_job(job_id, message=msg)

        return {
            'status': 'success' if not errors else 'partial',
            'inserted': inserted,
            'updated': updated,
            'skipped': skipped,
            'message': f"{inserted} inserted, {updated} updated, {skipped} skipped" + (f". Errors: {errors[0]}" if errors else "")
        }

    except Exception as e:
        msg = f"Sync runner crashed: {str(e)}"
        logger.exception(msg)
        return {
            'status': 'error',
            'inserted': 0,
            'updated': 0,
            'skipped': 0,
            'message': msg
        }


def _prepare_sheet_rows(db_rows: List[Dict], cfg: Dict) -> List[List[Any]]:
    """
    Convert MySQL rows to Sheets format (list of lists).
    Applies reverse field mappings if needed.
    """
    if not db_rows:
        return []

    cols = cfg['columns']
    map_fields = cfg.get('map_fields', {})
    reverse_map = {v: k for k, v in map_fields.items()}  # Reverse: SQL col → Sheet col

    sheet_rows = []
    for row in db_rows:
        sheet_row = []
        for col in cols:
            # Use reverse mapping: if this Sheet col was mapped from SQL, use the original
            sql_col = reverse_map.get(col, col)
            val = row.get(sql_col, '')
            # Serialize complex types for Sheets
            if isinstance(val, (dict, list)):
                val = str(val)
            sheet_row.append(val if val is not None else '')
        sheet_rows.append(sheet_row)

    return sheet_rows


def get_config(config_key: str) -> Optional[Dict[str, Any]]:
    """Retrieve a sync config by key."""
    return SYNC_CONFIG.get(config_key)


def list_configs() -> List[str]:
    """List all available sync config keys."""
    return list(SYNC_CONFIG.keys())
