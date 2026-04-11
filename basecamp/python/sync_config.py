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

from sync_models import SYNC_CONFIG, get_config, list_configs
from sync_diff import _normalize_for_diff, _row_changed, _filter_changed_rows
from sync_batch import BATCH_SIZE, _log_sync_batch, _get_last_successful_batch, _batch_insert_rows, _normalize_sheet_rows, _prepare_sheet_rows, _convert_iso_to_mysql_datetime

def _truncate_log(obj, max_str=60, max_list=3):
    """Recursively truncate long strings and lists for readable debug logging."""
    if isinstance(obj, dict):
        return {k: _truncate_log(v, max_str, max_list) for k, v in obj.items()}
    if isinstance(obj, list):
        truncated = [_truncate_log(i, max_str, max_list) for i in obj[:max_list]]
        if len(obj) > max_list:
            truncated.append(f'...+{len(obj) - max_list} more')
        return truncated
    if isinstance(obj, str) and len(obj) > max_str:
        return obj[:max_str] + f'…[{len(obj)}]'
    return obj

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
    logger.info(f"[JOB {job_id}] Config: key={pk}, sheet={sheet_name}, direction={sync_direction}, mode={sync_mode}, table={table}, config_key={config_key}")

    inserted, updated, skipped = 0, 0, 0
    batches_processed = 0
    errors = []

    try:
        if sync_direction == 'mysql_to_sheet':
            # ─────────────────────────────────────────────────────────────────
            # MySQL → Google Sheets (Export) with batching & timestamp filtering
            # ─────────────────────────────────────────────────────────────────
            logger.info(f"[EXPORT START] MySQL→Sheets export for table={table}, config={config_key}, has_updated_at={'UpdatedAt' in cols}")
            update_job(job_id, message=f"Reading {len(cols)} columns from {table}...")

            try:
                # Query with timestamp filter if UpdatedAt exists
                col_list = ", ".join(cols)
                if 'UpdatedAt' in cols:
                    # Get last sync time from sheets_sync_log: max CompletedAt for successful exports
                    logger.info(f"[TIMESTAMP CHECK] Looking for last successful sync: config_key={config_key}, table={table}, direction=mysql_to_sheet")
                    try:
                        # Find the most recent COMPLETED batch from a successful sync
                        last_sync_query = db_query("""
                            SELECT MAX(CompletedAt) as LastCompletedTime
                            FROM sheets_sync_log
                            WHERE ConfigKey = %s AND Direction = %s AND Status = 'success'
                        """, [config_key, 'mysql_to_sheet'])

                        last_sync_time = None
                        if last_sync_query and last_sync_query[0]:
                            last_sync_time = last_sync_query[0].get('LastCompletedTime')

                        if last_sync_time:
                            logger.info(f"[TIMESTAMP CHECK] ✓ Found last successful sync completed at: {last_sync_time}")
                            sql = f"SELECT {col_list} FROM {table} WHERE UpdatedAt > %s"
                            rows = db_query(sql, [last_sync_time])
                            logger.info(f"[TIMESTAMP FILTER] ✓ Applied UpdatedAt > {last_sync_time}. Result: {len(rows)} rows to export")
                        else:
                            logger.info(f"[TIMESTAMP CHECK] ⚠ No prior successful sync found for {config_key} — treating as first sync")
                            rows = db_query(f"SELECT {col_list} FROM {table}")
                            logger.info(f"[TIMESTAMP FILTER] ⚠ First sync detected: exporting all {len(rows)} rows")
                    except Exception as ts_err:
                        # Fallback if query fails — don't hide the error
                        logger.error(f"[TIMESTAMP CHECK] ✗ Failed to query sheets_sync_log: {str(ts_err)}")
                        logger.warning(f"[TIMESTAMP FILTER] Falling back to unfiltered export (all rows)")
                        rows = db_query(f"SELECT {col_list} FROM {table}")
                        logger.warning(f"[TIMESTAMP FILTER] Fetched all {len(rows)} rows (timestamp check unavailable)")
                else:
                    rows = db_query(f"SELECT {col_list} FROM {table}")
                    logger.debug(f"Fetched {len(rows)} rows from {table} (UpdatedAt not in columns)")

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
            # export_transaction_meta sends dicts (not lists) so GAS can match by named key
            if config_key == 'export_transaction_meta':
                def _serialize(v):
                    if isinstance(v, datetime): return v.strftime('%Y-%m-%d %H:%M:%S')
                    if isinstance(v, date): return v.strftime('%Y-%m-%d')
                    if isinstance(v, Decimal):
                        f = float(v)
                        return int(f) if f == int(f) else f
                    return v if v is not None else ''
                sheet_rows = [
                    {col: _serialize(row.get(col)) for col in cfg['columns']}
                    for row in rows
                ]
            else:
                sheet_rows = _prepare_sheet_rows(rows, cfg)
            total_rows = len(sheet_rows)

            # Batch export to Sheets (send in chunks for large datasets)
            for batch_idx in range(0, len(sheet_rows), BATCH_SIZE):
                batch_data = sheet_rows[batch_idx:batch_idx + BATCH_SIZE]
                batch_num = batch_idx // BATCH_SIZE

                try:
                    logger.info(f"Writing batch {batch_num} ({len(batch_data)} rows) to {sheet_name}")
                    update_job(job_id, message=f"Writing batch {batch_num + 1} ({len(batch_data)} rows) to {sheet_name}...")

                    # Special handling for transaction metadata: use update_transaction_meta action
                    # instead of write_range to only update Notes & UpdatedAt columns
                    if config_key == 'export_transaction_meta':
                        webhook_action = 'update_transaction_meta'
                        webhook_payload = {
                            'action': webhook_action,
                            'rows': batch_data,
                        }
                    else:
                        webhook_action = 'write_range'
                        webhook_payload = {
                            'action': webhook_action,
                            'sheetName': sheet_name,
                            'spreadsheetId': cfg.get('spreadsheet', 'MEMBERSHIP'),  # Which workbook to write to
                            'rows': batch_data,
                            'overwrite': False,
                            'keyField': cfg.get('key', 'MemberID')  # Use configured key for upsert
                        }

                    logger.info(f"[GAS SEND] action={webhook_payload['action']}, rows={len(batch_data)}, sample={_truncate_log(batch_data)}")
                    result = gas_webhook(webhook_payload)
                    logger.info(f"[GAS RECV] raw result: {_truncate_log(result)}")
                    if result and 'notFound' in result:
                        not_found = result.get('notFound', [])
                        logger.warning(f"[GAS RECV] {len(not_found)} rows not matched in sheet: {_truncate_log(not_found, max_list=5)}")

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
            logger.info(f"[JOB {job_id}] Mapping {len(rows)} rows: cols={cols}, map_fields={cfg.get('map_fields', {})}")
            mapped_rows = []
            for row_idx, row in enumerate(rows):
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
                    # Handle invalid/blank dates: coerce '0000-00-00' and empty strings to NULL for date columns
                    if sql_col in ('Expiration', 'Created', 'PaymentDate', 'TransactionDate', 'CreatedAt', 'UpdatedAt'):
                        if value in ('', '0000-00-00', '0000-00-00 00:00:00', None) or (isinstance(value, str) and value.strip() == ''):
                            value = None
                    mapped_row[sql_col] = value
                mapped_rows.append(mapped_row)
                # Log first row for debugging
                if row_idx == 0:
                    logger.debug(f"[JOB {job_id}] First mapped row keys: {list(mapped_row.keys())}")

            # Diff filter: skip rows that are identical to what's already in MySQL
            skipped_unchanged = 0
            if cfg.get('skip_if_unchanged') and sync_mode == 'upsert':
                sql_cols = [cfg.get('map_fields', {}).get(c, c) for c in cols]
                mapped_rows, skipped_unchanged = _filter_changed_rows(
                    db_query, table, pk, mapped_rows, sql_cols, job_id
                )
                update_job(job_id, message=f"Diff complete: {len(mapped_rows)} rows changed, {skipped_unchanged} unchanged (skipped)")

            action_verb = "Inserting" if sync_mode == 'insert_only' else "Upserting"
            total_rows = len(mapped_rows)
            if total_rows == 0:
                logger.info(f"[{job_id}] No changes detected — skipping DB write entirely")
                return {
                    'status': 'success',
                    'message': f'No changes: all {skipped_unchanged} rows already up to date',
                    'inserted': 0, 'updated': 0, 'skipped': skipped_unchanged
                }
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

                        # Use VALUES(col) syntax — compatible with MySQL 5.7
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

                        # Count pre-existing keys in one query (IN clause)
                        try:
                            pk_vals = [row[pk] for row in batch]
                            placeholders_in = ", ".join(["%s"] * len(pk_vals))
                            check_sql = f"SELECT COUNT(*) as cnt FROM {table} WHERE {pk} IN ({placeholders_in})"
                            check_res = db_query(check_sql, pk_vals)
                            existing_count = check_res[0].get('cnt', 0) if check_res else 0
                            batch_updated = existing_count
                            batch_inserted = len(batch) - existing_count
                            batch_skipped = 0
                            logger.info(f"Batch {batch_num}: pre-existing={existing_count}, new={batch_inserted}, total={len(batch)}")
                        except Exception as diag_e:
                            logger.warning(f"Batch {batch_num}: insert/update count check failed: {str(diag_e)}, using res={res}")
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
                    stop_msg = f"[JOB {job_id}] {config_key} → {table}: STOPPED after batch {batch_num}. Error: {batch_error}. Remaining: {remaining} rows unprocessed."
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


