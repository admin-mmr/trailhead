"""
Tests for date serialization in district member API responses.

Regression coverage for: Expiration dates appearing one day early in
negative-UTC-offset timezones (e.g. ET) because date-only ISO strings
like "2027-03-31" are parsed by JavaScript as UTC midnight, which shifts
to Mar 30 at 8 PM the prior day in ET.

The fix in static/DistrictMembersPanel.js appends "T00:00:00" to date-only
strings so they are parsed as local time. These tests ensure the API
upholds the date-only string contract that the fix depends on.

Coverage:
  API contract
  ├── Expiration returned as "YYYY-MM-DD" string (not datetime object, not ISO datetime)
  ├── LastModified returned as "YYYY-MM-DD" string when date-only
  ├── PaymentDate returned as "YYYY-MM-DD" string when date-only
  └── None / null fields pass through as null (not "None" string)

  helpers.MmrJSONEncoder
  ├── datetime.date  → "YYYY-MM-DD"
  ├── datetime.datetime → full ISO string
  └── Non-date types serialized normally

  Regression: date values are never returned as raw Python objects
"""
import json
import re
import pytest
from datetime import date, datetime
from unittest.mock import patch

# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

DATE_ONLY_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
ISO_DATETIME_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}')

# A row as mysql.connector would return it — date/datetime Python objects.
def _db_row(**overrides):
    base = {
        'MemberID': 'A0001',
        'Status': 'active',
        'FirstName': 'Christina',
        'LastName': 'Yang',
        'Name': 'Christina Yang',
        'District': 'Bloomfield',
        'Expiration': date(2027, 3, 31),    # the problematic field
        'Gender': None,
        'WeChatID': None,
        'Email': 'christinaxy31@gmail.com',
        'Type': 'Individual',
        'FamilyID': None,
        'PaymentDate': date(2026, 3, 15),
        'MembershipFeePaid': None,
        'PaymentTransaction': None,
        'LastModified': datetime(2026, 3, 15, 10, 30, 0),
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Helpers / JSON encoder unit tests
# ---------------------------------------------------------------------------

class TestMmrJSONEncoder:
    """helpers.MmrJSONEncoder must serialise date types correctly."""

    def _encode(self, obj):
        from helpers import DateEncoder
        return json.dumps(obj, cls=DateEncoder)

    def test_date_serializes_to_date_only_string(self):
        result = json.loads(self._encode({'d': date(2027, 3, 31)}))
        assert result['d'] == '2027-03-31', (
            "datetime.date must serialize as YYYY-MM-DD — JS parses date-only "
            "strings as UTC, so this contract is required for the T00:00:00 fix."
        )

    def test_date_string_matches_date_only_pattern(self):
        result = json.loads(self._encode({'d': date(2027, 3, 31)}))
        assert DATE_ONLY_RE.match(result['d']), (
            "Date string must be exactly YYYY-MM-DD with no time component."
        )

    def test_datetime_serializes_with_time_component(self):
        result = json.loads(self._encode({'dt': datetime(2026, 3, 15, 10, 30, 0)}))
        assert ISO_DATETIME_RE.match(result['dt']), (
            "datetime.datetime must include a time component so JS doesn't "
            "apply the date-only UTC-midnight treatment."
        )

    def test_none_serializes_as_null_not_string(self):
        result = json.loads(self._encode({'v': None}))
        assert result['v'] is None

    def test_regular_string_unchanged(self):
        result = json.loads(self._encode({'s': 'hello'}))
        assert result['s'] == 'hello'

    def test_integer_unchanged(self):
        result = json.loads(self._encode({'n': 42}))
        assert result['n'] == 42


# ---------------------------------------------------------------------------
# API contract: /api/district/list
# ---------------------------------------------------------------------------

class TestDistrictListDateContract:
    """
    /api/district/list must serialize Expiration as a YYYY-MM-DD string.
    Regression: raw datetime.date objects in JSON responses are not valid JSON
    and were silently broken by Flask's default encoder before helpers.py added
    MmrJSONEncoder, causing the JS side to receive "[object Object]" or errors.
    """

    @pytest.fixture()
    def mock_district_query(self):
        """Patch the query calls made by api_district_members."""
        with patch('api_district_members.get_enum_values', return_value=['active', 'expired', 'inactive', 'pending', 'pending_upgrade', 'lifetime']), \
             patch('api_district_members.query') as mock_q:
            yield mock_q

    def test_expiration_returned_as_date_only_string(self, client, mock_district_query):
        mock_district_query.return_value = [_db_row()]
        r = client.get('/api/district/list')
        assert r.status_code == 200
        data = r.get_json()
        member = data['members'][0]
        expiration = member['Expiration']
        assert isinstance(expiration, str), (
            f"Expiration must be a JSON string, got {type(expiration).__name__!r}. "
            "Raw date objects break the JS timezone fix."
        )
        assert DATE_ONLY_RE.match(expiration), (
            f"Expiration '{expiration}' must be YYYY-MM-DD. "
            "JS appends T00:00:00 to date-only strings to force local-time parsing; "
            "any other format bypasses the fix and causes off-by-one-day errors."
        )
        assert expiration == '2027-03-31', (
            f"Expected '2027-03-31', got '{expiration}'."
        )

    def test_expiration_none_returns_null(self, client, mock_district_query):
        mock_district_query.return_value = [_db_row(Expiration=None)]
        r = client.get('/api/district/list')
        assert r.status_code == 200
        member = r.get_json()['members'][0]
        assert member['Expiration'] is None, (
            "Null Expiration must be JSON null, not the string 'None'."
        )

    def test_payment_date_returned_as_date_only_string(self, client, mock_district_query):
        mock_district_query.return_value = [_db_row()]
        r = client.get('/api/district/list')
        assert r.status_code == 200
        member = r.get_json()['members'][0]
        payment_date = member['PaymentDate']
        if payment_date is not None:
            assert DATE_ONLY_RE.match(payment_date), (
                f"PaymentDate '{payment_date}' must be YYYY-MM-DD for the same "
                "timezone-safety reasons as Expiration."
            )

    def test_last_modified_returned_as_string(self, client, mock_district_query):
        mock_district_query.return_value = [_db_row()]
        r = client.get('/api/district/list')
        assert r.status_code == 200
        member = r.get_json()['members'][0]
        last_modified = member['LastModified']
        if last_modified is not None:
            assert isinstance(last_modified, str), (
                "LastModified must be a JSON string, not a raw Python object."
            )

    def test_multiple_rows_all_dates_are_strings(self, client, mock_district_query):
        """Regression: serialization must apply to every row, not just the first."""
        rows = [
            _db_row(MemberID='A0001', Expiration=date(2027, 3, 31)),
            _db_row(MemberID='A0002', Expiration=date(2026, 12, 31)),
            _db_row(MemberID='A0003', Expiration=None),
        ]
        mock_district_query.return_value = rows
        r = client.get('/api/district/list')
        assert r.status_code == 200
        members = r.get_json()['members']
        assert len(members) == 3
        for m in members:
            exp = m['Expiration']
            if exp is not None:
                assert DATE_ONLY_RE.match(exp), (
                    f"MemberID {m['MemberID']}: Expiration '{exp}' is not YYYY-MM-DD."
                )

    def test_march_31_specifically(self, client, mock_district_query):
        """
        Explicit regression test: March 31 dates must NOT appear as March 30.
        In ET (UTC-4), new Date('2027-03-31') → UTC midnight → Mar 30 8PM ET.
        The API must return '2027-03-31' and JS must append T00:00:00 to fix it.
        """
        mock_district_query.return_value = [_db_row(Expiration=date(2027, 3, 31))]
        r = client.get('/api/district/list')
        assert r.status_code == 200
        member = r.get_json()['members'][0]
        assert member['Expiration'] == '2027-03-31', (
            "March 31 must serialize as '2027-03-31', not '2027-03-30'. "
            "This is the exact date from the bug report (Christina Yang, A0599)."
        )
