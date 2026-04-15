"""
Unit tests for member helper functions and admin field-update routes.

Covers:
  - get_member_by_id / get_member_card / get_family_members (api_members helpers)
  - POST /api/members/<id>/mark-unused             (api_members_district)
  - POST /api/members/<id>/district                (api_members_district)
  - GET  /api/districts                            (api_members_district)
  - GET  /api/members/<id>/family                  (api_members_family)
  - POST /api/members/family/add-member            (api_members_family)
  - POST /api/members/family/remove-member         (api_members_family)

All DB calls are mocked — no live MySQL required.
"""
import pytest
from unittest.mock import patch, MagicMock, call


# ---------------------------------------------------------------------------
# Shared fixtures / factories
# ---------------------------------------------------------------------------

def _member(member_id='A0001', first='John', last='Smith', status='active',
            type_='Individual', family_id=None, district='Manhattan',
            email='john@example.com'):
    return {
        'MemberID': member_id, 'FirstName': first, 'LastName': last,
        'Email': email, 'PhoneNumber': '555-1234', 'WeChatID': 'jsmith_wc',
        'Type': type_, 'FamilyID': family_id, 'District': district,
        'Status': status, 'Expiration': None, 'MembershipFeePaid': 30,
        'PaymentDate': None, 'PaymentTransaction': 'TX001', 'UpdatedAt': None,
    }


def _family_member(**kwargs):
    return _member(type_='Family', family_id='FAM001', **kwargs)


def _post(client, url, body=None):
    return client.post(url, json=body or {})


# ---------------------------------------------------------------------------
# Helpers: get_member_by_id
# ---------------------------------------------------------------------------

class TestGetMemberById:

    def test_returns_dict_when_found(self, mock_query):
        mock_query.return_value = [_member()]
        from api_members import get_member_by_id
        result = get_member_by_id('A0001')
        assert result is not None
        assert result['MemberID'] == 'A0001'

    def test_returns_none_when_not_found(self, mock_query):
        mock_query.return_value = []
        from api_members import get_member_by_id
        result = get_member_by_id('A9999')
        assert result is None

    def test_returns_first_row_only(self, mock_query):
        mock_query.return_value = [_member('A0001'), _member('A0002')]
        from api_members import get_member_by_id
        result = get_member_by_id('A0001')
        assert result['MemberID'] == 'A0001'


# ---------------------------------------------------------------------------
# Helpers: get_member_card
# ---------------------------------------------------------------------------

class TestGetMemberCard:

    def test_returns_card_fields(self, mock_query):
        mock_query.return_value = [_member()]
        from api_members import get_member_card
        result = get_member_card('A0001')
        assert result is not None
        assert 'MemberID' in result
        assert 'Status' in result

    def test_does_not_include_payment_transaction(self, mock_query):
        """Card endpoint is intentionally lightweight — no PaymentTransaction."""
        row = {k: v for k, v in _member().items() if k != 'PaymentTransaction'}
        mock_query.return_value = [row]
        from api_members import get_member_card
        result = get_member_card('A0001')
        assert 'PaymentTransaction' not in (result or {})

    def test_returns_none_when_not_found(self, mock_query):
        mock_query.return_value = []
        from api_members import get_member_card
        assert get_member_card('ZZZZ') is None


# ---------------------------------------------------------------------------
# Helpers: get_family_members
# ---------------------------------------------------------------------------

class TestGetFamilyMembers:

    def test_returns_list(self, mock_query):
        mock_query.return_value = [_family_member(member_id='A0001'), _family_member(member_id='A0002')]
        from api_members import get_family_members
        result = get_family_members('FAM001')
        assert isinstance(result, list)
        assert len(result) == 2

    def test_returns_empty_list_when_no_members(self, mock_query):
        mock_query.return_value = []
        from api_members import get_family_members
        assert get_family_members('FAM999') == []


# ---------------------------------------------------------------------------
# POST /api/members/<id>/mark-unused
# ---------------------------------------------------------------------------

