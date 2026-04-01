"""
Date/datetime normalization helpers for mmr-admin.

Design contract
───────────────
  DATETIME fields (Timestamp, ProcessedTime, Created, LastUpdated …)
    → always stored as naive UTC in MySQL
    → always travel as ISO 8601 UTC strings ("2026-03-31T04:00:00.000Z")
    → use to_datetime() / sync_engine.parse_datetime()

  DATE-only fields (Expiration, TransactionDate, PaymentDate …)
    → always "YYYY-MM-DD" strings in transit (after GAS toISODateString fix)
    → never apply timezone conversion
    → use to_date() which simply validates the string and returns a date object

Leaf module — no imports from other mmr-admin modules.
"""

from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Optional


def to_datetime(val) -> Optional[datetime]:
    """
    Coerce val to a *timezone-naive UTC* datetime, or return None.

    Handles:
      - datetime (tz-aware)   → converted to UTC, tzinfo stripped
      - datetime (naive)      → assumed UTC, returned as-is
      - date                  → combined with midnight (00:00:00)
      - str ISO 8601          → parsed; tz-aware strings converted to UTC
      - None / other          → None
    """
    if val is None:
        return None
    if isinstance(val, datetime):
        if val.tzinfo is not None:
            return val.astimezone(timezone.utc).replace(tzinfo=None)
        return val
    if isinstance(val, date):
        return datetime.combine(val, datetime.min.time())
    if isinstance(val, str):
        try:
            dt = datetime.fromisoformat(val)
            if dt.tzinfo is not None:
                return dt.astimezone(timezone.utc).replace(tzinfo=None)
            return dt
        except ValueError:
            return None
    return None


def to_date(val) -> Optional[date]:
    """
    Coerce val to a calendar date, or return None.

    For "YYYY-MM-DD" strings (the expected transit format after the GAS
    toISODateString fix) this is a direct parse — no timezone conversion.
    For datetime objects, returns the date portion.
    """
    if val is None:
        return None
    if isinstance(val, datetime):
        return val.date()
    if isinstance(val, date):
        return val
    if isinstance(val, str):
        s = val.strip()[:10]  # take date portion only
        try:
            return date.fromisoformat(s)
        except ValueError:
            pass
        # Fall back to full datetime parse (handles ISO 8601 with time)
        dt = to_datetime(val)
        return dt.date() if dt is not None else None
    return None
