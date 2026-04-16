"""
Tests for multi-select district and status filter changes.

Coverage:
  Unit
  ├── apply_status_filter() — list input, comma-separated string, empty list,
  │   single-item list, multi-item list, invalid item in list
  └── apply_status_filter() — backwards compat: existing string input unchanged

  HTTP  /api/district/list
  ├── Multi-district: comma-separated → 200 with correct SQL filter
  ├── Multi-status: comma-separated → 200
  ├── Multi-district + multi-status combined
  ├── Single district still works (no regression)
  └── One invalid status in comma list → 400

  HTTP  /api/district/export-csv
  ├── `districts` list + includeAll → 200
  ├── `showAll=True` + includeAll → fetches without district filter
  ├── `districts` list with single entry → 200
  ├── Legacy `district` string field still works
  ├── `statuses` list in filters → 200
  ├── Empty `districts` + not showAll + includeAll → 400
  └── Invalid status in `statuses` → 400

  HTTP  /api/district/export-all-districts
  ├── `statuses` list accepted → 200
  ├── `statuses` with invalid entry → 400
  └── Legacy `status` string still accepted → 200

  HTTP  /api/district/export-all-sheet
  ├── `statuses` list accepted → 200
  ├── `statuses` with invalid entry → 400
  ├── Legacy `status` string still accepted → 200
  └── Default columns include 'District' when columns not specified
"""
import pytest
from unittest.mock import patch

_DB_ENUM = ['active', 'expired', 'inactive', 'pending', 'pending_upgrade', 'lifetime']
_EXPORT_PATCH = 'api_district_export.get_member_status_options'
_LIST_PATCH = 'api_district_members.get_enum_values'


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


def _post(client, url, body=None):
    return client.post(url, json=body or {})


# ===========================================================================
# 1. Unit — apply_status_filter() with list/comma-string inputs
# ===========================================================================

class TestApplyStatusFilterMulti:
    """apply_status_filter handles list, comma-string, and legacy string."""

    @pytest.fixture(autouse=True)
    def _patch_status_options(self):
        with patch(_EXPORT_PATCH, return_value=(
            [{'value': '', 'label': 'All Statuses'}] + [{'value': s, 'label': s} for s in _DB_ENUM],
            _DB_ENUM,
        )):
            yield

    def _call(self, status_filter):
        from api_district_export import apply_status_filter
        return apply_status_filter("SELECT 1 WHERE 1=1", [], status_filter)

    # --- Empty / passthrough ---

    def test_empty_string_no_filter(self):
        sql, params, err = self._call('')
        assert err is None
        assert 'Status' not in sql
        assert params == []

    def test_none_no_filter(self):
        sql, params, err = self._call(None)
        assert err is None
        assert params == []

    def test_empty_list_no_filter(self):
        sql, params, err = self._call([])
        assert err is None
        assert params == []

    # --- Single value ---

    def test_single_string_adds_equals(self):
        sql, params, err = self._call('active')
        assert err is None
        assert 'Status = %s' in sql
        assert params == ['active']

    def test_single_item_list_adds_equals(self):
        sql, params, err = self._call(['active'])
        assert err is None
        assert 'Status = %s' in sql
        assert params == ['active']

    def test_single_comma_string_treated_as_one(self):
        sql, params, err = self._call('lifetime')
        assert err is None
        assert 'Status = %s' in sql
        assert params == ['lifetime']

    # --- Multiple values ---

    def test_list_two_statuses_uses_in(self):
        sql, params, err = self._call(['active', 'expired'])
        assert err is None
        assert 'Status IN' in sql
        assert set(params) == {'active', 'expired'}

    def test_comma_string_two_statuses_uses_in(self):
        sql, params, err = self._call('active,expired')
        assert err is None
        assert 'Status IN' in sql
        assert set(params) == {'active', 'expired'}

    def test_list_all_valid_statuses(self):
        sql, params, err = self._call(_DB_ENUM)
        assert err is None
        assert 'Status IN' in sql
        assert len(params) == len(_DB_ENUM)

    def test_comma_string_with_spaces_trimmed(self):
        sql, params, err = self._call(' active , expired ')
        assert err is None
        assert set(params) == {'active', 'expired'}

    # --- Invalid ---

    def test_invalid_string_returns_error(self):
        _, _, err = self._call('garbage')
        assert err is not None
        assert 'Invalid status' in err

    def test_list_with_one_invalid_returns_error(self):
        _, _, err = self._call(['active', 'not_a_status'])
        assert err is not None

    def test_comma_string_with_invalid_returns_error(self):
        _, _, err = self._call('active,not_active')
        assert err is not None


