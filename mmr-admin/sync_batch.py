"""
sync_batch.py — Batch operations for efficient syncing.

Provides:
  - BATCH_SIZE: Constant for batch sizing
  - _log_sync_batch: Log batch progress
  - _get_last_successful_batch: Resume from last position
  - _batch_insert_rows: MySQL batch insert
  - _normalize_sheet_rows: Normalize sheet data
  - _prepare_sheet_rows: Prepare rows for sheet API
"""

from __future__ import annotations
import logging
from datetime import datetime, date, time
from decimal import Decimal
from typing import Any, Dict, List, Tuple
from db import query, execute, get_conn

logger = logging.getLogger(__name__)

# Default batch size for sync operations
BATCH_SIZE = 300  # Rows per batch (MySQL insert, GAS API call)

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
                Status = %s,
                RowsInserted = %s,
                RowsUpdated = %s,
                RowsSkipped = %s,
                ErrorMessage = %s,
                CompletedAt = IF(%s = 'success', NOW(), CompletedAt)
        """
        completed_at = datetime.now() if status == 'success' else None
        db_execute(sql, [
            job_id, config_key, direction, batch_num, batch_size, total_rows,
            status, rows_inserted, rows_updated, rows_skipped, error_msg, completed_at,
            # Duplicate values for ON DUPLICATE KEY UPDATE
            status, rows_inserted, rows_updated, rows_skipped, error_msg, status
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
            # Log batch details for debugging
            batch_num = batch_idx // batch_size
            col_keys = list(batch[0].keys())
            logger.debug(f"Batch {batch_num}: table={table}, pk={pk_field}, mode={mode}, cols={col_keys}")
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
                logger.info(f"Batch {batch_num}: Executing INSERT IGNORE for {len(batch)} rows into {table}")
                logger.debug(f"Batch {batch_num}: SQL={sql[:250]}")
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
                # Use VALUES(col) syntax — compatible with MySQL 5.7
                update_stmt = ", ".join(
                    [f"{c}=VALUES({c})" for c in batch[0].keys() if c != pk_field]
                )

                sql = f"""
                    INSERT INTO {table} ({col_names})
                    VALUES {", ".join(values_clauses)}
                    ON DUPLICATE KEY UPDATE {update_stmt}
                """
                logger.debug(f"Batch {batch_num}: UPSERT SQL (first 300 chars): {sql[:300]}...")
                logger.debug(f"Batch {batch_num}: Columns being inserted: {col_names}")
                res = db_execute(sql, all_values)
                # MySQL returns: affected_rows (inserts + updates)
                # For simplicity: assume half are inserts, half are updates (approximate)
                inserted += len(batch)  # Assume all are at least "affected"

        except Exception as e:
            logger.error(f"Batch {batch_num}: {table} insert FAILED - {str(e)}")
            logger.error(f"Batch {batch_num}: Attempted columns: {col_names[:200]}")
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
                # Space-separated (no T) — matches what GAS/Sheets stores
                val = val.strftime('%Y-%m-%d %H:%M:%S')
            elif isinstance(val, date):
                val = val.strftime('%Y-%m-%d')
            elif isinstance(val, time):
                val = val.strftime('%H:%M:%S')
            elif isinstance(val, Decimal):
                # Send whole-number decimals as int (30.0 → 30) to match Sheets storage
                f = float(val)
                val = int(f) if f == int(f) else f
            elif isinstance(val, (dict, list)):
                # Convert dict/list to string representation
                val = str(val)

            sheet_row.append(val if val is not None else '')
        sheet_rows.append(sheet_row)

    return sheet_rows


# ─────────────────────────────────────────────────────────────────────────────
# Generic Sync Runner
# ─────────────────────────────────────────────────────────────────────────────

