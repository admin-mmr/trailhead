"""
sync_audit.py — Error logging and column validation.

Provides:
  - log_sync_error: Log sync errors with context
  - filter_sync_columns: Filter columns by allowed list
  - is_immutable_column: Check if column is immutable
"""

from __future__ import annotations
import json, logging
from sync_types import MEMBERS_SYNC_COLUMNS, STANDARD_TABLES, IMMUTABLE_ON_UPDATE

logger = logging.getLogger(__name__)

def _serialize(obj):
    """JSON serializer for non-standard types."""
    if isinstance(obj, (list, tuple)):
        return [_serialize(x) for x in obj]
    if isinstance(obj, dict):
        return {k: _serialize(v) for k, v in obj.items()}
    return str(obj)

def log_sync_error(table, row_key, error, context=''):
    """Log a sync error with context."""
    logger.error(f"[{table}] {row_key}: {error} | {context}")

def filter_sync_columns(columns, table):
    """Filter columns by the allowed list for the table."""
    if table == 'members':
        return [c for c in columns if c in MEMBERS_SYNC_COLUMNS]
    return columns

def is_immutable_column(column, table=''):
    """Check if a column is immutable on update."""
    return column in IMMUTABLE_ON_UPDATE