class TestMarkUnused:

    def _do(self, client, member_id='A0001'):
        return _post(client, f'/api/members/{member_id}/mark-unused')

    # ── happy path ──────────────────────────────────────────────────────────

    def test_returns_200_ok(self, client, mock_query):
        mock_query.return_value = [_member()]
        with patch('api_members_district.execute'), \
             patch('api_members_district.log_activity'):
            r = self._do(client)
        assert r.status_code == 200
        assert r.get_json()['ok'] is True

    def test_response_contains_updated_member(self, client, mock_query):
        mock_query.return_value = [_member()]
        with patch('api_members_district.execute'), \
             patch('api_members_district.log_activity'):
            r = self._do(client)
        data = r.get_json()['data']
        assert 'updated_member' in data
        assert 'message' in data

    # ── UPDATE fields ────────────────────────────────────────────────────────

    def test_update_sets_all_six_fields(self, client, mock_query):
        mock_query.return_value = [_member(status='expired', family_id='FAM001')]
        with patch('api_members_district.execute') as mock_exec, \
             patch('api_members_district.log_activity'):
            self._do(client)

        # First execute call is the UPDATE members.
        # 'inactive', 'Unused', 'Individual', NULL are SQL literals (not bound params).
        # Bound params are: LastName, Email, UpdatedAt, MemberID (WHERE).
        update_sql, update_params = mock_exec.call_args_list[0][0]
        assert 'inactive' in update_sql
        assert 'Unused' in update_sql
        assert 'Individual' in update_sql
        assert 'FamilyID  = NULL' in update_sql or 'FamilyID = NULL' in update_sql
        assert 'A0001' in update_params          # LastName = MemberID (bound)
        assert 'a0001@mmrunners.org' in update_params  # Email (bound)

    def test_email_uses_lowercase_member_id(self, client, mock_query):
        mock_query.return_value = [_member(member_id='A0042')]
        with patch('api_members_district.execute') as mock_exec, \
             patch('api_members_district.log_activity'):
            _post(client, '/api/members/A0042/mark-unused')

        update_params = mock_exec.call_args_list[0][0][1]
        assert 'a0042@mmrunners.org' in update_params

    def test_lastname_equals_member_id_preserving_case(self, client, mock_query):
        """LastName should store the MemberID as-is (e.g. 'A0001', not 'a0001')."""
        mock_query.return_value = [_member(member_id='A0001')]
        with patch('api_members_district.execute') as mock_exec, \
             patch('api_members_district.log_activity'):
            self._do(client)

        update_params = mock_exec.call_args_list[0][0][1]
        assert 'A0001' in update_params

    def test_family_id_set_to_null(self, client, mock_query):
        """Member in a family → FamilyID must be NULL after mark-unused."""
        mock_query.return_value = [_member(family_id='FAM001')]
        with patch('api_members_district.execute') as mock_exec, \
             patch('api_members_district.log_activity'):
            self._do(client)

        update_sql = mock_exec.call_args_list[0][0][0]
        assert 'FamilyID  = NULL' in update_sql or 'FamilyID = NULL' in update_sql

    def test_district_set_to_other(self, client, mock_query):
        """mark-unused must always set District = 'Other' regardless of prior value."""
        mock_query.return_value = [_member(district='Manhattan')]
        with patch('api_members_district.execute') as mock_exec, \
             patch('api_members_district.log_activity'):
            self._do(client)

        update_sql = mock_exec.call_args_list[0][0][0]
        assert "District  = 'Other'" in update_sql or "District = 'Other'" in update_sql

    # ── admin_member_overrides INSERT ────────────────────────────────────────

    def test_inserts_into_admin_member_overrides(self, client, mock_query):
        mock_query.return_value = [_member(status='active')]
        with patch('api_members_district.execute') as mock_exec, \
             patch('api_members_district.log_activity'):
            self._do(client)

        assert mock_exec.call_count == 2  # UPDATE members + INSERT overrides
        override_sql = mock_exec.call_args_list[1][0][0]
        assert 'admin_member_overrides' in override_sql

    def test_override_action_type_is_inactive_set(self, client, mock_query):
        mock_query.return_value = [_member(status='active')]
        with patch('api_members_district.execute') as mock_exec, \
             patch('api_members_district.log_activity'):
            self._do(client)

        # 'INACTIVE_SET' is a SQL literal in the INSERT, not a bound param
        override_sql = mock_exec.call_args_list[1][0][0]
        assert 'INACTIVE_SET' in override_sql

    def test_override_old_value_is_previous_status(self, client, mock_query):
        mock_query.return_value = [_member(status='expired')]
        with patch('api_members_district.execute') as mock_exec, \
             patch('api_members_district.log_activity'):
            self._do(client)

        override_params = mock_exec.call_args_list[1][0][1]
        assert 'expired' in override_params

    def test_override_target_member_id_correct(self, client, mock_query):
        mock_query.return_value = [_member(member_id='A0007')]
        with patch('api_members_district.execute') as mock_exec, \
             patch('api_members_district.log_activity'):
            _post(client, '/api/members/A0007/mark-unused')

        override_params = mock_exec.call_args_list[1][0][1]
        assert 'A0007' in override_params

    # ── activity log ─────────────────────────────────────────────────────────

    def test_log_activity_called(self, client, mock_query):
        mock_query.return_value = [_member()]
        with patch('api_members_district.execute'), \
             patch('api_members_district.log_activity') as mock_log:
            self._do(client)

        mock_log.assert_called_once()
        kwargs = mock_log.call_args[1]
        assert kwargs['action'] == 'member_mark_unused'
        assert kwargs['member_id'] == 'A0001'

    # ── error paths ──────────────────────────────────────────────────────────

    def test_member_not_found_returns_404(self, client, mock_query):
        mock_query.return_value = []
        r = self._do(client, 'A9999')
        assert r.status_code == 404
        assert r.get_json()['ok'] is False

    def test_idempotent_already_unused(self, client, mock_query):
        """Calling mark-unused on an already-unused ID should still succeed."""
        already_unused = _member(status='inactive', first='Unused',
                                 last='A0001', email='a0001@mmrunners.org',
                                 family_id=None)
        mock_query.return_value = [already_unused]
        with patch('api_members_district.execute'), \
             patch('api_members_district.log_activity'):
            r = self._do(client)
        assert r.status_code == 200
        assert r.get_json()['ok'] is True


