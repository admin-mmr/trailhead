"""
sync_compare.py — Row comparison and conflict resolution.

Provides:
  - _rows_differ: Detect if rows differ
  - _values_equal: Type-aware equality check
  - classify_rows: Classify rows as added/modified/unchanged
  - compare_sync_rows: Bidirectional comparison with conflict resolution
  - resolve_conflict: Pick winning value in conflicts
  - resolve_gmail_row: Gmail-specific resolution
  - _safe_int: Safe integer parsing
"""

from __future__ import annotations
import logging
from sync_types import SyncDecision, GmailSyncAction, IMMUTABLE_ON_UPDATE, STANDARD_TABLES
from sync_datetime import datetimes_equal, parse_datetime

logger = logging.getLogger(__name__)

def _safe_int(v):
    """Safely parse integer, handling None and string representations."""
    if v is None:
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None

def _values_equal(a, b):
    """Type-aware value equality (numeric coercion, datetime tolerance, None handling)."""
    if a is None and b is None:
        return True
    if a is None or b is None:
        return False
    # Try numeric comparison
    try:
        a_num = float(a) if isinstance(a, (int, float, str)) else None
        b_num = float(b) if isinstance(b, (int, float, str)) else None
        if a_num is not None and b_num is not None:
            return abs(a_num - b_num) < 0.001
    except (ValueError, TypeError):
        pass
    # Try datetime comparison
    if datetimes_equal(a, b):
        return True
    # String comparison
    return str(a).strip() == str(b).strip()

def _rows_differ(db_row, sheet_row, columns):
    """Check if rows differ in any specified column."""
    for col in columns:
        db_val = db_row.get(col)
        sheet_val = sheet_row.get(col)
        if not _values_equal(db_val, sheet_val):
            return True
    return False

def classify_rows(db_rows, sheet_rows, key_col, columns):
    """Classify rows as added (only in sheet), modified (in both, differ), or unchanged."""
    db_keys = {row[key_col]: row for row in db_rows}
    sheet_keys = {row[key_col]: row for row in sheet_rows}
    
    added = []
    modified = []
    unchanged = []
    
    for sheet_key, sheet_row in sheet_keys.items():
        if sheet_key not in db_keys:
            added.append(sheet_row)
        else:
            db_row = db_keys[sheet_key]
            if _rows_differ(db_row, sheet_row, columns):
                modified.append((db_row, sheet_row))
            else:
                unchanged.append(sheet_row)
    
    return added, modified, unchanged

def compare_sync_rows(db_row, sheet_row, config):
    """
    Bidirectional comparison: returns dict of conflicts and decisions.
    For each column: compare values and decide which wins (db, sheet, or neither).
    """
    if not db_row or not sheet_row:
        return {}
    
    decisions = {}
    immutable = IMMUTABLE_ON_UPDATE
    
    for col in config.get('columns', []):
        db_val = db_row.get(col)
        sheet_val = sheet_row.get(col)
        
        if col in immutable:
            decisions[col] = SyncDecision('immutable', 0, db_val, 'db')
            continue
        
        if _values_equal(db_val, sheet_val):
            decisions[col] = SyncDecision('equal', 0, db_val, 'both')
            continue
        
        # Conflict: pick winner
        winner = resolve_conflict(db_val, sheet_val, col, config)
        decisions[col] = winner
    
    return decisions

def resolve_conflict(db_val, sheet_val, column, config):
    """Pick winner in a conflicting cell (favor sheet updates unless immutable/critical)."""
    # Prefer sheet value unless it's empty and db has data
    if sheet_val and str(sheet_val).strip():
        return SyncDecision('prefer_sheet_non_empty', 2, sheet_val, 'sheet')
    if db_val and str(db_val).strip():
        return SyncDecision('preserve_db_nonempty', 1, db_val, 'db')
    return SyncDecision('both_empty', 0, sheet_val, 'sheet')

def resolve_conflict_unix(db_val, sheet_val, column):
    """Resolve Unix timestamp conflict: prefer most recent."""
    db_ts = _safe_int(db_val)
    sheet_ts = _safe_int(sheet_val)
    if db_ts and sheet_ts:
        return SyncDecision('prefer_newer_unix', 2 if sheet_ts > db_ts else 1, 
                          sheet_val if sheet_ts > db_ts else db_val,
                          'sheet' if sheet_ts > db_ts else 'db')
    return resolve_conflict(db_val, sheet_val, column, {})

def resolve_gmail_row(db_row, sheet_row):
    """Gmail-specific conflict resolution: prefer sheet (most recent from Gmail)."""
    # Gmail rows are append-only; always prefer sheet version
    return sheet_row
