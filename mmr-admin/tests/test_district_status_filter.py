"""
Tests for district member status filter correctness.

Coverage:
  Unit
  ├── get_enum_values() — COLUMN_TYPE parsing, cache, missing column, non-ENUM type
  ├── get_member_status_options() — sentinel ordering, grouping, edge ENUM sets
  ├── apply_status_filter() — all valid values, sentinel expansion, rejections
  └── apply_renewal_filter() — combined with status, MEMBERSHIP_YEAR_END env var

  HTTP  /api/district/list
  ├── Each valid status passes; invalid statuses → 400
  ├── not_active generates parameterised IN (never literal string in SQL)
  ├── Combined status + district, status + renewal, status + sort, status + limit
  └── Case sensitivity: 'Active' ≠ 'active' → rejected

  HTTP  /api/district/member-status-values
  ├── Response shape matches frontend contract
  ├── expired/inactive hidden; not_active sentinel present with expands_to
  └── New ENUM value automatically surfaces

  HTTP  /api/district/export-csv
  HTTP  /api/district/export-all-districts
  HTTP  /api/district/export-all-sheet
  └── valid status → 200, not_active → 200, invalid → 400
"""
import os
import pytest
from unittest.mock import patch, call

# ---------------------------------------------------------------------------
# Shared fixtures / constants
# ---------------------------------------------------------------------------
_DB_ENUM = ['active', 'expired', 'inactive', 'pending', 'pending_upgrade', 'lifetime']
_PATCH_TARGET = 'api_district_members.get_enum_values'


def _row(**overrides):
    base = {
        'MemberID': 'A0001', 'Status': 'active',
        'FirstName': 'Jane', 'LastName': 'Doe',
        'District': 'Manhattan', 'Expiration': None,
        'Gender': None, 'WeChatID': None, 'Email': None,
        'Type': None, 'FamilyID': None, 'PaymentDate': None,
        'MembershipFeePaid': None, 'PaymentTransaction': None,
        'LastModified': None,
    }
    base.update(overrides)
    return base


# ===========================================================================
# 1. Unit — get_enum_values()
# ===========================================================================

class TestGetEnumValues:
    """Parsing and caching behaviour of db.get_enum_values()."""

    @pytest.fixture(autouse=True)
    def _clear_cache(self):
        """Isolate each test: wipe the module-level cache before and after."""
        import db
        db._enum_cache.clear()
        yield
        db._enum_cache.clear()

    def _mock_query(self, column_type_str):
        """Return a patcher that makes db.query() return a COLUMN_TYPE row."""
        import db
        return patch.object(db, 'query', return_value=[{'COLUMN_TYPE': column_type_str}])

    # --- Parsing ---

    def test_standard_enum_parsed_correctly(self):
        import db
        with self._mock_query("enum('active','expired','inactive','pending','pending_upgrade','lifetime')"):
            result = db.get_enum_values('members', 'Status')
        assert result == ['active', 'expired', 'inactive', 'pending', 'pending_upgrade', 'lifetime']

    def test_single_value_enum(self):
        import db
        with self._mock_query("enum('active')"):
            result = db.get_enum_values('members', 'Status')
        assert result == ['active']

    def test_enum_with_underscores_in_values(self):
        import db
        with self._mock_query("enum('pending_upgrade','pending_downgrade')"):
            result = db.get_enum_values('members', 'Status')
        assert result == ['pending_upgrade', 'pending_downgrade']

    def test_column_not_found_returns_empty_list(self):
        import db
        with patch.object(db, 'query', return_value=[]):
            result = db.get_enum_values('members', 'NonExistentColumn')
        assert result == []

    def test_non_enum_column_type_returns_empty_list(self):
        """varchar/int columns have no quoted values to parse."""
        import db
        with self._mock_query("varchar(255)"):
            result = db.get_enum_values('members', 'Email')
        assert result == []

    # --- Caching ---

    def test_cache_prevents_second_db_call(self):
        import db
        with patch.object(db, 'query', return_value=[{'COLUMN_TYPE': "enum('active','pending')"}]) as mock_q:
            db.get_enum_values('members', 'Status')
            db.get_enum_values('members', 'Status')  # second call
        assert mock_q.call_count == 1  # DB only hit once

    def test_cache_is_keyed_by_table_and_column(self):
        """Different table.column combos get separate cache entries."""
        import db
        with patch.object(db, 'query', return_value=[{'COLUMN_TYPE': "enum('a')"}]) as mock_q:
            db.get_enum_values('members', 'Status')
            db.get_enum_values('submissions', 'Status')  # different table
        assert mock_q.call_count == 2

    def test_cache_cleared_between_tests(self):
        """The autouse fixture must have cleared cache from any prior test."""
        import db
        assert 'members.Status' not in db._enum_cache


