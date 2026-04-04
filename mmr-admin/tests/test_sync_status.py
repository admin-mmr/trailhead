"""
Unit tests for _coerce_member_status() and _MEMBER_STATUS_MAP.

These tests directly cover Bug #1 (1265 ENUM truncation error) and document
the full mapping contract between Sheets/GAS values and MySQL ENUM values.

MySQL members.Status ENUM: ('active', 'not active', 'pending')
"""
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from sync_coerce import _coerce_member_status, _MEMBER_STATUS_ENUM, _MEMBER_STATUS_MAP


VALID_MYSQL_STATUSES = {'active', 'not active', 'pending'}


class TestCoerceMemberStatus:
    """_coerce_member_status maps all known Sheets/GAS values to valid MySQL ENUM."""

    # --- Pass-through: exact MySQL values --------------------------------

    def test_active_lowercase(self):
        val, warn = _coerce_member_status('active')
        assert val == 'active'
        assert warn is None  # no warning for no-op mapping

    def test_not_active_lowercase(self):
        val, warn = _coerce_member_status('not active')
        assert val == 'not active'

    def test_pending_lowercase(self):
        val, warn = _coerce_member_status('pending')
        assert val == 'pending'

    # --- Case normalization (the actual Bug #1 scenario) -----------------

    def test_Active_titlecase(self):
        """Sheets often sends 'Active' — must map to MySQL 'active'."""
        val, warn = _coerce_member_status('Active')
        assert val == 'active'

    def test_Pending_titlecase(self):
        val, warn = _coerce_member_status('Pending')
        assert val == 'pending'

    def test_Not_Active_titlecase(self):
        val, warn = _coerce_member_status('Not Active')
        assert val == 'not active'

    def test_ACTIVE_uppercase(self):
        val, warn = _coerce_member_status('ACTIVE')
        assert val == 'active'

    def test_NOT_ACTIVE_uppercase(self):
        val, warn = _coerce_member_status('NOT ACTIVE')
        assert val == 'not active'

    # --- GAS-specific labels that differ from MySQL ----------------------

    def test_inactive_maps_to_not_active(self):
        """GAS uses 'inactive'; MySQL ENUM has 'not active'."""
        val, warn = _coerce_member_status('inactive')
        assert val == 'not active', "GAS 'inactive' must map to MySQL 'not active'"

    def test_Inactive_maps_to_not_active(self):
        val, warn = _coerce_member_status('Inactive')
        assert val == 'not active'

    def test_INACTIVE_uppercase(self):
        val, warn = _coerce_member_status('INACTIVE')
        assert val == 'not active'

    def test_pending_upgrade_maps_to_pending(self):
        """GAS uses 'pending_upgrade'; MySQL has no such value — maps to 'pending'."""
        val, warn = _coerce_member_status('pending_upgrade')
        assert val == 'pending'

    def test_expired_maps_to_not_active(self):
        """'expired' is a logical state; maps to 'not active' in MySQL."""
        val, warn = _coerce_member_status('expired')
        assert val == 'not active'

    def test_Expired_titlecase(self):
        val, warn = _coerce_member_status('Expired')
        assert val == 'not active'

    # --- Empty / None values ---------------------------------------------

    def test_none_returns_none(self):
        val, warn = _coerce_member_status(None)
        assert val is None
        assert warn is None  # no warning for None — caller skips column

    def test_empty_string_returns_none(self):
        val, warn = _coerce_member_status('')
        assert val is None
        assert warn is None

    def test_whitespace_only(self):
        val, warn = _coerce_member_status('   ')
        # Whitespace-only should either return None or map via lowercased strip
        # Either is acceptable as long as it doesn't produce an invalid ENUM value
        assert val is None or val in VALID_MYSQL_STATUSES

    # --- Unknown values return None with a warning -----------------------

    def test_unknown_value_returns_none_with_warning(self):
        val, warn = _coerce_member_status('member')
        assert val is None
        assert warn is not None
        assert 'member' in warn  # warning includes the bad value

    def test_unknown_value_warning_mentions_valid_options(self):
        val, warn = _coerce_member_status('foobar')
        assert warn is not None
        assert 'active' in warn or 'not active' in warn or 'pending' in warn

    def test_numeric_value_unknown(self):
        val, warn = _coerce_member_status(42)
        assert val is None or val in VALID_MYSQL_STATUSES

    # --- All mapped values produce valid MySQL ENUM ----------------------

    def test_all_map_values_are_valid_mysql_enum(self):
        """Regression: every value in _MEMBER_STATUS_MAP must produce a valid ENUM value."""
        for sheets_val, mysql_val in _MEMBER_STATUS_MAP.items():
            assert mysql_val in VALID_MYSQL_STATUSES, (
                f"_MEMBER_STATUS_MAP['{sheets_val}'] = '{mysql_val}' "
                f"is not in MySQL ENUM {VALID_MYSQL_STATUSES}"
            )

    def test_coerce_always_safe_for_known_inputs(self):
        """Every key in _MEMBER_STATUS_MAP must not produce 1265 error."""
        for sheets_val in _MEMBER_STATUS_MAP:
            val, warn = _coerce_member_status(sheets_val)
            assert val in VALID_MYSQL_STATUSES, (
                f"_coerce_member_status('{sheets_val}') returned '{val}', "
                f"which is not a valid MySQL ENUM value"
            )


class TestMemberStatusEnum:
    """Sanity checks on the ENUM constant itself."""

    def test_enum_contains_all_three_values(self):
        assert _MEMBER_STATUS_ENUM == {'active', 'not active', 'pending'}

    def test_inactive_not_in_enum(self):
        """MySQL has 'not active', NOT 'inactive' — this is the root of Bug #1."""
        assert 'inactive' not in _MEMBER_STATUS_ENUM

    def test_expired_not_in_enum(self):
        assert 'expired' not in _MEMBER_STATUS_ENUM
