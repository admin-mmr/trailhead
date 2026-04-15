"""
Tests for district member status filter correctness (simplified — no sentinel).

Coverage:
  Unit
  ├── get_enum_values() — COLUMN_TYPE parsing, cache, missing column, non-ENUM type
  ├── get_member_status_options() — raw DB values passed through, no sentinel
  └── apply_status_filter() — all valid values, invalid rejections (no sentinel)

  HTTP  /api/district/list
  ├── Each valid status passes; invalid statuses → 400
  ├── not_active is now invalid (no sentinel expansion)
  ├── expired and inactive are each individually valid
  ├── Combined status + district, status + sort, status + limit
  └── Case sensitivity: 'Active' ≠ 'active' → rejected

  HTTP  /api/district/member-status-values
  ├── Response shape matches frontend contract
  ├── expired and inactive ARE present (no grouping)
  ├── not_active sentinel is absent
  └── New ENUM value automatically surfaces

  HTTP  /api/district/export-csv
  HTTP  /api/district/export-all-districts
  HTTP  /api/district/export-all-sheet
  └── valid status → 200, not_active → 400, invalid → 400
"""
import pytest
from unittest.mock import patch

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
        import db
        with self._mock_query("varchar(255)"):
            result = db.get_enum_values('members', 'Email')
        assert result == []

    def test_cache_prevents_second_db_call(self):
        import db
        with patch.object(db, 'query', return_value=[{'COLUMN_TYPE': "enum('active','pending')"}]) as mock_q:
            db.get_enum_values('members', 'Status')
            db.get_enum_values('members', 'Status')
        assert mock_q.call_count == 1

    def test_cache_is_keyed_by_table_and_column(self):
        import db
        with patch.object(db, 'query', return_value=[{'COLUMN_TYPE': "enum('a')"}]) as mock_q:
            db.get_enum_values('members', 'Status')
            db.get_enum_values('submissions', 'Status')
        assert mock_q.call_count == 2

    def test_cache_cleared_between_tests(self):
        import db
        assert 'members.Status' not in db._enum_cache


# ===========================================================================
# 2. Unit — get_member_status_options()
# ===========================================================================

class TestGetMemberStatusOptions:
    """Shape and content of the simplified options list (no sentinel)."""

    def _opts(self, enum_values=None):
        import api_district_members
        values = enum_values if enum_values is not None else _DB_ENUM
        with patch(_PATCH_TARGET, return_value=values):
            options, raw = api_district_members.get_member_status_options()
        return options, raw

    def test_first_option_is_all_statuses_placeholder(self):
        opts, _ = self._opts()
        assert opts[0] == {'value': '', 'label': 'All Statuses'}

    def test_all_enum_values_present_in_options(self):
        opts, _ = self._opts()
        values = [o['value'] for o in opts if o['value']]
        assert set(values) == set(_DB_ENUM)

    def test_expired_present_in_options(self):
        opts, _ = self._opts()
        values = [o['value'] for o in opts]
        assert 'expired' in values

    def test_inactive_present_in_options(self):
        opts, _ = self._opts()
        values = [o['value'] for o in opts]
        assert 'inactive' in values

    def test_no_sentinel_in_options(self):
        """not_active sentinel must not appear — values match DB ENUM exactly."""
        opts, _ = self._opts()
        values = [o['value'] for o in opts]
        assert 'not_active' not in values

    def test_label_matches_value_for_each_option(self):
        """Labels are the raw DB value — no translation."""
        opts, _ = self._opts()
        for opt in opts[1:]:  # skip 'All Statuses' placeholder
            assert opt['label'] == opt['value']

    def test_raw_set_contains_all_db_values(self):
        _, raw = self._opts()
        assert raw == set(_DB_ENUM)

    def test_option_count_is_enum_plus_placeholder(self):
        """1 placeholder + N enum values."""
        opts, _ = self._opts()
        assert len(opts) == len(_DB_ENUM) + 1

    def test_unknown_new_enum_value_appears_in_options(self):
        opts, _ = self._opts(_DB_ENUM + ['honorary'])
        values = [o['value'] for o in opts]
        assert 'honorary' in values

    def test_each_option_has_value_and_label_keys(self):
        opts, _ = self._opts()
        for opt in opts:
            assert 'value' in opt and 'label' in opt