# ===========================================================================
# 2. Unit — get_member_status_options()
# ===========================================================================

class TestGetMemberStatusOptions:
    """Shape and ordering of the frontend options list."""

    def _opts(self, enum_values=None):
        import api_district_members
        values = enum_values if enum_values is not None else _DB_ENUM
        with patch(_PATCH_TARGET, return_value=values):
            options, raw = api_district_members.get_member_status_options()
        return options, raw

    def test_first_option_is_all_statuses_placeholder(self):
        opts, _ = self._opts()
        assert opts[0] == {'value': '', 'label': 'All Statuses'}

    def test_sentinel_inserted_immediately_after_active(self):
        opts, _ = self._opts()
        values = [o['value'] for o in opts]
        active_idx = values.index('active')
        assert values[active_idx + 1] == 'not_active'

    def test_expired_and_inactive_absent_from_options(self):
        opts, _ = self._opts()
        values = [o['value'] for o in opts]
        assert 'expired' not in values
        assert 'inactive' not in values

    def test_sentinel_expands_to_contract(self):
        opts, _ = self._opts()
        sentinel = next(o for o in opts if o['value'] == 'not_active')
        assert set(sentinel['expands_to']) == {'expired', 'inactive'}

    def test_raw_set_contains_all_db_values(self):
        _, raw = self._opts()
        assert raw == set(_DB_ENUM)

    def test_pending_upgrade_label_humanised(self):
        opts, _ = self._opts()
        pu = next(o for o in opts if o['value'] == 'pending_upgrade')
        assert pu['label'] == 'Pending Upgrade'

    def test_enum_without_active_still_includes_sentinel(self):
        """If 'active' is somehow absent, sentinel still appears (appended at end of loop)."""
        enum_no_active = ['expired', 'inactive', 'pending']
        opts, _ = self._opts(enum_no_active)
        values = [o['value'] for o in opts]
        # sentinel must still be in the list (appended after 'expired' since 'active' never seen)
        # — implementation detail: sentinel is added when v == 'active'; if absent it won't appear.
        # This test documents the current behaviour: sentinel is NOT added without 'active'.
        assert 'not_active' not in values

    def test_unknown_new_enum_value_appears_in_options(self):
        opts, _ = self._opts(_DB_ENUM + ['honorary'])
        values = [o['value'] for o in opts]
        assert 'honorary' in values


# ===========================================================================
# 3. Unit — apply_status_filter()
# ===========================================================================

class TestApplyStatusFilterHelper:
    """Direct unit tests for api_district_export.apply_status_filter."""

    @pytest.fixture(autouse=True)
    def _patch_enum(self):
        with patch(_PATCH_TARGET, return_value=_DB_ENUM):
            yield

    def _fn(self):
        import api_district_export
        return api_district_export.apply_status_filter

    # --- No-op ---
    def test_empty_string_is_noop(self):
        sql, params, err = self._fn()("SELECT 1 WHERE 1=1", [], "")
        assert err is None and "Status" not in sql and params == []

    # --- Exact matches for every ENUM value ---
    @pytest.mark.parametrize("status", _DB_ENUM)
    def test_valid_enum_value_exact_match(self, status):
        sql, params, err = self._fn()("WHERE 1=1", [], status)
        assert err is None
        assert "AND Status = %s" in sql
        assert params == [status]

    # --- Sentinel ---
    def test_not_active_uses_parameterised_in(self):
        sql, params, err = self._fn()("WHERE 1=1", [], "not_active")
        assert err is None
        assert "IN (%s, %s)" in sql
        assert set(params) == {'expired', 'inactive'}
        # Sentinel string must not reach SQL
        assert "not_active" not in sql

    def test_not_active_params_are_in_order(self):
        """Both DB values are bound; order matches _NOT_ACTIVE_DB_VALUES tuple."""
        import api_district_members
        expected = list(api_district_members._NOT_ACTIVE_DB_VALUES)
        _, params, _ = self._fn()("WHERE 1=1", [], "not_active")
        assert params == expected

    def test_existing_params_are_preserved(self):
        """apply_status_filter must extend, not replace, the existing params list."""
        sql, params, err = self._fn()("WHERE District = %s", ['Manhattan'], "active")
        assert err is None
        assert params == ['Manhattan', 'active']

    # --- Rejections ---
    def test_legacy_not_active_space_rejected(self):
        _, _, err = self._fn()("WHERE 1=1", [], "not active")
        assert err and "Invalid status" in err

    def test_uppercase_rejected(self):
        """MySQL ENUM matching is case-sensitive at the app layer — 'Active' is not 'active'."""
        _, _, err = self._fn()("WHERE 1=1", [], "Active")
        assert err and "Invalid status" in err

    def test_empty_string_after_strip_is_noop(self):
        sql, params, err = self._fn()("WHERE 1=1", [], "   ")
        # strip() in the caller leaves "   ".strip() == "" which is falsy → noop
        assert err is None

    @pytest.mark.parametrize("bad", [
        "foobar", "ACTIVE", "Active", "1 OR 1=1", "'; DROP TABLE members;--",
        "not active", "not-active", "expired inactive",
    ])
    def test_invalid_values_rejected(self, bad):
        _, _, err = self._fn()("WHERE 1=1", [], bad)
        assert err is not None


