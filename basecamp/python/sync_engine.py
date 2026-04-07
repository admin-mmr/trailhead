"""
sync_engine.py — Thin sync engine orchestrator.

Provides public API:
  - compare_sync_rows: Compare two rows
  - classify_rows: Classify rows as added/modified/unchanged
  - And re-exports from extracted modules for backward compatibility

All heavy lifting delegated to specialized modules:
  - sync_types: Dataclasses, enums, type defs
  - sync_datetime: DateTime parsing and comparison
  - sync_compare: Comparison and conflict resolution
  - sync_audit: Error logging and column validation
"""

from __future__ import annotations
from sync_types import SyncDecision, GmailSyncAction, SyncAudit, SyncRowResult, STANDARD_TABLES, MEMBERS_SYNC_COLUMNS, IMMUTABLE_ON_UPDATE
from sync_datetime import parse_datetime, datetimes_equal, to_mysql_datetime
from sync_compare import compare_sync_rows, resolve_conflict, classify_rows, _rows_differ, _values_equal, _safe_int
from sync_audit import log_sync_error, filter_sync_columns, is_immutable_column

__all__ = [
    'SyncDecision', 'GmailSyncAction', 'SyncAudit', 'SyncRowResult',
    'STANDARD_TABLES', 'MEMBERS_SYNC_COLUMNS', 'IMMUTABLE_ON_UPDATE',
    'parse_datetime', 'datetimes_equal', 'to_mysql_datetime',
    'compare_sync_rows', 'resolve_conflict', 'classify_rows',
    '_rows_differ', '_values_equal', '_safe_int',
    'log_sync_error', 'filter_sync_columns', 'is_immutable_column',
]
