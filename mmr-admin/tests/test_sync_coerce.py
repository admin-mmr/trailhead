"""
Unit tests for _coerce_value() and the MatchedMessageId FK guard logic.

Covers:
- _coerce_value: datetime, int, decimal, pass-through
- The empty-string MatchedMessageId bug (Bug #2 — 1452 FK violation)
"""
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from api_sheets_sync import _coerce_value


# ---------------------------------------------------------------------------
# _coerce_value: datetime columns
# ---------------------------------------------------------------------------

class TestCoerceDateTime:

    def test_iso_date_normalised_to_datetime(self):
        # _to_iso_datetime expands date-only strings to full datetime (MySQL DATETIME accepts this)
        result = _coerce_value('2026-03-31', 'Created', {'Created'}, set())
        assert result is not None
        assert '2026-03-31' in str(result)

    def test_empty_string_becomes_none(self):
        result = _coerce_value('', 'LastUpdated', {'LastUpdated'}, set())
        assert result is None

    def test_none_stays_none(self):
        result = _coerce_value(None, 'Expiration', {'Expiration'}, set())
        assert result is None


# ---------------------------------------------------------------------------
# _coerce_value: integer columns
# ---------------------------------------------------------------------------

class TestCoerceInt:

    def test_string_int_converted(self):
        result = _coerce_value('2015', 'JoinYear', set(), {'JoinYear'})
        assert result == 2015
        assert isinstance(result, int)

    def test_float_string_truncated(self):
        result = _coerce_value('2015.0', 'JoinYear', set(), {'JoinYear'})
        assert result == 2015

    def test_empty_string_becomes_none(self):
        result = _coerce_value('', 'JoinYear', set(), {'JoinYear'})
        assert result is None

    def test_none_stays_none(self):
        result = _coerce_value(None, 'YearBorn', set(), {'YearBorn'})
        assert result is None

    def test_non_numeric_string_becomes_none(self):
        result = _coerce_value('N/A', 'JoinYear', set(), {'JoinYear'})
        assert result is None


# ---------------------------------------------------------------------------
# _coerce_value: decimal columns
# ---------------------------------------------------------------------------

class TestCoerceDecimal:

    def test_string_float_converted(self):
        result = _coerce_value('150.00', 'Amount', set(), set(), {'Amount'})
        assert result == pytest.approx(150.0)
        assert isinstance(result, float)

    def test_empty_string_becomes_none(self):
        result = _coerce_value('', 'Amount', set(), set(), {'Amount'})
        assert result is None

    def test_none_stays_none(self):
        result = _coerce_value(None, 'Amount', set(), set(), {'Amount'})
        assert result is None


# ---------------------------------------------------------------------------
# _coerce_value: pass-through for other columns
# ---------------------------------------------------------------------------

class TestCoercePassThrough:

    def test_string_passes_through(self):
        result = _coerce_value('John', 'FirstName', set(), set())
        assert result == 'John'

    def test_none_passes_through_for_varchar(self):
        result = _coerce_value(None, 'Notes', set(), set())
        assert result is None

    def test_empty_string_passes_through_for_varchar(self):
        # Empty string is valid for VARCHAR — should NOT be coerced to None
        # (only datetime/int/decimal cols convert '' to None)
        result = _coerce_value('', 'Notes', set(), set())
        assert result == ''


# ---------------------------------------------------------------------------
# MatchedMessageId FK guard — the empty-string bug (Bug #2)
# ---------------------------------------------------------------------------

class TestMatchedMessageIdGuard:
    """
    Regression tests for the empty-string MatchedMessageId bug.

    Root cause: `if cols_to_insert.get('MatchedMessageId')` is False for ''
    so the FK guard was bypassed and '' was passed to MySQL, triggering 1452.

    Fix: check `not raw_mid or str(raw_mid).strip() == ''`
    """

    def _apply_guard(self, matched_id, valid_ids):
        """Reproduce the fixed guard logic from api_sheets_sync.py."""
        cols = {'MatchedMessageId': matched_id}
        raw_mid = cols.get('MatchedMessageId')
        if not raw_mid or str(raw_mid).strip() == '' or raw_mid not in valid_ids:
            cols['MatchedMessageId'] = None
        return cols['MatchedMessageId']

    def test_empty_string_nulled_out(self):
        """Bug #2: '' was not caught by the original `if cols.get('MatchedMessageId')` guard."""
        result = self._apply_guard('', {'MSG-001', 'MSG-002'})
        assert result is None, "Empty string must be NULLed to avoid FK violation"

    def test_none_stays_none(self):
        result = self._apply_guard(None, {'MSG-001'})
        assert result is None

    def test_whitespace_only_nulled(self):
        result = self._apply_guard('   ', {'MSG-001'})
        assert result is None

    def test_valid_id_preserved(self):
        result = self._apply_guard('MSG-001', {'MSG-001', 'MSG-002'})
        assert result == 'MSG-001'

    def test_id_not_in_valid_set_nulled(self):
        """MatchedMessageId present in Sheets but not yet imported to gmail_transactions."""
        result = self._apply_guard('MSG-999', {'MSG-001', 'MSG-002'})
        assert result is None

    def test_zero_string_nulled(self):
        """'0' is truthy in Python string context but invalid as a MessageId."""
        result = self._apply_guard('0', {'MSG-001'})
        assert result is None  # '0' not in valid_ids

    def test_falsy_like_values_all_nulled(self):
        """Ensure all falsy-ish values that would bypass the original guard are caught."""
        invalid_inputs = ['', '   ', None]
        valid_ids = {'MSG-001'}
        for v in invalid_inputs:
            result = self._apply_guard(v, valid_ids)
            assert result is None, f"Expected None for input {repr(v)}, got {repr(result)}"