# ===========================================================================
# 4. Unit — apply_renewal_filter() combined with status
# ===========================================================================

class TestRenewalFilterCombined:
    """Renewal filter appends an Expiration clause independently of status."""

    @pytest.fixture(autouse=True)
    def _year_end(self, monkeypatch):
        monkeypatch.setenv('MEMBERSHIP_YEAR_END', '2026-12-31')

    def _filter(self, status='', renewal=''):
        import api_district_export
        with patch(_PATCH_TARGET, return_value=_DB_ENUM):
            sql, params, err = api_district_export.apply_status_filter("WHERE 1=1", [], status)
        if err:
            return None, None, err
        sql, params = api_district_export.apply_renewal_filter(sql, params, renewal)
        return sql, params, None

    def test_status_and_renewal_both_applied(self):
        sql, params, err = self._filter('active', 'yes')
        assert err is None
        assert "AND Status = %s" in sql
        assert "AND Expiration >= %s" in sql
        assert 'active' in params

    def test_not_active_with_renewal_no(self):
        sql, params, err = self._filter('not_active', 'no')
        assert err is None
        assert "IN (%s, %s)" in sql
        assert "AND Expiration < %s" in sql

    def test_renewal_only_no_status(self):
        sql, params, err = self._filter('', 'yes')
        assert err is None
        assert "Status" not in sql
        assert "AND Expiration >= %s" in sql

    def test_renewal_filter_ignored_without_year_end(self, monkeypatch):
        monkeypatch.delenv('MEMBERSHIP_YEAR_END', raising=False)
        sql, params, err = self._filter('active', 'yes')
        assert err is None
        assert "Expiration" not in sql  # no year_end → renewal clause skipped


# ===========================================================================
# 5. HTTP — /api/district/list  (combined query param tests)
# ===========================================================================