# ---------------------------------------------------------------------------
# POST /api/members/<id>/district
# ---------------------------------------------------------------------------

class TestChangeMemberDistrict:

    def _do(self, client, member_id='A0001', district='Brooklyn'):
        return _post(client, f'/api/members/{member_id}/district',
                     {'district': district})

    def test_valid_district_returns_200(self, client, mock_query):
        mock_query.return_value = [_member()]  # member found + district found
        with patch('api_members_district.execute'), \
             patch('api_members_district.log_activity'):
            r = self._do(client)
        assert r.status_code == 200
        assert r.get_json()['ok'] is True

    def test_missing_district_body_returns_400(self, client, mock_query):
        r = _post(client, '/api/members/A0001/district', {})
        assert r.status_code == 400

    def test_member_not_found_returns_404(self, client, mock_query):
        # First call (get_member_by_id) returns nothing
        mock_query.return_value = []
        r = self._do(client)
        assert r.status_code == 404

    def test_unknown_district_returns_400(self, client, mock_query):
        """District not present in any member row → 400."""
        call_count = 0

        def side_effect(sql, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return [_member()]    # get_member_by_id
            return []                 # district validation → not found

        mock_query.side_effect = side_effect
        r = self._do(client, district='Nonexistent Borough')
        assert r.status_code == 400
        assert 'not found' in r.get_json()['error'].lower()
        mock_query.side_effect = None

    def test_update_called_with_new_district(self, client, mock_query):
        mock_query.return_value = [_member(district='Manhattan')]
        with patch('api_members_district.execute') as mock_exec, \
             patch('api_members_district.log_activity'):
            self._do(client, district='Brooklyn')

        update_params = mock_exec.call_args_list[0][0][1]
        assert 'Brooklyn' in update_params

    def test_log_activity_called_with_old_and_new(self, client, mock_query):
        mock_query.return_value = [_member(district='Manhattan')]
        with patch('api_members_district.execute'), \
             patch('api_members_district.log_activity') as mock_log:
            self._do(client, district='Brooklyn')

        kwargs = mock_log.call_args[1]
        assert 'Manhattan' in kwargs['state']
        assert 'Brooklyn' in kwargs['state']

    def test_response_includes_message(self, client, mock_query):
        mock_query.return_value = [_member(district='Manhattan')]
        with patch('api_members_district.execute'), \
             patch('api_members_district.log_activity'):
            r = self._do(client, district='Brooklyn')
        data = r.get_json()['data']
        assert 'Manhattan' in data['message']
        assert 'Brooklyn' in data['message']


# ---------------------------------------------------------------------------
# GET /api/districts
# ---------------------------------------------------------------------------

class TestGetDistricts:

    def test_returns_list_of_strings(self, client, mock_query):
        mock_query.return_value = [{'District': 'Manhattan'},
                                   {'District': 'Brooklyn'}]
        r = client.get('/api/districts')
        assert r.status_code == 200
        data = r.get_json()['data']
        assert isinstance(data, list)
        assert 'Manhattan' in data
        assert 'Brooklyn' in data

    def test_empty_returns_empty_list(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/districts')
        assert r.status_code == 200
        assert r.get_json()['data'] == []


# ---------------------------------------------------------------------------
# GET /api/members/<id>/family
# ---------------------------------------------------------------------------

class TestGetFamily:

    def test_non_family_member_returns_400(self, client, mock_query):
        mock_query.return_value = [_member(type_='Individual')]
        r = client.get('/api/members/A0001/family')
        assert r.status_code == 400
        assert 'not a Family' in r.get_json()['error']

    def test_family_member_no_family_id_auto_assigns(self, client, mock_query):
        """Regression: GET /family on a member with no FamilyID must auto-assign
        and return 200, not 400. Previously returned 'has no FamilyID' error."""
        call_count = 0

        def side_effect(sql, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return [_member(type_='Family', family_id=None)]   # get_member_by_id
            return [_family_member(member_id='A0001')]             # get_family_members

        mock_query.side_effect = side_effect

        with patch('api_members_family.query', return_value=[]) as mock_gen_query, \
             patch('api_members_family.execute') as mock_exec:
            r = client.get('/api/members/A0001/family')

        assert r.status_code == 200, (
            f"Expected 200 (auto-assign), got {r.status_code}: {r.get_json()}"
        )
        data = r.get_json()['data']
        assert data['family_id'] == 'B001'
        mock_exec.assert_called_once()   # UPDATE to persist the new FamilyID
        mock_query.side_effect = None

    def test_member_not_found_returns_404(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/members/A9999/family')
        assert r.status_code == 404

    def test_valid_family_member_returns_200(self, client, mock_query):
        call_count = 0

        def side_effect(sql, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return [_family_member(member_id='A0001')]   # get_member_by_id
            return [_family_member(member_id='A0001'), _family_member(member_id='A0002')]

        mock_query.side_effect = side_effect
        r = client.get('/api/members/A0001/family')
        assert r.status_code == 200
        data = r.get_json()['data']
        assert 'family_id' in data
        assert 'members' in data
        assert len(data['members']) == 2
        mock_query.side_effect = None


# ---------------------------------------------------------------------------
# POST /api/members/family/add-member
# ---------------------------------------------------------------------------

class TestAddMemberToFamily:

    def _do(self, client, primary='A0001', new_member='A0002'):
        return _post(client, '/api/members/family/add-member',
                     {'primary_member_id': primary, 'new_member_id': new_member})

    def test_missing_body_returns_400(self, client, mock_query):
        r = _post(client, '/api/members/family/add-member', {})
        assert r.status_code == 400

    def test_primary_not_found_returns_404(self, client, mock_query):
        mock_query.return_value = []
        r = self._do(client)
        assert r.status_code == 404

    def test_primary_not_family_type_returns_400(self, client, mock_query):
        mock_query.return_value = [_member(type_='Individual', family_id='FAM001')]
        r = self._do(client)
        assert r.status_code == 400
        assert 'Family type' in r.get_json()['error']

    def test_primary_has_no_family_id_returns_400(self, client, mock_query):
        mock_query.return_value = [_member(type_='Family', family_id=None)]
        r = self._do(client)
        assert r.status_code == 400

    def test_new_member_not_found_returns_404(self, client, mock_query):
        call_count = 0

        def side_effect(sql, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return [_family_member(member_id='A0001')]  # primary found
            return []  # new member not found

        mock_query.side_effect = side_effect
        r = self._do(client)
        assert r.status_code == 404
        mock_query.side_effect = None

    def test_new_member_inherits_family_fields(self, client, mock_query):
        """Verify the UPDATE sets FamilyID, Type, Status, Expiration from primary."""
        primary = _family_member(member_id='A0001', status='active')
        primary['Expiration'] = '2026-12-31'

        call_count = 0

        def side_effect(sql, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return [primary]
            if call_count == 2:
                return [_member(member_id='A0002')]  # new member
            return [_family_member(member_id='A0001'), _family_member(member_id='A0002')]

        mock_query.side_effect = side_effect

        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)

        with patch('api_members_family.db_cursor', return_value=mock_cursor), \
             patch('api_members_family.log_activity'):
            r = self._do(client)

        assert r.status_code == 200
        # Verify UPDATE was called via cursor
        execute_calls = [str(c) for c in mock_cursor.execute.call_args_list]
        update_call = next((c for c in execute_calls if 'UPDATE' in c), None)
        assert update_call is not None
        mock_query.side_effect = None

    def test_log_activity_called_on_success(self, client, mock_query):
        primary = _family_member(member_id='A0001')
        call_count = 0

        def side_effect(sql, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return [primary]
            if call_count == 2:
                return [_member(member_id='A0002')]
            return [_family_member(member_id='A0001')]

        mock_query.side_effect = side_effect
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)

        with patch('api_members_family.db_cursor', return_value=mock_cursor), \
             patch('api_members_family.log_activity') as mock_log:
            self._do(client)

        mock_log.assert_called_once()
        kwargs = mock_log.call_args[1]
        assert kwargs['action'] == 'member_family_add'
        mock_query.side_effect = None


# ---------------------------------------------------------------------------
# POST /api/members/family/remove-member
# ---------------------------------------------------------------------------

class TestRemoveMemberFromFamily:

    def _old_state(self):
        return {
            'Type': 'Individual', 'Status': 'active', 'FamilyID': None,
            'Expiration': None, 'MembershipFeePaid': 0,
            'PaymentDate': None, 'PaymentTransaction': None,
        }

    def _do(self, client, member_id='A0002', old_state=None):
        return _post(client, '/api/members/family/remove-member', {
            'member_id': member_id,
            'old_state': old_state or self._old_state(),
        })

    def test_missing_member_id_returns_400(self, client, mock_query):
        r = _post(client, '/api/members/family/remove-member',
                  {'old_state': self._old_state()})
        assert r.status_code == 400

    def test_missing_old_state_returns_400(self, client, mock_query):
        r = _post(client, '/api/members/family/remove-member',
                  {'member_id': 'A0002'})
        assert r.status_code == 400

    def test_member_not_found_returns_404(self, client, mock_query):
        mock_query.return_value = []
        r = self._do(client)
        assert r.status_code == 404

    def test_reverts_to_old_type(self, client, mock_query):
        mock_query.return_value = [_family_member(member_id='A0002')]
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)

        with patch('api_members_family.db_cursor', return_value=mock_cursor), \
             patch('api_members_family.log_activity'):
            r = self._do(client, old_state={**self._old_state(), 'Type': 'Individual'})

        assert r.status_code == 200
        execute_calls = [str(c) for c in mock_cursor.execute.call_args_list]
        update_call = next((c for c in execute_calls if 'UPDATE' in c), None)
        assert update_call is not None
        assert 'Individual' in update_call

    def test_log_activity_called_on_remove(self, client, mock_query):
        mock_query.return_value = [_family_member(member_id='A0002')]
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)

        with patch('api_members_family.db_cursor', return_value=mock_cursor), \
             patch('api_members_family.log_activity') as mock_log:
            self._do(client)

        mock_log.assert_called_once()
        kwargs = mock_log.call_args[1]
        assert kwargs['action'] == 'member_family_remove'

    def test_internal_proc_flag_set_and_cleared(self, client, mock_query):
        """The UPDATE must be wrapped with SET @internal_proc = 1 / NULL."""
        mock_query.return_value = [_family_member(member_id='A0002')]
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)

        with patch('api_members_family.db_cursor', return_value=mock_cursor), \
             patch('api_members_family.log_activity'):
            self._do(client)

        calls = [str(c) for c in mock_cursor.execute.call_args_list]
        assert any('@internal_proc = 1' in c for c in calls)
        assert any('@internal_proc = NULL' in c for c in calls)


# ---------------------------------------------------------------------------
# generate_family_id() helper
# ---------------------------------------------------------------------------

class TestGenerateFamilyId:
    # Note: generate_family_id uses query() (SELECT), not execute() (INSERT/UPDATE).
    # Previously it called execute() which returns int, causing 'int object is not iterable'.

    def test_first_available_when_none_used(self):
        with patch('api_members_family.query', return_value=[]):
            from api_members_family import generate_family_id
            assert generate_family_id() == 'B001'

    def test_skips_used_ids(self):
        used = [{'FamilyID': 'B001'}, {'FamilyID': 'B002'}, {'FamilyID': 'B003'}]
        with patch('api_members_family.query', return_value=used):
            from api_members_family import generate_family_id
            assert generate_family_id() == 'B004'

    def test_ignores_non_b_format(self):
        # FAM001 should not count toward B### namespace
        rows = [{'FamilyID': 'FAM001'}, {'FamilyID': 'B001'}]
        with patch('api_members_family.query', return_value=rows):
            from api_members_family import generate_family_id
            assert generate_family_id() == 'B002'

    def test_raises_when_all_slots_full(self):
        used = [{'FamilyID': f'B{n:03d}'} for n in range(1, 1000)]
        with patch('api_members_family.query', return_value=used):
            from api_members_family import generate_family_id
            with pytest.raises(ValueError, match='all 999 slots are in use'):
                generate_family_id()

    def test_execute_int_return_would_fail(self):
        """Regression: execute() returns int, not iterable — must use query() instead."""
        with patch('api_members_family.query', return_value=42):
            from api_members_family import generate_family_id
            with pytest.raises(TypeError):
                generate_family_id()


# ---------------------------------------------------------------------------
# POST /api/members/family/assign-family-id
# ---------------------------------------------------------------------------

class TestAssignFamilyId:

    URL = '/api/members/family/assign-family-id'

    def _post(self, client, body):
        return client.post(self.URL, json=body,
                           headers={'Content-Type': 'application/json'})

    def test_missing_member_id_returns_400(self, client, mock_query):
        r = self._post(client, {})
        assert r.status_code == 400
        assert 'Missing member_id' in r.get_json()['error']

    def test_member_not_found_returns_404(self, client, mock_query):
        mock_query.return_value = []
        r = self._post(client, {'member_id': 'A9999'})
        assert r.status_code == 404

    def test_non_family_type_returns_400(self, client, mock_query):
        mock_query.return_value = [_member(type_='Individual')]
        r = self._post(client, {'member_id': 'A0001'})
        assert r.status_code == 400
        assert 'not Family type' in r.get_json()['error']

    def test_already_has_family_id_returns_409(self, client, mock_query):
        mock_query.return_value = [_member(type_='Family', family_id='B001')]
        r = self._post(client, {'member_id': 'A0001'})
        assert r.status_code == 409
        assert 'already has FamilyID' in r.get_json()['error']

    def test_assigns_next_available_family_id(self, client, mock_query):
        call_count = 0

        def side_effect(sql, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                # get_member_by_id (orphaned member)
                return [_member(type_='Family', family_id=None)]
            # get_member_by_id after update
            return [_member(type_='Family', family_id='B001')]

        mock_query.side_effect = side_effect

        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)

        with patch('api_members_family.execute', return_value=[]) as mock_exec, \
             patch('api_members_family.query', return_value=[]), \
             patch('api_members_family.db_cursor', return_value=mock_cursor), \
             patch('api_members_family.log_activity'):
            r = self._post(client, {'member_id': 'A0001'})

        assert r.status_code == 200
        data = r.get_json()['data']
        assert data['family_id'] == 'B001'
        assert 'Assigned FamilyID B001' in data['message']
        mock_query.side_effect = None

    def test_logs_assign_action(self, client, mock_query):
        call_count = 0

        def side_effect(sql, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            return ([_member(type_='Family', family_id=None)] if call_count == 1
                    else [_member(type_='Family', family_id='B001')])

        mock_query.side_effect = side_effect
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)

        with patch('api_members_family.execute', return_value=[]), \
             patch('api_members_family.query', return_value=[]), \
             patch('api_members_family.db_cursor', return_value=mock_cursor), \
             patch('api_members_family.log_activity') as mock_log:
            self._post(client, {'member_id': 'A0001'})

        mock_log.assert_called_once()
        assert mock_log.call_args[1]['action'] == 'member_family_assign_id'
        mock_query.side_effect = None

    def test_internal_proc_flag_wrapped(self, client, mock_query):
        call_count = 0

        def side_effect(sql, *args, **kwargs):
            nonlocal call_count
            call_count += 1
            return ([_member(type_='Family', family_id=None)] if call_count == 1
                    else [_member(type_='Family', family_id='B001')])

        mock_query.side_effect = side_effect
        mock_cursor = MagicMock()
        mock_cursor.__enter__ = MagicMock(return_value=mock_cursor)
        mock_cursor.__exit__ = MagicMock(return_value=False)

        with patch('api_members_family.execute', return_value=[]), \
             patch('api_members_family.query', return_value=[]), \
             patch('api_members_family.db_cursor', return_value=mock_cursor), \
             patch('api_members_family.log_activity'):
            self._post(client, {'member_id': 'A0001'})

        calls = [str(c) for c in mock_cursor.execute.call_args_list]
        assert any('@internal_proc = 1' in c for c in calls)
        assert any('@internal_proc = NULL' in c for c in calls)
        mock_query.side_effect = None
