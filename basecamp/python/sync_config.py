"""
sync_config.py — Centralized sync configuration and generic sync runner.

Provides:
  - SYNC_CONFIG: Single source of truth for all sync mappings (Sheets ↔ MySQL)
  - generic_sync_runner: Unified helper to UPSERT data in any direction with batching
  - Batch operations for efficient sync (50-100 rows per DB/API call)
  - Resume capability via sheets_sync_log table
  - Helper functions for Sheets I/O and MySQL operations

Used by:
  - mmr-admin/api_sheets_sync.py (Flask sync endpoints)
  - basecamp/ops/sync_sheets_to_mysql.py (GitHub cron jobs)
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, Tuple
from datetime import datetime, date, time
from decimal import Decimal

logger = logging.getLogger(__name__)

# Default batch size for sync operations
BATCH_SIZE = 50  # Rows per batch (MySQL insert, GAS API call)


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
        'spreadsheet': 'MEMBERSHIP',
        'key': 'MemberID',
        'direction': 'sheet_to_mysql',
        'mode': 'insert_only',  # Only insert new; GAS returns new MemberIDs only
        'special_handling': 'send_existing_ids_to_gas',  # GAS filters to return only new
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
        'sheet': 'Active',
        'spreadsheet': 'GMAIL',
        'key': 'MessageId',
        'direction': 'sheet_to_mysql',
        'mode': 'upsert',  # Default: insert or update
        'skip_timestamp_check': True,  # GAS timestamp may not be reliable; sync all rows
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
        'sheet': 'Transactions',
        'key': 'TransactionNumber',
        'direction': 'mysql_to_sheet',
        'columns': ['Notes', 'UpdatedAt']  # Only sync back these two
    }
}


# ─────────────────────────────────────────────────────────────────────────────
# Batch & Logging Functions (must be defined before generic_sync_runner)
# ─────────────────────────────────────────────────────────────────────────────

def _log_sync_batch(
    db_execute,
    job_id: str,
    config_key: str,
    direction: str,
    batch_num: int,
    batch_size: int,
    total_rows: int,
    status: str,
    rows_inserted: int = 0,
    rows_updated: int = 0,
    rows_skipped: int = 0,
    error_msg: str = None
) -> None:
    """Log a batch to sheets_sync_log for resume capability.

    Note: Batch logging is optional and won't fail the sync if the job_id
    doesn't exist in sync_jobs table (e.g., in test/ad-hoc environments).
    """
    try:
        sql = """
            INSERT INTO sheets_sync_log
            (JobID, ConfigKey, Direction, BatchNumber, BatchSize, TotalRows, Status, RowsInserted, RowsUpdated, RowsSkipped, ErrorMessage, CompletedAt)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            ON DUPLICATE KEY UPDATE
                Status = VALUES(Status),
                RowsInserted = VALUES(RowsInserted),
                RowsUpdated = VALUES(RowsUpdated),
                RowsSkipped = VALUES(RowsSkipped),
                ErrorMessage = VALUES(ErrorMessage),
                CompletedAt = IF(Status = 'success', NOW(), CompletedAt)
        """
        completed_at = datetime.now() if status == 'success' else None
        db_execute(sql, [
            job_id, config_key, direction, batch_num, batch_size, total_rows,
            status, rows_inserted, rows_updated, rows_skipped, error_msg, completed_at
        ])
        logger.debug(f"Logged batch {batch_num} for {job_id}")
    except Exception as e:
        # Foreign key constraint error is expected if job_id doesn't exist in sync_jobs
        if '23000' in str(e) or 'foreign key' in str(e).lower():
            logger.debug(f"Batch logging skipped (job {job_id} not in sync_jobs): {str(e)}")
        else:
            logger.warning(f"Failed to log sync batch: {str(e)}")


def _get_last_successful_batch(db_query, job_id: str, config_key: str) -> int:
    """Get the last successfully completed batch number for resume."""
    try:
        result = db_query("""
            SELECT MAX(BatchNumber) as LastBatch
            FROM sheets_sync_log
            WHERE JobID = %s AND ConfigKey = %s AND Status = 'success'
        """, [job_id, config_key])
        if result and result[0].get('LastBatch') is not None:
            return result[0]['LastBatch'] + 1  # Resume from next batch
        return 0  # Start from beginning
    except Exception as e:
        logger.warning(f"Failed to check last batch: {str(e)}")
        return 0


def _batch_insert_rows(
    db_execute,
    table: str,
    rows: List[Dict[str, Any]],
    pk_field: str,
    mode: str = 'upsert',
    batch_size: int = BATCH_SIZE
) -> Tuple[int, int, int]:
    """
    Batch insert/upsert rows into MySQL.

    Args:
        db_execute: Callable for SQL execution
        table: MySQL table name
        rows: List of row dicts to insert
        pk_field: Primary key field name
        mode: 'insert_only' or 'upsert'
        batch_size: Rows per INSERT statement

    Returns:
        (inserted, updated, skipped)
    """
    inserted, updated, skipped = 0, 0, 0

    for batch_idx in range(0, len(rows), batch_size):
        batch = rows[batch_idx:batch_idx + batch_size]
        if not batch:
            continue

        try:
            if mode == 'insert_only':
                # INSERT IGNORE: skip if PK exists
                col_names = ", ".join(batch[0].keys())
                placeholders = ", ".join(["%s"] * len(batch[0]))

                # Build multi-row VALUES clause
                values_clauses = []
                all_values = []
                for row in batch:
                    values_clauses.append(f"({placeholders})")
                    all_values.extend(row.values())

                sql = f"""
                    INSERT IGNORE INTO {table} ({col_names})
                    VALUES {", ".join(values_clauses)}
                """
                res = db_execute(sql, all_values)
                inserted += res  # INSERT IGNORE returns affected rows
                skipped += len(batch) - res  # Remainder were duplicates

            else:  # upsert
                col_names = ", ".join(batch[0].keys())
                placeholders = ", ".join(["%s"] * len(batch[0]))

                # Build multi-row VALUES clause
                values_clauses = []
                all_values = []
                for row in batch:
                    values_clauses.append(f"({placeholders})")
                    all_values.extend(row.values())

                # ON DUPLICATE KEY UPDATE: update non-PK columns
                update_stmt = ", ".join(
                    [f"{c}=VALUES({c})" for c in batch[0].keys() if c != pk_field]
                )

                sql = f"""
                    INSERT INTO {table} ({col_names})
                    VALUES {", ".join(values_clauses)}
                    ON DUPLICATE KEY UPDATE {update_stmt}
                """
                res = db_execute(sql, all_values)
                # MySQL returns: affected_rows (inserts + updates)
                # For simplicity: assume half are inserts, half are updates (approximate)
                inserted += len(batch)  # Assume all are at least "affected"

        except Exception as e:
            logger.error(f"Batch insert failed: {str(e)}")
            skipped += len(batch)

    return inserted, updated, skipped


# ─────────────────────────────────────────────────────────────────────────────
# Helper Functions (must be defined before generic_sync_runner)
# ─────────────────────────────────────────────────────────────────────────────

def _convert_iso_to_mysql_datetime(value: Any) -> Any:
    """
    Convert ISO 8601 datetime strings to MySQL datetime format (YYYY-MM-DD HH:MM:SS).

    Handles formats like:
    - 2026-04-04T11:57:01.000Z
    - 2026-04-04T11:57:01Z
    - 2026-04-04T11:57:01

    Returns original value if not a datetime string.
    """
    if not isinstance(value, str):
        return value

    # Check if it looks like an ISO 8601 datetime
    if 'T' not in value:
        return value

    try:
        # Parse ISO 8601 format
        if value.endswith('Z'):
            # Remove Z and parse
            dt = datetime.fromisoformat(value[:-1])
        else:
            dt = datetime.fromisoformat(value)
        # Return MySQL format: YYYY-MM-DD HH:MM:SS
        return dt.strftime('%Y-%m-%d %H:%M:%S')
    except (ValueError, AttributeError):
        # Not a datetime, return as-is
        return value


def _normalize_sheet_rows(raw_rows: List, cols: List[str]) -> List[Dict[str, Any]]:
    """
    Convert raw Sheets data (either list-of-lists or list-of-dicts) to list-of-dicts.

    Args:
        raw_rows: Data from GAS webhook — either List[List] or List[Dict]
        cols: Column names (used to map list indices to dict keys if needed)

    Returns:
        List[Dict] where each dict has keys from cols
    """
    if not raw_rows:
        return []

    # Log first row type for debugging
    if raw_rows:
        logger.debug(f"First raw_row type: {type(raw_rows[0])}, value: {raw_rows[0]}")

    normalized = []
    for idx, row in enumerate(raw_rows):
        try:
            if isinstance(row, dict):
                # Already a dict — just ensure all cols are present
                normalized.append(row)
            elif isinstance(row, (list, tuple)):
                # List format — map indices to column names
                row_dict = {}
                for i, col in enumerate(cols):
                    row_dict[col] = row[i] if i < len(row) else None
                normalized.append(row_dict)
            else:
                # Unknown format — skip or log warning
                logger.warning(f"Row {idx}: unexpected type {type(row)}, skipping")
        except Exception as e:
            logger.error(f"Error normalizing row {idx}: {str(e)}")

    logger.debug(f"Normalized {len(normalized)} rows from {len(raw_rows)} raw rows")
    return normalized


def _prepare_sheet_rows(db_rows: List[Dict], cfg: Dict) -> List[List[Any]]:
    """
    Convert MySQL rows to Sheets format (list of lists).
    Applies reverse field mappings if needed.
    Handles datetime/date/time objects by converting to ISO format strings.
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
            if isinstance(val, datetime):
                # Convert datetime to ISO format string (e.g., "2026-04-04T05:42:53")
                val = val.isoformat()
            elif isinstance(val, date):
                # Convert date to ISO format string (e.g., "2026-04-04")
                val = val.isoformat()
            elif isinstance(val, time):
                # Convert time to ISO format string (e.g., "05:42:53")
                val = val.isoformat()
            elif isinstance(val, Decimal):
                # Convert Decimal to string or float (Decimal is not JSON serializable)
                val = float(val)
            elif isinstance(val, (dict, list)):
                # Convert dict/list to string representation
                val = str(val)

            sheet_row.append(val if val is not None else '')
        sheet_rows.append(sheet_row)

    return sheet_rows


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
    Generic UPSERT runner for bidirectional Sheets ↔ MySQL sync with batching.

    Args:
        job_id: Job tracking ID (for progress updates)
        config_key: Key into SYNC_CONFIG (e.g., 'export_members', 'import_transactions')
        db_query: Callable(sql_str, params?) -> List[Dict] (MySQL SELECT)
        db_execute: Callable(sql_str, params) -> int (MySQL INSERT/UPDATE)
        gas_webhook: Callable(payload) -> Dict (Google Apps Script webhook)
        update_job: Callable(job_id, message) -> None (Job progress callback)
        direction: Override direction from config ('mysql_to_sheet' or 'sheet_to_mysql')

    Returns:
        {
            'status': 'success' | 'error' | 'partial',
            'inserted': int,
            'updated': int,
            'skipped': int,
            'message': str,
            'batches_processed': int
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
    sync_mode = cfg.get('mode', 'upsert')

    inserted, updated, skipped = 0, 0, 0
    batches_processed = 0
    errors = []

    try:
        if sync_direction == 'mysql_to_sheet':
            # ─────────────────────────────────────────────────────────────────
            # MySQL → Google Sheets (Export) with batching & timestamp filtering
            # ─────────────────────────────────────────────────────────────────
            logger.info(f"Starting MySQL→Sheets export for table={table}")
            update_job(job_id, message=f"Reading {len(cols)} columns from {table}...")

            try:
                # Query with timestamp filter if UpdatedAt exists
                col_list = ", ".join(cols)
                if 'UpdatedAt' in cols:
                    # Get last sync time from sheets_sync_log
                    try:
                        last_sync = db_query("""
                            SELECT MAX(StartedAt) as LastSync
                            FROM sheets_sync_log
                            WHERE JobID = %s AND ConfigKey = %s AND Status = 'success'
                        """, [job_id, config_key])
                        last_sync_time = last_sync[0]['LastSync'] if last_sync and last_sync[0]['LastSync'] else None

                        if last_sync_time:
                            sql = f"SELECT {col_list} FROM {table} WHERE UpdatedAt >= %s"
                            rows = db_query(sql, [last_sync_time])
                            logger.info(f"Fetched {len(rows)} rows updated since {last_sync_time}")
                        else:
                            rows = db_query(f"SELECT {col_list} FROM {table}")
                            logger.info(f"First sync: fetched all {len(rows)} rows")
                    except:
                        # Fallback if sheets_sync_log query fails
                        rows = db_query(f"SELECT {col_list} FROM {table}")
                        logger.info(f"Fetched {len(rows)} rows (timestamp filter unavailable)")
                else:
                    rows = db_query(f"SELECT {col_list} FROM {table}")
                    logger.debug(f"Fetched {len(rows)} rows from {table}")

            except Exception as e:
                msg = f"Failed to query {table}: {str(e)}"
                logger.error(msg)
                return {
                    'status': 'error',
                    'inserted': 0,
                    'updated': 0,
                    'skipped': 0,
                    'message': msg,
                    'batches_processed': 0
                }

            if not rows:
                msg = f"No new rows to export from {table}"
                logger.warning(msg)
                return {
                    'status': 'success',
                    'inserted': 0,
                    'updated': 0,
                    'skipped': 0,
                    'message': msg,
                    'batches_processed': 0
                }

            # Convert to Sheets format
            sheet_rows = _prepare_sheet_rows(rows, cfg)
            total_rows = len(sheet_rows)

            # Batch export to Sheets (send in chunks for large datasets)
            for batch_idx in range(0, len(sheet_rows), BATCH_SIZE):
                batch_data = sheet_rows[batch_idx:batch_idx + BATCH_SIZE]
                batch_num = batch_idx // BATCH_SIZE

                try:
                    logger.info(f"Writing batch {batch_num} ({len(batch_data)} rows) to {sheet_name}")
                    update_job(job_id, message=f"Writing batch {batch_num + 1} ({len(batch_data)} rows) to {sheet_name}...")

                    result = gas_webhook({
                        'action': 'write_range',
                        'sheetName': sheet_name,
                        'spreadsheetId': cfg.get('spreadsheet', 'MEMBERSHIP'),  # Which workbook to write to
                        'rows': batch_data,
                        'overwrite': False,
                        'keyField': cfg.get('key', 'MemberID')  # Use configured key for upsert
                    })

                    # GAS webhook wrapper returns only the 'data' field, so check for inserted/updated keys
                    if result and ('inserted' in result or 'updated' in result):
                        batch_inserted = result.get('inserted', 0)
                        batch_updated = result.get('updated', 0)
                        inserted += batch_inserted
                        updated += batch_updated
                        batches_processed += 1

                        # Log batch success
                        _log_sync_batch(
                            db_execute, job_id, config_key, 'mysql_to_sheet',
                            batch_num, len(batch_data), total_rows,
                            'success', batch_inserted, batch_updated, 0
                        )
                        logger.debug(f"Batch {batch_num}: inserted {batch_inserted}, updated {batch_updated}")
                    else:
                        batch_error = f"Batch {batch_num}: {result.get('error', result)}"
                        logger.error(batch_error)
                        _log_sync_batch(
                            db_execute, job_id, config_key, 'mysql_to_sheet',
                            batch_num, len(batch_data), total_rows,
                            'error', 0, 0, len(batch_data), batch_error
                        )
                        errors.append(batch_error)

                        # Stop on ANY error (strict mode)
                        remaining = total_rows - (batch_idx + len(batch_data))
                        stop_msg = f"Stopping sync on GAS error. {batch_error}. Remaining: {remaining} rows unprocessed."
                        logger.error(stop_msg)
                        errors.append(stop_msg)
                        skipped += len(batch_data) + remaining
                        break  # Stop batch loop immediately

                except Exception as e:
                    batch_error = f"Batch {batch_num} webhook error: {str(e)}"
                    logger.error(batch_error)
                    _log_sync_batch(
                        db_execute, job_id, config_key, 'mysql_to_sheet',
                        batch_num, len(batch_data), total_rows,
                        'error', 0, 0, len(batch_data), batch_error
                    )
                    errors.append(batch_error)

                    # Stop on ANY error (strict mode)
                    remaining = total_rows - (batch_idx + len(batch_data))
                    stop_msg = f"Stopping sync on webhook error. {batch_error}. Remaining: {remaining} rows unprocessed."
                    logger.error(stop_msg)
                    errors.append(stop_msg)
                    skipped += len(batch_data) + remaining
                    break  # Stop batch loop immediately

            msg = f"✓ Exported {inserted} new + {updated} updated rows to {sheet_name} ({batches_processed} batches)"
            logger.info(msg)
            update_job(job_id, message=msg)

        else:  # sheet_to_mysql (Import)
            # ─────────────────────────────────────────────────────────────────
            # Google Sheets → MySQL (Import) with batching & special handling
            # ─────────────────────────────────────────────────────────────────
            logger.info(f"Starting Sheets→MySQL import for {config_key}")
            update_job(job_id, message=f"Reading {len(cols)} columns from sheet '{sheet_name}'...")

            # Special handling for import_members: send existing IDs to GAS
            gas_payload = {
                'action': 'read_range',
                'sheetName': sheet_name,
                'spreadsheetId': cfg.get('spreadsheet', 'MEMBERSHIP'),  # Which workbook to read from
                'columns': cols
            }

            if cfg.get('special_handling') == 'send_existing_ids_to_gas':
                # For import_members: send existing MemberIDs so GAS returns only new ones
                try:
                    existing_ids = db_query(f"SELECT {pk} FROM {table}")
                    gas_payload['existingIds'] = [row[pk] for row in existing_ids]
                    logger.info(f"Sending {len(gas_payload['existingIds'])} existing IDs to GAS for filtering")
                except Exception as e:
                    logger.warning(f"Could not fetch existing IDs: {str(e)}")

            # Fetch from Sheets
            try:
                result = gas_webhook(gas_payload)
                logger.debug(f"GAS response type: {type(result)}, value: {result}")
                # GAS webhook wrapper returns the 'data' field directly on success
                # For fetch_data, this is typically a list of rows; treat it as raw_rows
                if isinstance(result, list):
                    raw_rows = result
                elif isinstance(result, dict):
                    # If dict, assume it's already the data (or try to extract 'data' field if present)
                    raw_rows = result.get('data', result) if result else []
                else:
                    raw_rows = []
                logger.debug(f"Fetched {len(raw_rows)} raw rows from {sheet_name}")

                # Convert raw rows (list or dict format) to dict format
                rows = _normalize_sheet_rows(raw_rows, cols)
                logger.debug(f"Normalized to {len(rows)} dict rows")
            except Exception as e:
                msg = f"Failed to read {sheet_name}: {str(e)}"
                logger.error(msg)
                return {
                    'status': 'error',
                    'inserted': 0,
                    'updated': 0,
                    'skipped': 0,
                    'message': msg,
                    'batches_processed': 0
                }

            if not rows:
                msg = f"No new rows to import from {sheet_name}"
                logger.warning(msg)
                return {
                    'status': 'success',
                    'inserted': 0,
                    'updated': 0,
                    'skipped': 0,
                    'message': msg,
                    'batches_processed': 0
                }

            # Apply field mappings (e.g., Source → PaymentMethod)
            # Also convert ISO 8601 datetimes to MySQL format and coerce empty strings to None
            mapped_rows = []
            for row in rows:
                mapped_row = {}
                for col in cols:
                    sql_col = cfg.get('map_fields', {}).get(col, col)
                    value = row.get(col)
                    # Convert ISO 8601 strings to MySQL datetime format
                    if sql_col in ('Timestamp', 'TransactionDate', 'PaymentDate', 'CreatedAt', 'UpdatedAt'):
                        value = _convert_iso_to_mysql_datetime(value)
                    # Coerce empty strings to 0 for numeric/decimal columns
                    if value == '' and sql_col in ('Amount', 'PaymentAmount', 'Price', 'Balance', 'MembershipFeePaid'):
                        value = 0
                    mapped_row[sql_col] = value
                mapped_rows.append(mapped_row)

            action_verb = "Inserting" if sync_mode == 'insert_only' else "Upserting"
            total_rows = len(mapped_rows)
            update_job(job_id, message=f"{action_verb} {total_rows} rows into {table} (batched)...")

            # Batch insert/upsert
            for batch_idx in range(0, len(mapped_rows), BATCH_SIZE):
                batch = mapped_rows[batch_idx:batch_idx + BATCH_SIZE]
                batch_num = batch_idx // BATCH_SIZE

                try:
                    logger.info(f"Processing batch {batch_num} ({len(batch)} rows) for {table}")
                    update_job(job_id, message=f"Processing batch {batch_num + 1}/{(total_rows // BATCH_SIZE) + 1}...")

                    if sync_mode == 'insert_only':
                        # INSERT IGNORE: skip if PK exists
                        col_names = ", ".join(batch[0].keys())
                        placeholders = ", ".join(["%s"] * len(batch[0]))
                        values_clauses = []
                        all_values = []
                        for row in batch:
                            values_clauses.append(f"({placeholders})")
                            all_values.extend(row.values())

                        sql = f"""
                            INSERT IGNORE INTO {table} ({col_names})
                            VALUES {", ".join(values_clauses)}
                        """
                        res = db_execute(sql, all_values)
                        batch_inserted = res
                        batch_updated = 0
                        batch_skipped = len(batch) - res

                    else:  # upsert
                        col_names = ", ".join(batch[0].keys())
                        placeholders = ", ".join(["%s"] * len(batch[0]))
                        values_clauses = []
                        all_values = []
                        for row in batch:
                            values_clauses.append(f"({placeholders})")
                            all_values.extend(row.values())

                        update_stmt = ", ".join(
                            [f"{c}=VALUES({c})" for c in batch[0].keys() if c != pk]
                        )

                        sql = f"""
                            INSERT INTO {table} ({col_names})
                            VALUES {", ".join(values_clauses)}
                            ON DUPLICATE KEY UPDATE {update_stmt}
                        """
                        res = db_execute(sql, all_values)
                        # MySQL returns: 1 = inserted, 2 = updated (for ON DUPLICATE KEY UPDATE)
                        # res = affected_rows from INSERT ... ON DUPLICATE KEY UPDATE
                        logger.info(f"Batch {batch_num}: db_execute returned res={res}, batch_size={len(batch)}, pk='{pk}'")

                        # For ON DUPLICATE KEY UPDATE, MySQL counts:
                        # - Inserts as 1 affected row each
                        # - Updates as 2 affected rows each (DELETE + INSERT)
                        # So if res=280 and batch_size=280: could be all inserts or mix of both
                        # We can't distinguish without querying, so log for inspection

                        # DIAGNOSTIC: Check if we can determine inserts vs updates
                        try:
                            # Count pre-existing keys in this batch
                            existing_count = 0
                            for row in batch:
                                pk_val = row[pk]
                                check_sql = f"SELECT COUNT(*) as cnt FROM {table} WHERE {pk}=%s"
                                check_res = db_query(check_sql, [pk_val])
                                if check_res and check_res[0].get('cnt', 0) > 0:
                                    existing_count += 1

                            batch_updated = existing_count
                            batch_inserted = len(batch) - existing_count
                            batch_skipped = 0
                            logger.info(f"Batch {batch_num}: DIAGNOSTIC — pre-existing keys={existing_count}, new={batch_inserted}, total_batch={len(batch)}")
                        except Exception as diag_e:
                            logger.warning(f"Batch {batch_num}: diagnostic check failed: {str(diag_e)}, falling back to res={res}")
                            # Fallback: assume res is accurate count from MySQL
                            batch_inserted = res
                            batch_updated = 0
                            batch_skipped = 0

                    inserted += batch_inserted
                    updated += batch_updated
                    skipped += batch_skipped
                    batches_processed += 1

                    # Log batch success
                    _log_sync_batch(
                        db_execute, job_id, config_key, 'sheet_to_mysql',
                        batch_num, len(batch), total_rows,
                        'success', batch_inserted, batch_updated, batch_skipped
                    )
                    logger.info(f"Batch {batch_num}: SUMMARY inserted={batch_inserted}, updated={batch_updated}, skipped={batch_skipped}, affected_rows_from_db={res}")

                except Exception as e:
                    batch_error = f"Batch {batch_num}: {str(e)}"
                    error_str = str(e).lower()

                    # Handle unknown column errors by filtering them out
                    if '1054' in str(e) or 'unknown column' in error_str:
                        # Extract column name from error: "Unknown column 'LastLogin' in 'NEW'"
                        import re
                        col_match = re.search(r"Unknown column '(\w+)'", str(e), re.IGNORECASE)
                        if col_match:
                            bad_col = col_match.group(1)
                            logger.warning(f"Batch {batch_num}: Removing unknown column '{bad_col}' and retrying")
                            # Remove this column from all rows in batch
                            for row in batch:
                                if bad_col in row:
                                    del row[bad_col]
                            # Retry this batch without the unknown column
                            batch_idx -= BATCH_SIZE  # Retry same batch
                            continue

                    logger.error(batch_error)
                    _log_sync_batch(
                        db_execute, job_id, config_key, 'sheet_to_mysql',
                        batch_num, len(batch), total_rows,
                        'error', 0, 0, len(batch), batch_error
                    )
                    errors.append(batch_error)

                    # Stop on ANY error (strict mode)
                    remaining = total_rows - (batch_idx + len(batch))
                    stop_msg = f"Stopping sync on batch error. {batch_error}. Remaining: {remaining} rows unprocessed."
                    logger.error(stop_msg)
                    errors.append(stop_msg)
                    skipped += len(batch) + remaining  # Count this batch + remaining as skipped
                    break  # Stop batch loop immediately

            if sync_mode == 'insert_only':
                msg = f"✓ Inserted {inserted} new rows to {table} ({skipped} skipped) ({batches_processed} batches)"
            else:
                msg = f"✓ Synced {inserted} new + {updated} updated rows to {table} ({batches_processed} batches)"
            logger.info(msg)
            update_job(job_id, message=msg)

        return {
            'status': 'success' if not errors else 'partial',
            'inserted': inserted,
            'updated': updated,
            'skipped': skipped,
            'message': f"{inserted} inserted, {updated} updated, {skipped} skipped" + (f". Errors: {errors[0]}" if errors else ""),
            'batches_processed': batches_processed
        }

    except Exception as e:
        msg = f"Sync runner crashed: {str(e)}"
        logger.exception(msg)
        return {
            'status': 'error',
            'inserted': 0,
            'updated': 0,
            'skipped': 0,
            'message': msg,
            'batches_processed': 0
        }


def get_config(config_key: str) -> Optional[Dict[str, Any]]:
    """Retrieve a sync config by key."""
    return SYNC_CONFIG.get(config_key)


def list_configs() -> List[str]:
    """List all available sync config keys."""
    return list(SYNC_CONFIG.keys())
