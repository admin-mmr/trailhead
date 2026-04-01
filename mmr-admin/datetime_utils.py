"""
Date/datetime normalization helpers for mmr-admin.

Replaces the repeated isinstance(val, datetime) / isinstance(val, date)
guard blocks scattered throughout payment_handlers.py and payment_actions.py.

Leaf module — no imports from other mmr-admin modules.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Optional


def to_datetime(val) -> Optional[datetime]:
    """
    Coerce val to datetime, or return None.

    Handles:
      - datetime  → returned as-is
      - date      → combined with midnight (datetime.min.time())
      - str       → parsed via fromisoformat (raises ValueError on bad format)
      - None/other → None
    """
    if val is None:
        return None
    if isinstance(val, datetime):
        return val
    if isinstance(val, date):
        return datetime.combine(val, datetime.min.time())
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val)
        except ValueError:
            return None
    return None


def to_date(val) -> Optional[date]:
    """
    Coerce val to date, or return None.

    Wraps to_datetime() and calls .date() on the result.
    """
    dt = to_datetime(val)
    return dt.date() if dt is not None else None