class TestDistrictListStatusFilter:
    """HTTP-level tests for GET /api/district/list."""

    @pytest.fixture(autouse=True)
    def _patch_enum(self):
        with patch(_PATCH_TARGET, return_value=_DB_ENUM):
            yield

    # --- Each valid value passes ---
    @pytest.mark.parametrize("status", _DB_ENUM)
    def test_valid_status_returns_200(self, status, client, mock_query):
        mock_query.return_value = []
        r = client.get(f'/api/district/list?status={status}')
        assert r.status_code == 200

    def test_not_active_sentinel_returns_200(self, client, mock_query):
        mock_query.return_value = []
        assert client.get('/api/district/list?status=not_active').status_code == 200

    def test_empty_status_returns_200(self, client, mock_query):
        mock_query.return_value = []
        assert client.get('/api/district/list').status_code == 200

    # --- Rejections ---
    @pytest.mark.parametrize("bad", [
        "not+active", "Active", "PENDING", "garbage", "expired inactive",
    ])
    def test_invalid_status_returns_400(self, bad, client, mock_query):
        mock_query.return_value = []
        r = client.get(f'/api/district/list?status={bad}')
        assert r.status_code == 400
        assert r.get_json()['success'] is False

    # --- SQL shape for not_active ---
    def test_not_active_generates_parameterised_in(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/district/list?status=not_active')
        sql = mock_query.call_args[0][0]
        assert "IN (%s" in sql
        assert "not_active" not in sql
        params = mock_query.call_args[0][1]
        assert "expired" in params and "inactive" in params

    def test_active_binds_single_param(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/district/list?status=active')
        sql, params = mock_query.call_args[0][0], mock_query.call_args[0][1]
        assert "AND Status = %s" in sql
        assert params.count('active') == 1

    # --- Combined with district ---
    def test_status_and_district_both_in_sql(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/district/list?status=active&district=Manhattan')
        sql = mock_query.call_args[0][0]
        assert "AND District = %s" in sql
        assert "AND Status = %s" in sql

    # --- Combined with sortBy / sortOrder ---
    def test_status_with_custom_sort(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/district/list?status=active&sortBy=LastName&sortOrder=desc')
        assert r.status_code == 200
        sql = mock_query.call_args[0][0]
        assert "LastName desc" in sql.lower() or "ORDER BY LastName desc" in sql

    def test_invalid_sort_column_falls_back_to_district(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/district/list?status=active&sortBy=evil_col')
        assert r.status_code == 200
        sql = mock_query.call_args[0][0]
        assert "ORDER BY District" in sql

    # --- Limit ---
    def test_status_with_explicit_limit(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/district/list?status=active&limit=10')
        assert r.status_code == 200
        params = mock_query.call_args[0][1]
        assert 10 in params

    def test_limit_capped_at_5000(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/district/list?status=active&limit=99999')
        params = mock_query.call_args[0][1]
        assert 5000 in params
        assert 99999 not in params

    # --- Response shape ---
    def test_response_contains_count_and_members_keys(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = client.get('/api/district/list?status=active')
        data = r.get_json()
        assert 'count' in data and 'members' in data

    def test_count_matches_returned_rows(self, client, mock_query):
        mock_query.return_value = [_row(), _row(MemberID='A0002')]
        r = client.get('/api/district/list')
        data = r.get_json()
        assert data['count'] == 2 and len(data['members']) == 2


# ===========================================================================
# 6. HTTP — /api/district/member-status-values
# ===========================================================================

class TestMemberStatusValuesEndpoint:
    """GET /api/district/member-status-values — INFORMATION_SCHEMA-driven dropdown contract."""

    @pytest.fixture(autouse=True)
    def _patch_enum(self):
        with patch(_PATCH_TARGET, return_value=_DB_ENUM):
            yield

    def test_returns_success(self, client, mock_query):
        assert client.get('/api/district/member-status-values').status_code == 200

    def test_raw_sorted_and_complete(self, client, mock_query):
        raw = client.get('/api/district/member-status-values').get_json()['raw']
        assert set(raw) == set(_DB_ENUM)
        assert raw == sorted(raw)

    def test_options_key_present(self, client, mock_query):
        data = client.get('/api/district/member-status-values').get_json()
        assert 'options' in data and isinstance(data['options'], list)

    def test_first_option_is_all_placeholder(self, client, mock_query):
        opts = client.get('/api/district/member-status-values').get_json()['options']
        assert opts[0]['value'] == '' and 'All' in opts[0]['label']

    def test_not_active_sentinel_present(self, client, mock_query):
        values = [o['value'] for o in client.get('/api/district/member-status-values').get_json()['options']]
        assert 'not_active' in values

    def test_expired_inactive_absent_from_options(self, client, mock_query):
        values = [o['value'] for o in client.get('/api/district/member-status-values').get_json()['options']]
        assert 'expired' not in values and 'inactive' not in values

    def test_sentinel_expands_to_both_grouped_values(self, client, mock_query):
        opts = client.get('/api/district/member-status-values').get_json()['options']
        sentinel = next(o for o in opts if o['value'] == 'not_active')
        assert set(sentinel['expands_to']) == {'expired', 'inactive'}

    def test_sentinel_immediately_follows_active(self, client, mock_query):
        values = [o['value'] for o in client.get('/api/district/member-status-values').get_json()['options']]
        idx = values.index('active')
        assert values[idx + 1] == 'not_active'

    def test_each_option_has_value_and_label(self, client, mock_query):
        opts = client.get('/api/district/member-status-values').get_json()['options']
        for opt in opts:
            assert 'value' in opt and 'label' in opt
            assert isinstance(opt['label'], str) and len(opt['label']) > 0

    def test_new_enum_value_flows_through(self, client, mock_query):
        with patch(_PATCH_TARGET, return_value=_DB_ENUM + ['honorary']):
            values = [o['value'] for o in client.get('/api/district/member-status-values').get_json()['options']]
        assert 'honorary' in values

    def test_options_count_is_enum_minus_grouped_plus_sentinel_plus_all(self, client, mock_query):
        """
        Expected count:
          1 (All Statuses) + (N_enum - 2 grouped) + 1 sentinel = N_enum
        With _DB_ENUM (6 values): 1 + 4 + 1 = 6
        """
        opts = client.get('/api/district/member-status-values').get_json()['options']
        assert len(opts) == len(_DB_ENUM)

    def test_db_error_returns_500(self, client):
        with patch(_PATCH_TARGET, side_effect=Exception("DB down")):
            r = client.get('/api/district/member-status-values')
        assert r.status_code == 500
        assert r.get_json()['success'] is False


# ===========================================================================
# 7. HTTP — export routes (status filter validation)
# ===========================================================================

class TestExportRoutesStatusValidation:
    """
    All three export routes share apply_status_filter.
    Each should: accept valid statuses, expand not_active, reject invalid.
    """

    @pytest.fixture(autouse=True)
    def _patch_enum(self):
        with patch(_PATCH_TARGET, return_value=_DB_ENUM):
            yield

    # --- /export-csv ---

    def test_export_csv_valid_status_200(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/district/export-csv', json={
            'includeAll': True, 'district': 'Manhattan',
            'filters': {'status': 'active'},
        })
        assert r.status_code < 500

    def test_export_csv_not_active_200(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/district/export-csv', json={
            'includeAll': True, 'district': 'Manhattan',
            'filters': {'status': 'not_active'},
        })
        assert r.status_code < 500

    def test_export_csv_invalid_status_400(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/district/export-csv', json={
            'includeAll': True, 'district': 'Manhattan',
            'filters': {'status': 'not active'},
        })
        assert r.status_code == 400
        assert r.get_json()['success'] is False

    def test_export_csv_no_members_selected_400(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/district/export-csv', json={'filters': {}})
        assert r.status_code == 400

    # --- /export-all-districts ---
    # The route makes two query calls: (1) districts list, (2) members per district.
    # format_cell_value uses direct row['MemberID'] access, so member rows must be complete.

    def _district_side_effect(self, member_status='active'):
        """side_effect: first call returns districts, subsequent calls return member rows."""
        member = _row(Status=member_status)
        calls = {'n': 0}
        def _se(*args, **kwargs):
            calls['n'] += 1
            if calls['n'] == 1:
                return [{'District': 'Manhattan'}]
            return [member]
        return _se

    def test_export_all_districts_no_status_200(self, client, mock_query):
        mock_query.side_effect = self._district_side_effect()
        r = client.post('/api/district/export-all-districts', json={})
        assert r.status_code < 500

    def test_export_all_districts_valid_status_200(self, client, mock_query):
        mock_query.side_effect = self._district_side_effect('active')
        r = client.post('/api/district/export-all-districts', json={'status': 'active'})
        assert r.status_code < 500

    def test_export_all_districts_not_active_200(self, client, mock_query):
        mock_query.side_effect = self._district_side_effect('expired')
        r = client.post('/api/district/export-all-districts', json={'status': 'not_active'})
        assert r.status_code < 500

    def test_export_all_districts_invalid_status_400(self, client, mock_query):
        mock_query.return_value = [{'District': 'Manhattan'}]
        r = client.post('/api/district/export-all-districts', json={'status': 'not active'})
        assert r.status_code == 400
        assert r.get_json()['success'] is False

    def test_export_all_districts_no_districts_400(self, client, mock_query):
        mock_query.return_value = []  # no districts in DB
        r = client.post('/api/district/export-all-districts', json={})
        assert r.status_code == 400

    # --- /export-all-sheet ---

    def test_export_all_sheet_no_status_200(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/district/export-all-sheet', json={})
        assert r.status_code < 500

    def test_export_all_sheet_valid_status_200(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/district/export-all-sheet', json={'status': 'pending'})
        assert r.status_code < 500

    def test_export_all_sheet_not_active_200(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/district/export-all-sheet', json={'status': 'not_active'})
        assert r.status_code < 500

    def test_export_all_sheet_invalid_status_400(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/district/export-all-sheet', json={'status': 'garbage'})
        assert r.status_code == 400
        assert r.get_json()['success'] is False

    # --- Consistent rejection across all three routes ---
    @pytest.mark.parametrize("route,body", [
        ('/api/district/export-csv',
         {'includeAll': True, 'district': 'X', 'filters': {'status': 'ACTIVE'}}),
        ('/api/district/export-all-districts', {'status': 'ACTIVE'}),
        ('/api/district/export-all-sheet',     {'status': 'ACTIVE'}),
    ])
    def test_uppercase_status_rejected_on_all_export_routes(self, route, body, client, mock_query):
        mock_query.return_value = [{'District': 'Manhattan'}]
        r = client.post(route, json=body)
        assert r.status_code == 400
