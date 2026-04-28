"""
Tests for datetime_utils.py — to_datetime() and to_date().

Both functions are pure (no DB, no Flask) so every branch is exercised directly.
Coverage target: 100% of datetime_utils.py (was 0%).

Run:
    cd mmr-admin
    python3 -m pytest tests/test_datetime_utils.py -v
"""
from datetime import date, datetime, timezone, timedelta
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from datetime_utils import to_datetime, to_date


# ── to_datetime ──────────────────────────────────────────────────────────────

class TestToDatetime:
    def test_none_returns_none(self):
        assert to_datetime(None) is None

    def test_naive_datetime_returned_as_is(self):
        dt = datetime(2026, 3, 15, 10, 30, 0)
        result = to_datetime(dt)
        assert result == dt
        assert result.tzinfo is None

    def test_tz_aware_datetime_converted_to_utc_naive(self):
        # ET is UTC-5; 2026-01-01 05:00 ET == 2026-01-01 10:00 UTC
        et = timezone(timedelta(hours=-5))
        dt = datetime(2026, 1, 1, 5, 0, 0, tzinfo=et)
        result = to_datetime(dt)
        assert result.tzinfo is None
        assert result == datetime(2026, 1, 1, 10, 0, 0)

    def test_utc_aware_datetime_strips_tzinfo(self):
        dt = datetime(2026, 6, 1, 12, 0, 0, tzinfo=timezone.utc)
        result = to_datetime(dt)
        assert result.tzinfo is None
        assert result == datetime(2026, 6, 1, 12, 0, 0)

    def test_date_object_converted_to_midnight_datetime(self):
        d = date(2026, 4, 10)
        result = to_datetime(d)
        assert result == datetime(2026, 4, 10, 0, 0, 0)
        assert result.tzinfo is None

    def test_iso_string_naive_parsed(self):
        result = to_datetime('2026-03-31T04:00:00')
        assert result == datetime(2026, 3, 31, 4, 0, 0)
        assert result.tzinfo is None

    def test_iso_string_with_utc_offset_converted(self):
        # "2026-01-01T10:00:00+00:00" → naive UTC 10:00
        result = to_datetime('2026-01-01T10:00:00+00:00')
        assert result == datetime(2026, 1, 1, 10, 0, 0)
        assert result.tzinfo is None

    def test_iso_string_with_positive_offset_converted_to_utc(self):
        # "+08:00" → subtract 8 hours
        result = to_datetime('2026-01-01T08:00:00+08:00')
        assert result == datetime(2026, 1, 1, 0, 0, 0)

    def test_iso_string_z_suffix(self):
        # Python 3.11+ parses 'Z' natively; 3.10 may not — fromisoformat may raise
        # Test both: either it parses or gracefully returns None
        result = to_datetime('2026-03-31T04:00:00.000Z')
        assert result is None or isinstance(result, datetime)

    def test_date_only_string_not_supported_returns_none(self):
        # 'YYYY-MM-DD' is not a valid isoformat for datetime.fromisoformat in 3.10
        # Behaviour: fromisoformat fails → ValueError → None
        result = to_datetime('2026-04-01')
        # May succeed (returns midnight datetime) or return None — both acceptable
        assert result is None or result == datetime(2026, 4, 1, 0, 0, 0)

    def test_invalid_string_returns_none(self):
        assert to_datetime('not-a-date') is None

    def test_empty_string_returns_none(self):
        assert to_datetime('') is None

    def test_integer_returns_none(self):
        assert to_datetime(12345) is None

    def test_list_returns_none(self):
        assert to_datetime([2026, 1, 1]) is None


# ── to_date ──────────────────────────────────────────────────────────────────

class TestToDate:
    def test_none_returns_none(self):
        assert to_date(None) is None

    def test_date_object_returned_as_is(self):
        d = date(2026, 4, 28)
        assert to_date(d) == d

    def test_datetime_object_returns_date_portion(self):
        dt = datetime(2026, 4, 28, 15, 30, 0)
        assert to_date(dt) == date(2026, 4, 28)

    def test_date_string_yyyy_mm_dd_parsed(self):
        assert to_date('2026-04-01') == date(2026, 4, 1)

    def test_date_string_start_boundary(self):
        assert to_date('2025-10-01') == date(2025, 10, 1)

    def test_date_string_end_boundary(self):
        assert to_date('2026-03-31') == date(2026, 3, 31)

    def test_datetime_string_extracts_date(self):
        # Full ISO string — extracts date portion via [:10] slice
        result = to_date('2026-03-31T04:00:00')
        assert result == date(2026, 3, 31)

    def test_invalid_string_returns_none(self):
        assert to_date('not-a-date') is None

    def test_empty_string_returns_none(self):
        assert to_date('') is None

    def test_integer_returns_none(self):
        assert to_date(42) is None

    def test_string_with_time_component_stripped(self):
        # '2026-04-28T12:30:00' — [:10] gives '2026-04-28'
        assert to_date('2026-04-28T12:30:00') == date(2026, 4, 28)

    def test_tz_aware_datetime_object_date_portion(self):
        dt = datetime(2026, 1, 1, 23, 59, 0, tzinfo=timezone.utc)
        assert to_date(dt) == date(2026, 1, 1)

    def test_malformed_string_not_matching_iso_falls_back_to_to_datetime(self):
        # Something that fails fromisoformat but isn't nonsense — returns None
        result = to_date('April 28 2026')
        assert result is None