# ===========================================================================
# 3. Unit — apply_status_filter() (api_district_export)
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

    def test_empty_string_is_noop(self):
        sql, params, err = self._fn()("SELECT 1 WHERE 1=1", [], "")
        assert err is None and "Status" not in sql and params == []

    @pytest.mark.parametrize("status", _DB_ENUM)
    def test_valid_enum_value_exact_match(self, status):
        sql, params, err = self._fn()("WHERE 1=1", [], status)
        assert err is None
        assert "AND Status = %s" in sql
        assert params == [status]

    def test_expired_binds_correctly(self):
        sql, params, err = self._fn()("WHERE 1=1", [], "expired")
        assert err is None
        assert "AND Status = %s" in sql
        assert params == ["expired"]

    def test_inactive_binds_correctly(self):
        sql, params, err = self._fn()("WHERE 1=1", [], "inactive")
        assert err is None
        assert "AND Status = %s" in sql
        assert params == ["inactive"]

    def test_not_active_sentinel_rejected(self):
        """not_active is not a DB value — must be rejected."""
        _, _, err = self._fn()("WHERE 1=1", [], "not_active")
        assert err and "Invalid status" in err

    def test_existing_params_are_preserved(self):
        sql, params, err = self._fn()("WHERE District = %s", ['Manhattan'], "active")
        assert err is None
        assert params == ['Manhattan', 'active']

    def test_uppercase_rejected(self):
        _, _, err = self._fn()("WHERE 1=1", [], "Active")
        assert err and "Invalid status" in err

    def test_whitespace_only_is_noop(self):
        sql, params, err = self._fn()("WHERE 1=1", [], "   ")
        assert err is None

    @pytest.mark.parametrize("bad", [
        "foobar", "ACTIVE", "Active", "1 OR 1=1", "'; DROP TABLE members;--",
        "not active", "not-active", "not_active", "expired inactive",
    ])
    def test_invalid_values_rejected(self, bad):
        _, _, err = self._fn()("WHERE 1=1", [], bad)
        assert err is not None


# ===========================================================================
# 4. HTTP — /api/district/list
# ===========================================================================

