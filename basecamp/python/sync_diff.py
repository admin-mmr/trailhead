"""
sync_diff.py — Row-level diff and change detection.

Provides:
  - _normalize_for_diff: Normalize values for comparison
  - _row_changed: Detect if a row has changed
  - _filter_changed_rows: Filter unchanged rows
"""

from __future__ import annotations
import logging
from decimal import Decimal
from datetime import date, datetime

logger = logging.getLogger(__name__)

def _normalize_for_diff(v, date_only=False):
    """
    Normalize a value for diff comparison.
    date_only=True  → compare as YYYY-MM-DD (used when MySQL column is DATE)
    date_only=False → compare as YYYY-MM-DD HH:MM:SS for datetimes, str for everything else
    """
    import re
    from datetime import datetime as _dt, date as _date
    from decimal import Decimal

    if v is None or v == '':
        return None

    # --- datetime / date objects (from MySQL) ---
    if isinstance(v, _dt):                        # datetime first (subclass of date)
        return v.strftime('%Y-%m-%d') if date_only else v.strftime('%Y-%m-%d %H:%M:%S')
    if isinstance(v, _date):
        return v.strftime('%Y-%m-%d')             # DATE column — always date-only

    # --- Decimal ---
    if isinstance(v, Decimal):
        f = float(v)
        return int(f) if f == int(f) else f

    # --- float with no fractional part ---
    if isinstance(v, float) and v == int(v):
        return int(v)

    # --- strings ---
    if isinstance(v, str):
        s = v.strip()
        # Datetime string 'YYYY-MM-DD HH:MM:SS' or 'YYYY-MM-DDTHH:MM:SS'
        m = re.match(r'^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})', s)
        if m:
            return m.group(1) if date_only else f"{m.group(1)} {m.group(2)}"
        # Plain integer string — coerce to int so '28727630742' == 28727630742
        if re.match(r'^\d+$', s):
            return int(s)
        return s

    # --- int: keep as int (Decimal/float already normalised to int above) ---
    if isinstance(v, int):
        return v

    return v


def _row_changed(incoming: dict, existing: dict) -> list:
    """Return list of (col, old, new) tuples for columns that differ. Empty = no change."""
    from datetime import datetime as _dt, date as _date
    diffs = []
    for col, new_val in incoming.items():
        old_val = existing.get(col)
        # If MySQL returned a DATE (not datetime), truncate incoming to date too
        date_only = isinstance(old_val, _date) and not isinstance(old_val, _dt)
        if _normalize_for_diff(new_val, date_only) != _normalize_for_diff(old_val, date_only):
            diffs.append((col, old_val, new_val))
    return diffs


def _filter_changed_rows(db_query, table: str, pk: str, mapped_rows: list, cols: list, job_id: str) -> tuple:
    """
    Fetch existing rows from MySQL for all incoming PKs in one query.
    Return (rows_to_write, skipped_count) where rows_to_write excludes unchanged rows.
    """
    if not mapped_rows:
        return mapped_rows, 0

    pk_vals = [row[pk] for row in mapped_rows if row.get(pk)]
    if not pk_vals:
        return mapped_rows, 0

    try:
        placeholders = ", ".join(["%s"] * len(pk_vals))
        existing_rows = db_query(
            f"SELECT {', '.join(cols)} FROM {table} WHERE {pk} IN ({placeholders})",
            pk_vals
        )
        existing_map = {str(r[pk]): r for r in existing_rows}
        logger.info(f"[{job_id}] diff check: {len(pk_vals)} incoming, {len(existing_map)} already in DB")

        to_write, skipped = [], 0
        # Track per-column change counts + sample diffs for diagnostics
        col_change_counts = {}
        sample_diffs = []   # first 5 changed rows, for pretty-print

        for row in mapped_rows:
            key = str(row.get(pk, ''))
            if key not in existing_map:
                to_write.append(row)
            else:
                diffs = _row_changed(row, existing_map[key])
                if diffs:
                    to_write.append(row)
                    for col, old_v, new_v in diffs:
                        col_change_counts[col] = col_change_counts.get(col, 0) + 1
                    if len(sample_diffs) < 5:
                        sample_diffs.append((key, diffs))
                else:
                    skipped += 1

        # ── Pretty-print diff summary ─────────────────────────────────────
        new_rows = len(to_write) - len(sample_diffs) + (len(to_write) - sum(1 for _ in sample_diffs))
        new_count = len([r for r in mapped_rows if str(r.get(pk, '')) not in existing_map])
        changed_count = len(to_write) - new_count

        lines = [
            f"",
            f"  ┌─ Diff Summary [{job_id}] ──────────────────────────────",
            f"  │  Incoming : {len(mapped_rows):>5}",
            f"  │  New      : {new_count:>5}  (not in DB yet)",
            f"  │  Changed  : {changed_count:>5}  (at least one column differs)",
            f"  │  Skipped  : {skipped:>5}  (identical — no write needed)",
        ]
        if col_change_counts:
            lines.append(f"  │")
            lines.append(f"  │  Columns triggering changes:")
            for col, cnt in sorted(col_change_counts.items(), key=lambda x: -x[1]):
                lines.append(f"  │    {col:<22} {cnt:>4} rows affected")
        if sample_diffs:
            lines.append(f"  │")
            lines.append(f"  │  Sample diffs (first {len(sample_diffs)}):")
            for pk_val, diffs in sample_diffs:
                lines.append(f"  │   {pk}={pk_val}")
                for col, old_v, new_v in diffs:
                    old_s = repr(old_v)[:40]
                    new_s = repr(new_v)[:40]
                    lines.append(f"  │     {col:<22}  {old_s}  →  {new_s}")
        lines.append(f"  └────────────────────────────────────────────────")
        logger.info("\n".join(lines))
        # ─────────────────────────────────────────────────────────────────

        return to_write, skipped
    except Exception as e:
        logger.warning(f"[{job_id}] diff check failed ({e}), falling back to full upsert")
        return mapped_rows, 0


# ─────────────────────────────────────────────────────────────────────────────
# Batch & Logging Functions (must be defined before generic_sync_runner)
# ─────────────────────────────────────────────────────────────────────────────