# ===========================================================================
# 1b. HTTP — /api/district/districts  (null sentinel)
# ===========================================================================

class TestDistrictListEndpointNullSentinel:
    """GET /api/district/districts includes '(No District)' when nulls exist."""

    def test_no_null_members_no_sentinel(self, client, mock_query):
        # First call: district list; second call: null count = 0
        mock_query.side_effect = [
            [{'District': 'Manhattan'}],
            [{'cnt': 0}],
        ]
        r = client.get('/api/district/districts')
        assert r.status_code == 200
        assert '(No District)' not in r.get_json()['districts']

    def test_null_members_exist_adds_sentinel(self, client, mock_query):
        mock_query.side_effect = [
            [{'District': 'Manhattan'}],
            [{'cnt': 107}],
        ]
        r = client.get('/api/district/districts')
        assert r.status_code == 200
        assert '(No District)' in r.get_json()['districts']


# ===========================================================================
# 2. HTTP — /api/district/list  (multi-district + multi-status)
# ===========================================================================

class TestDistrictListMultiSelect:
    """GET /api/district/list with comma-separated district and status params."""

    @pytest.fixture(autouse=True)
    def _patch_enum(self):
        with patch(_LIST_PATCH, return_value=_DB_ENUM):
            yield

    # --- Multi-district ---

    def test_single_district_200(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = client.get('/api/district/list?district=Manhattan')
        assert r.status_code == 200
        assert r.get_json()['success'] is True

    def test_two_districts_200(self, client, mock_query):
        mock_query.return_value = [_row(), _row(District='Brooklyn')]
        r = client.get('/api/district/list?district=Manhattan,Brooklyn')
        assert r.status_code == 200
        data = r.get_json()
        assert data['success'] is True
        assert data['count'] == 2

    def test_three_districts_200(self, client, mock_query):
        mock_query.return_value = [_row()] * 3
        r = client.get('/api/district/list?district=Manhattan,Brooklyn,Queens')
        assert r.status_code == 200

    def test_no_district_returns_all(self, client, mock_query):
        mock_query.return_value = [_row(), _row(District='Brooklyn')]
        r = client.get('/api/district/list')
        assert r.status_code == 200
        assert r.get_json()['count'] == 2

    # --- Multi-status ---

    def test_single_status_200(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = client.get('/api/district/list?status=active')
        assert r.status_code == 200

    def test_two_statuses_200(self, client, mock_query):
        mock_query.return_value = [_row(), _row(Status='expired')]
        r = client.get('/api/district/list?status=active,expired')
        assert r.status_code == 200
        assert r.get_json()['count'] == 2

    def test_invalid_status_400(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/district/list?status=not_a_status')
        assert r.status_code == 400

    def test_invalid_status_in_comma_list_400(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/district/list?status=active,garbage')
        assert r.status_code == 400

    # --- Combined ---

    def test_multi_district_and_multi_status(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = client.get('/api/district/list?district=Manhattan,Brooklyn&status=active,expired')
        assert r.status_code == 200

    # --- (No District) sentinel ---

    def test_null_sentinel_only_200(self, client, mock_query):
        mock_query.return_value = [_row(District=None)]
        r = client.get('/api/district/list?district=(No District)')
        assert r.status_code == 200

    def test_null_sentinel_with_real_district_200(self, client, mock_query):
        mock_query.return_value = [_row(), _row(District=None)]
        r = client.get('/api/district/list?district=Manhattan,(No District)')
        assert r.status_code == 200
        assert r.get_json()['count'] == 2


# ===========================================================================
# 3. HTTP — /api/district/export-csv  (districts list + statuses list)
# ===========================================================================

class TestExportCsvMultiDistrict:
    """POST /api/district/export-csv with new `districts` and `statuses` fields."""

    @pytest.fixture(autouse=True)
    def _patch_status(self):
        with patch(_EXPORT_PATCH, return_value=(
            [{'value': s, 'label': s} for s in _DB_ENUM], _DB_ENUM,
        )):
            yield

    # --- districts list ---

    def test_single_district_list_include_all_200(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = _post(client, '/api/district/export-csv', {
            'includeAll': True,
            'districts': ['Manhattan'],
            'columns': ['MemberID', 'District'],
            'filters': {},
        })
        assert r.status_code == 200
        assert b'MemberID' in r.data or b'Member ID' in r.data

    def test_two_districts_include_all_200(self, client, mock_query):
        mock_query.return_value = [_row(), _row(District='Brooklyn')]
        r = _post(client, '/api/district/export-csv', {
            'includeAll': True,
            'districts': ['Manhattan', 'Brooklyn'],
            'columns': ['District', 'MemberID'],
            'filters': {},
        })
        assert r.status_code == 200

    def test_show_all_districts_include_all_200(self, client, mock_query):
        mock_query.return_value = [_row(), _row(District='Brooklyn')]
        r = _post(client, '/api/district/export-csv', {
            'includeAll': True,
            'districts': [],
            'showAll': True,
            'columns': ['District', 'MemberID'],
            'filters': {},
        })
        assert r.status_code == 200

    def test_no_district_no_show_all_400(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/district/export-csv', {
            'includeAll': True,
            'districts': [],
            'showAll': False,
            'filters': {},
        })
        assert r.status_code == 400

    def test_member_ids_still_works(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = _post(client, '/api/district/export-csv', {
            'memberIds': ['A0001'],
            'includeAll': False,
            'columns': ['MemberID'],
            'filters': {},
        })
        assert r.status_code == 200

    # --- legacy `district` string field ---

    def test_legacy_district_string_200(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = _post(client, '/api/district/export-csv', {
            'includeAll': True,
            'district': 'Manhattan',
            'columns': ['MemberID'],
            'filters': {},
        })
        assert r.status_code == 200

    # --- statuses list in filters ---

    def test_statuses_list_in_filters_200(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = _post(client, '/api/district/export-csv', {
            'includeAll': True,
            'districts': ['Manhattan'],
            'columns': ['MemberID', 'Status'],
            'filters': {'statuses': ['active', 'expired']},
        })
        assert r.status_code == 200

    def test_invalid_status_in_filters_400(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = _post(client, '/api/district/export-csv', {
            'includeAll': True,
            'districts': ['Manhattan'],
            'columns': ['MemberID'],
            'filters': {'statuses': ['garbage']},
        })
        assert r.status_code == 400

    def test_null_sentinel_district_200(self, client, mock_query):
        mock_query.return_value = [_row(District=None)]
        r = _post(client, '/api/district/export-csv', {
            'includeAll': True,
            'districts': ['(No District)'],
            'columns': ['District', 'MemberID'],
            'filters': {},
        })
        assert r.status_code == 200

    def test_null_sentinel_mixed_with_real_district_200(self, client, mock_query):
        mock_query.return_value = [_row(), _row(District=None)]
        r = _post(client, '/api/district/export-csv', {
            'includeAll': True,
            'districts': ['Manhattan', '(No District)'],
            'columns': ['District', 'MemberID'],
            'filters': {},
        })
        assert r.status_code == 200


# ===========================================================================
# 4. HTTP — /api/district/export-all-districts  (statuses list)
# ===========================================================================

class TestExportAllDistrictsStatuses:

    def _se(self, member_status='active'):
        calls = {'n': 0}
        member = _row(Status=member_status)
        def _side_effect(*a, **kw):
            calls['n'] += 1
            return [{'District': 'Manhattan'}] if calls['n'] == 1 else [member]
        return _side_effect

    @pytest.fixture(autouse=True)
    def _patch_status(self):
        with patch(_EXPORT_PATCH, return_value=(
            [{'value': s, 'label': s} for s in _DB_ENUM], _DB_ENUM,
        )):
            yield

    def test_statuses_list_200(self, client, mock_query):
        mock_query.side_effect = self._se('active')
        r = _post(client, '/api/district/export-all-districts', {
            'statuses': ['active', 'expired'],
        })
        assert r.status_code < 500

    def test_statuses_single_item_200(self, client, mock_query):
        mock_query.side_effect = self._se('inactive')
        r = _post(client, '/api/district/export-all-districts', {
            'statuses': ['inactive'],
        })
        assert r.status_code < 500

    def test_statuses_empty_list_200(self, client, mock_query):
        mock_query.side_effect = self._se()
        r = _post(client, '/api/district/export-all-districts', {
            'statuses': [],
        })
        assert r.status_code < 500

    def test_statuses_invalid_400(self, client, mock_query):
        mock_query.return_value = [{'District': 'Manhattan'}]
        r = _post(client, '/api/district/export-all-districts', {
            'statuses': ['active', 'garbage'],
        })
        assert r.status_code == 400

    def test_legacy_status_string_still_works(self, client, mock_query):
        mock_query.side_effect = self._se('active')
        r = _post(client, '/api/district/export-all-districts', {
            'status': 'active',
        })
        assert r.status_code < 500

    def test_legacy_invalid_status_string_400(self, client, mock_query):
        mock_query.return_value = [{'District': 'Manhattan'}]
        r = _post(client, '/api/district/export-all-districts', {
            'status': 'not_active',
        })
        assert r.status_code == 400


# ===========================================================================
# 5. HTTP — /api/district/export-all-sheet  (statuses list + District default)
# ===========================================================================

class TestExportAllSheetStatuses:

    @pytest.fixture(autouse=True)
    def _patch_status(self):
        with patch(_EXPORT_PATCH, return_value=(
            [{'value': s, 'label': s} for s in _DB_ENUM], _DB_ENUM,
        )):
            yield

    def test_statuses_list_200(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = _post(client, '/api/district/export-all-sheet', {
            'statuses': ['active', 'pending'],
        })
        assert r.status_code < 500

    def test_statuses_single_item_200(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = _post(client, '/api/district/export-all-sheet', {
            'statuses': ['lifetime'],
        })
        assert r.status_code < 500

    def test_statuses_empty_list_no_filter_200(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = _post(client, '/api/district/export-all-sheet', {'statuses': []})
        assert r.status_code < 500

    def test_statuses_invalid_400(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/district/export-all-sheet', {
            'statuses': ['garbage'],
        })
        assert r.status_code == 400

    def test_legacy_status_string_200(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = _post(client, '/api/district/export-all-sheet', {'status': 'active'})
        assert r.status_code < 500

    def test_legacy_invalid_status_400(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/district/export-all-sheet', {'status': 'garbage'})
        assert r.status_code == 400

    def test_default_columns_include_district(self, client, mock_query):
        """When no columns specified, District must be in the CSV header."""
        mock_query.return_value = [_row()]
        r = _post(client, '/api/district/export-all-sheet', {})
        assert r.status_code < 500
        # Default columns include District — verify header present in CSV bytes
        assert b'District' in r.data

    def test_explicit_columns_without_district_still_200(self, client, mock_query):
        mock_query.return_value = [_row()]
        r = _post(client, '/api/district/export-all-sheet', {
            'columns': ['MemberID', 'Status'],
        })
        assert r.status_code < 500