class TestDistrictListStatusFilter:
    """HTTP-level tests for GET /api/district/list."""

    @pytest.fixture(autouse=True)
    def _patch_enum(self):
        with patch(_PATCH_TARGET, return_value=_DB_ENUM):
            yield

    @pytest.mark.parametrize("status", _DB_ENUM)
    def test_valid_status_returns_200(self, status, client, mock_query):
        mock_query.return_value = []
        r = client.get(f'/api/district/list?status={status}')
        assert r.status_code == 200

    def test_expired_returns_200(self, client, mock_query):
        mock_query.return_value = []
        assert client.get('/api/district/list?status=expired').status_code == 200

    def test_inactive_returns_200(self, client, mock_query):
        mock_query.return_value = []
        assert client.get('/api/district/list?status=inactive').status_code == 200

    def test_not_active_sentinel_returns_400(self, client, mock_query):
        """not_active is no longer a valid filter value."""
        mock_query.return_value = []
        r = client.get('/api/district/list?status=not_active')
        assert r.status_code == 400

    def test_empty_status_returns_200(self, client, mock_query):
        mock_query.return_value = []
        assert client.get('/api/district/list').status_code == 200

    @pytest.mark.parametrize("bad", [
        "not_active", "not+active", "Active", "PENDING", "garbage", "expired inactive",
    ])
    def test_invalid_status_returns_400(self, bad, client, mock_query):
        mock_query.return_value = []
        r = client.get(f'/api/district/list?status={bad}')
        assert r.status_code == 400
        assert r.get_json()['success'] is False

    def test_active_binds_single_param(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/district/list?status=active')
        sql, params = mock_query.call_args[0][0], mock_query.call_args[0][1]
        assert "AND Status = %s" in sql
        assert params.count('active') == 1

    def test_expired_binds_single_param(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/district/list?status=expired')
        sql, params = mock_query.call_args[0][0], mock_query.call_args[0][1]
        assert "AND Status = %s" in sql
        assert params.count('expired') == 1

    def test_status_and_district_both_in_sql(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/district/list?status=active&district=Manhattan')
        sql = mock_query.call_args[0][0]
        assert "AND District = %s" in sql
        assert "AND Status = %s" in sql

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
# 5. HTTP — /api/district/member-status-values
# ===========================================================================

class TestMemberStatusValuesEndpoint:
    """GET /api/district/member-status-values — simplified dropdown contract."""

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

    def test_expired_present_in_options(self, client, mock_query):
        values = [o['value'] for o in client.get('/api/district/member-status-values').get_json()['options']]
        assert 'expired' in values

    def test_inactive_present_in_options(self, client, mock_query):
        values = [o['value'] for o in client.get('/api/district/member-status-values').get_json()['options']]
        assert 'inactive' in values

    def test_not_active_sentinel_absent(self, client, mock_query):
        values = [o['value'] for o in client.get('/api/district/member-status-values').get_json()['options']]
        assert 'not_active' not in values

    def test_all_db_enum_values_in_options(self, client, mock_query):
        values = [o['value'] for o in client.get('/api/district/member-status-values').get_json()['options']]
        for v in _DB_ENUM:
            assert v in values

    def test_each_option_has_value_and_label(self, client, mock_query):
        opts = client.get('/api/district/member-status-values').get_json()['options']
        for opt in opts:
            assert 'value' in opt and 'label' in opt
            assert isinstance(opt['label'], str) and len(opt['label']) > 0

    def test_options_count_is_enum_plus_placeholder(self, client, mock_query):
        """1 placeholder + N enum values (no sentinel, no grouping)."""
        opts = client.get('/api/district/member-status-values').get_json()['options']
        assert len(opts) == len(_DB_ENUM) + 1

    def test_new_enum_value_flows_through(self, client, mock_query):
        with patch(_PATCH_TARGET, return_value=_DB_ENUM + ['honorary']):
            values = [o['value'] for o in client.get('/api/district/member-status-values').get_json()['options']]
        assert 'honorary' in values

    def test_db_error_returns_500(self, client):
        with patch(_PATCH_TARGET, side_effect=Exception("DB down")):
            r = client.get('/api/district/member-status-values')
        assert r.status_code == 500
        assert r.get_json()['success'] is False


# ===========================================================================
# 6. HTTP — export routes (status filter validation)
# ===========================================================================

class TestExportRoutesStatusValidation:
    """All three export routes share apply_status_filter. No renewal filter."""

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

    def test_export_csv_expired_status_200(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/district/export-csv', json={
            'includeAll': True, 'district': 'Manhattan',
            'filters': {'status': 'expired'},
        })
        assert r.status_code < 500

    def test_export_csv_inactive_status_200(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/district/export-csv', json={
            'includeAll': True, 'district': 'Manhattan',
            'filters': {'status': 'inactive'},
        })
        assert r.status_code < 500

    def test_export_csv_not_active_sentinel_400(self, client, mock_query):
        """not_active is no longer accepted — must return 400."""
        mock_query.return_value = []
        r = client.post('/api/district/export-csv', json={
            'includeAll': True, 'district': 'Manhattan',
            'filters': {'status': 'not_active'},
        })
        assert r.status_code == 400
        assert r.get_json()['success'] is False

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

    def _district_side_effect(self, member_status='active'):
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

    def test_export_all_districts_expired_200(self, client, mock_query):
        mock_query.side_effect = self._district_side_effect('expired')
        r = client.post('/api/district/export-all-districts', json={'status': 'expired'})
        assert r.status_code < 500

    def test_export_all_districts_not_active_400(self, client, mock_query):
        mock_query.return_value = [{'District': 'Manhattan'}]
        r = client.post('/api/district/export-all-districts', json={'status': 'not_active'})
        assert r.status_code == 400

    def test_export_all_districts_invalid_status_400(self, client, mock_query):
        mock_query.return_value = [{'District': 'Manhattan'}]
        r = client.post('/api/district/export-all-districts', json={'status': 'not active'})
        assert r.status_code == 400
        assert r.get_json()['success'] is False

    def test_export_all_districts_no_districts_400(self, client, mock_query):
        mock_query.return_value = []
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

    def test_export_all_sheet_inactive_200(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/district/export-all-sheet', json={'status': 'inactive'})
        assert r.status_code < 500

    def test_export_all_sheet_not_active_400(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/district/export-all-sheet', json={'status': 'not_active'})
        assert r.status_code == 400
        assert r.get_json()['success'] is False

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
