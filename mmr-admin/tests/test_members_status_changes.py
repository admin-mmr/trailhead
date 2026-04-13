"""
Tests for member status change endpoints and the new revert-override flow.

Coverage
────────
Param-order fix (all 4 sp_admin_update_member_status call sites)
  change_member_status
  ├── admin_email is 2nd arg (not new_status)
  ├── new_status is 3rd arg
  ├── expiration is NULL (4th hardcoded)
  ├── note is 4th param (5th total position)
  ├── 400 on bad status value
  ├── 400 on missing note
  ├── 404 on unknown member
  └── 401 on missing admin session

  revert_member_status
  ├── admin_email is 2nd arg
  ├── old_status is 3rd arg
  ├── expiration is 4th arg
  └── note is 5th arg

  mark_member_active
  ├── admin_email is 2nd arg
  ├── 'active' is 3rd arg (literal)
  ├── year_end date is 4th arg
  └── note is 5th arg

GET /api/members/overrides/all
  ├── 200 returns list
  ├── REVERT rows excluded from SQL filter
  ├── Timestamps serialised to ISO strings
  ├── default limit is 50
  ├── custom limit respected
  └── limit capped at 200

POST /api/members/revert-override
  ├── 200 happy path — calls sp_revert_admin_override
  ├── correct override_id passed to procedure
  ├── response shape: reverted_override_id, members_restored, impacted_member_ids
  ├── log_activity called with action=revert_admin_override
  ├── 400 on missing override_id
  ├── 400 on empty body
  └── SP result fields correctly mapped to response
"""
import os
import pytest
from datetime import datetime, date
from unittest.mock import patch, MagicMock, call

# ─────────────────────────────────────────────────────────────────
# Shared helpers
# ─────────────────────────────────────────────────────────────────

def _member(member_id='A0001', status='active', expiration='2025-03-31', family_id=None):
    return {
        'MemberID': member_id, 'FirstName': 'Jane', 'LastName': 'Doe',
        'Email': 'jane@example.com', 'PhoneNumber': None, 'WeChatID': None,
        'Type': 'Individual', 'FamilyID': family_id, 'District': 'Manhattan',
        'Status': status, 'Expiration': expiration,
        'MembershipFeePaid': None, 'PaymentDate': None,
        'PaymentTransaction': None, 'UpdatedAt': None,
    }


def _override(override_id=1, old_value='active', new_value='inactive',
              impacted='A0001', action='STATUS_CHANGE', admin='admin@mmrunners.org',
              notes='unused memberid', ts=None):
    return {
        'OverrideID': override_id,
        'AdminEmail': admin,
        'TargetMemberID': 'A0001',
        'ImpactedMemberIDs': impacted,
        'ActionType': action,
        'OldValue': old_value,
        'NewValue': new_value,
        'AdminNotes': notes,
        'Timestamp': ts or datetime(2026, 4, 12, 1, 5, 12),
    }


# ─────────────────────────────────────────────────────────────────
# Param-order fix: POST /api/members/<id>/status
# ─────────────────────────────────────────────────────────────────

class TestChangeStatusParamOrder:
    """
    The critical bug was admin_id last instead of second.
    Fixed call: (member_id, admin_id, new_status, NULL, note)
    """

    @pytest.fixture(autouse=True)
    def _patches(self):
        with patch('api_members_status.execute') as mock_exec, \
             patch('api_members_status.log_activity'), \
             patch('api_members_status.get_admin_id', return_value='admin@mmrunners.org'):
            self.mock_exec = mock_exec
            yield

    def _setup(self, mock_query, member=None):
        """query called twice: get_member_by_id (before) + get_member_by_id (after)."""
        m = [member or _member()]
        calls = {'n': 0}
        def side(*a, **kw):
            calls['n'] += 1
            return m
        mock_query.side_effect = side

    def test_admin_email_is_second_arg(self, client, mock_query):
        self._setup(mock_query)
        client.post('/api/members/A0001/status',
                    json={'new_status': 'inactive', 'note': 'unused memberid'})
        _, params = self.mock_exec.call_args[0]
        assert params[1] == 'admin@mmrunners.org', (
            f"Expected admin email at index 1, got {params[1]!r}. "
            "Likely still passing new_status as admin arg."
        )

    def test_new_status_is_third_arg(self, client, mock_query):
        self._setup(mock_query)
        client.post('/api/members/A0001/status',
                    json={'new_status': 'inactive', 'note': 'unused memberid'})
        _, params = self.mock_exec.call_args[0]
        assert params[2] == 'inactive', (
            f"Expected new_status at index 2, got {params[2]!r}."
        )

    def test_expiration_is_null_in_sql(self, client, mock_query):
        self._setup(mock_query)
        client.post('/api/members/A0001/status',
                    json={'new_status': 'inactive', 'note': 'unused memberid'})
        sql, _ = self.mock_exec.call_args[0]
        assert 'NULL' in sql, "Expiration should be hardcoded NULL for status-only changes."

    def test_note_is_last_param(self, client, mock_query):
        self._setup(mock_query)
        client.post('/api/members/A0001/status',
                    json={'new_status': 'inactive', 'note': 'unused memberid'})
        _, params = self.mock_exec.call_args[0]
        assert params[-1] == 'unused memberid'

    def test_member_id_is_first_arg(self, client, mock_query):
        self._setup(mock_query)
        client.post('/api/members/A0404/status',
                    json={'new_status': 'inactive', 'note': 'test note'})
        _, params = self.mock_exec.call_args[0]
        assert params[0] == 'A0404'

    def test_lifetime_status_passes_through(self, client, mock_query):
        self._setup(mock_query)
        client.post('/api/members/A0001/status',
                    json={'new_status': 'lifetime', 'note': 'honorary'})
        _, params = self.mock_exec.call_args[0]
        assert params[2] == 'lifetime'

    def test_bad_status_returns_400_without_calling_proc(self, client, mock_query):
        self._setup(mock_query)
        r = client.post('/api/members/A0001/status',
                        json={'new_status': 'active', 'note': 'should fail'})
        assert r.status_code == 400
        assert not self.mock_exec.called

    def test_missing_note_returns_400(self, client, mock_query):
        self._setup(mock_query)
        r = client.post('/api/members/A0001/status',
                        json={'new_status': 'inactive'})
        assert r.status_code == 400
        assert not self.mock_exec.called

    def test_unknown_member_returns_404(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/members/ZZZZ/status',
                        json={'new_status': 'inactive', 'note': 'test'})
        assert r.status_code == 404
        assert not self.mock_exec.called

    def test_missing_admin_session_returns_401(self, client, mock_query):
        self._setup(mock_query)
        with patch('api_members_status.get_admin_id', return_value=None):
            r = client.post('/api/members/A0001/status',
                            json={'new_status': 'inactive', 'note': 'test'})
        assert r.status_code == 401
        assert not self.mock_exec.called

    def test_200_on_success(self, client, mock_query):
        self._setup(mock_query)
        r = client.post('/api/members/A0001/status',
                        json={'new_status': 'inactive', 'note': 'confirmed not to renew'})
        assert r.status_code == 200
        assert r.get_json()['ok'] is True


# ─────────────────────────────────────────────────────────────────
# Param-order fix: POST /api/members/<id>/revert-status
# ─────────────────────────────────────────────────────────────────

class TestRevertStatusParamOrder:

    @pytest.fixture(autouse=True)
    def _patches(self):
        with patch('api_members_status.execute') as mock_exec, \
             patch('api_members_status.log_activity'), \
             patch('api_members_status.get_admin_id', return_value='admin@mmrunners.org'):
            self.mock_exec = mock_exec
            yield

    def _setup(self, mock_query, old_value='expired'):
        calls = {'n': 0}
        m = [_member(status='inactive')]
        ov = [_override(old_value=old_value)]
        updated = [_member(status=old_value)]
        def side(*a, **kw):
            calls['n'] += 1
            if calls['n'] == 1: return m      # get_member_by_id
            if calls['n'] == 2: return ov     # override lookup
            return updated                     # get_member_by_id after SP
        mock_query.side_effect = side

    def test_admin_email_is_second_arg(self, client, mock_query):
        self._setup(mock_query)
        client.post('/api/members/A0001/revert-status',
                    json={'override_id': 1, 'note': 'reverting'})
        _, params = self.mock_exec.call_args[0]
        assert params[1] == 'admin@mmrunners.org'

    def test_old_status_is_third_arg(self, client, mock_query):
        self._setup(mock_query, old_value='expired')
        client.post('/api/members/A0001/revert-status',
                    json={'override_id': 1, 'note': 'reverting'})
        _, params = self.mock_exec.call_args[0]
        assert params[2] == 'expired'

    def test_note_is_fifth_arg(self, client, mock_query):
        self._setup(mock_query)
        client.post('/api/members/A0001/revert-status',
                    json={'override_id': 1, 'note': 'reverting bad override'})
        _, params = self.mock_exec.call_args[0]
        assert params[4] == 'reverting bad override'


# ─────────────────────────────────────────────────────────────────
# Param-order fix: POST /api/members/<id>/mark-active
# ─────────────────────────────────────────────────────────────────

class TestMarkActiveParamOrder:

    @pytest.fixture(autouse=True)
    def _patches(self):
        with patch('api_members_status.execute') as mock_exec, \
             patch('api_members_status.log_activity'), \
             patch('api_members_status.get_admin_id', return_value='admin@mmrunners.org'):
            self.mock_exec = mock_exec
            yield

    def _setup(self, mock_query, year_end='2025-03-31'):
        calls = {'n': 0}
        m = [_member(status='expired')]
        config = [{'ConfigValue': year_end}]
        updated = [_member(status='active', expiration=year_end)]
        def side(*a, **kw):
            calls['n'] += 1
            if calls['n'] == 1: return m
            if calls['n'] == 2: return config
            return updated
        mock_query.side_effect = side

    def test_admin_email_is_second_arg(self, client, mock_query):
        self._setup(mock_query)
        client.post('/api/members/A0001/mark-active', json={'note': 'renewed'})
        _, params = self.mock_exec.call_args[0]
        assert params[1] == 'admin@mmrunners.org'

    def test_active_literal_is_third_arg(self, client, mock_query):
        self._setup(mock_query)
        client.post('/api/members/A0001/mark-active', json={'note': 'renewed'})
        _, params = self.mock_exec.call_args[0]
        assert params[2] == 'active'

    def test_year_end_is_fourth_arg(self, client, mock_query):
        self._setup(mock_query, year_end='2025-03-31')
        client.post('/api/members/A0001/mark-active', json={'note': 'renewed'})
        _, params = self.mock_exec.call_args[0]
        assert params[3] == '2025-03-31'

    def test_note_is_fifth_arg(self, client, mock_query):
        self._setup(mock_query)
        client.post('/api/members/A0001/mark-active', json={'note': 'renewed at event'})
        _, params = self.mock_exec.call_args[0]
        assert params[4] == 'renewed at event'

    def test_missing_note_returns_400(self, client, mock_query):
        self._setup(mock_query)
        r = client.post('/api/members/A0001/mark-active', json={})
        assert r.status_code == 400
        assert not self.mock_exec.called


# ─────────────────────────────────────────────────────────────────
# GET /api/members/overrides/all
# ─────────────────────────────────────────────────────────────────

class TestGetAllOverrides:

    def test_200_with_empty_list(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/members/overrides/all')
        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert data['data'] == []

    def test_200_returns_override_rows(self, client, mock_query):
        mock_query.return_value = [_override()]
        r = client.get('/api/members/overrides/all')
        assert r.status_code == 200
        rows = r.get_json()['data']
        assert len(rows) == 1
        assert rows[0]['OverrideID'] == 1

    def test_revert_rows_excluded_in_sql(self, client, mock_query):
        """Endpoint must filter out REVERT audit entries at DB level."""
        mock_query.return_value = []
        client.get('/api/members/overrides/all')
        sql = mock_query.call_args[0][0]
        assert "ActionType != 'REVERT'" in sql or "ActionType <> 'REVERT'" in sql, (
            "Query must exclude REVERT rows so admins don't see revert audit entries."
        )

    def test_ordered_most_recent_first(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/members/overrides/all')
        sql = mock_query.call_args[0][0]
        assert 'DESC' in sql.upper()

    def test_timestamp_serialised_to_iso_string(self, client, mock_query):
        ov = _override(ts=datetime(2026, 4, 12, 1, 5, 12))
        mock_query.return_value = [ov]
        r = client.get('/api/members/overrides/all')
        ts = r.get_json()['data'][0]['Timestamp']
        assert isinstance(ts, str)
        assert '2026-04-12' in ts

    def test_default_limit_is_50(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/members/overrides/all')
        params = mock_query.call_args[0][1]
        assert 50 in params

    def test_custom_limit_respected(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/members/overrides/all?limit=10')
        params = mock_query.call_args[0][1]
        assert 10 in params

    def test_limit_capped_at_200(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/members/overrides/all?limit=9999')
        params = mock_query.call_args[0][1]
        assert 200 in params
        assert 9999 not in params

    def test_all_core_fields_present(self, client, mock_query):
        mock_query.return_value = [_override()]
        r = client.get('/api/members/overrides/all')
        row = r.get_json()['data'][0]
        for field in ('OverrideID', 'AdminEmail', 'TargetMemberID', 'ImpactedMemberIDs',
                      'ActionType', 'OldValue', 'NewValue', 'AdminNotes', 'Timestamp'):
            assert field in row, f"Missing field {field!r} in override row"

    def test_multiple_rows_returned(self, client, mock_query):
        mock_query.return_value = [_override(override_id=i) for i in range(5)]
        r = client.get('/api/members/overrides/all')
        assert len(r.get_json()['data']) == 5


# ─────────────────────────────────────────────────────────────────
# POST /api/members/revert-override
# ─────────────────────────────────────────────────────────────────

class TestRevertOverride:
    """
    Tests for the new endpoint that calls sp_revert_admin_override.
    Unlike the old revert-status, this reverts all ImpactedMemberIDs at once.
    """

    @pytest.fixture(autouse=True)
    def _patches(self):
        with patch('api_members_status.log_activity') as mock_log, \
             patch('api_members_status.get_admin_id', return_value='admin@mmrunners.org'):
            self.mock_log = mock_log
            yield

    def _sp_result(self, override_id=42, members_restored=3,
                   impacted='A0001,A0002,A0003', override_ts=None):
        return [{
            'reverted_override_id':  override_id,
            'members_restored':      members_restored,
            'original_override_time': override_ts or datetime(2026, 4, 12, 1, 5, 12),
            'impacted_member_ids':   impacted,
        }]

    def test_200_happy_path(self, client, mock_query):
        mock_query.return_value = self._sp_result()
        r = client.post('/api/members/revert-override', json={'override_id': 42})
        assert r.status_code == 200
        assert r.get_json()['ok'] is True

    def test_calls_sp_revert_admin_override(self, client, mock_query):
        mock_query.return_value = self._sp_result()
        client.post('/api/members/revert-override', json={'override_id': 42})
        sql = mock_query.call_args[0][0]
        assert 'sp_revert_admin_override' in sql

    def test_correct_override_id_passed_to_proc(self, client, mock_query):
        mock_query.return_value = self._sp_result(override_id=99)
        client.post('/api/members/revert-override', json={'override_id': 99})
        params = mock_query.call_args[0][1]
        assert 99 in params

    def test_response_contains_reverted_override_id(self, client, mock_query):
        mock_query.return_value = self._sp_result(override_id=42)
        r = client.post('/api/members/revert-override', json={'override_id': 42})
        assert r.get_json()['data']['reverted_override_id'] == 42

    def test_response_contains_members_restored(self, client, mock_query):
        mock_query.return_value = self._sp_result(members_restored=5)
        r = client.post('/api/members/revert-override', json={'override_id': 42})
        assert r.get_json()['data']['members_restored'] == 5

    def test_response_contains_impacted_member_ids(self, client, mock_query):
        mock_query.return_value = self._sp_result(impacted='A0001,A0002')
        r = client.post('/api/members/revert-override', json={'override_id': 42})
        assert r.get_json()['data']['impacted_member_ids'] == 'A0001,A0002'

    def test_response_contains_original_override_time(self, client, mock_query):
        mock_query.return_value = self._sp_result(
            override_ts=datetime(2026, 4, 12, 1, 5, 12)
        )
        r = client.post('/api/members/revert-override', json={'override_id': 42})
        assert '2026-04-12' in r.get_json()['data']['original_override_time']

    def test_log_activity_called(self, client, mock_query):
        mock_query.return_value = self._sp_result(members_restored=3)
        client.post('/api/members/revert-override', json={'override_id': 42})
        assert self.mock_log.called
        kwargs = self.mock_log.call_args[1]
        assert kwargs.get('action') == 'revert_admin_override'

    def test_log_activity_records_override_id(self, client, mock_query):
        mock_query.return_value = self._sp_result()
        client.post('/api/members/revert-override', json={'override_id': 42})
        kwargs = self.mock_log.call_args[1]
        assert '42' in kwargs.get('state', '')

    def test_log_activity_records_member_count(self, client, mock_query):
        mock_query.return_value = self._sp_result(members_restored=7)
        client.post('/api/members/revert-override', json={'override_id': 42})
        kwargs = self.mock_log.call_args[1]
        assert '7' in kwargs.get('state', '')

    # ── Column-width regression tests (the bug that reached production) ──────

    def test_member_id_not_passed_to_log_activity(self, client, mock_query):
        """
        Regression: impacted_member_ids (e.g. 'A0001,A0002,...' for 171 members)
        must never be passed as member_id — activity_log.MemberID is VARCHAR(10).
        """
        long_list = ','.join(f'A{i:04d}' for i in range(1, 172))  # 171 IDs, ~1025 chars
        mock_query.return_value = self._sp_result(impacted=long_list)
        client.post('/api/members/revert-override', json={'override_id': 42})
        kwargs = self.mock_log.call_args[1]
        member_id_arg = kwargs.get('member_id', '')
        assert len(member_id_arg) <= 10, (
            f"member_id passed to log_activity is {len(member_id_arg)} chars — "
            f"exceeds activity_log.MemberID VARCHAR(10). Got: {member_id_arg[:30]!r}..."
        )

    def test_state_fits_in_varchar_50(self, client, mock_query):
        """
        Regression: activity_log.State is VARCHAR(50).
        State must stay short even with large override_id or member counts.
        """
        mock_query.return_value = self._sp_result(override_id=999999, members_restored=9999)
        client.post('/api/members/revert-override', json={'override_id': 999999})
        kwargs = self.mock_log.call_args[1]
        state = kwargs.get('state', '')
        assert len(state) <= 50, (
            f"state is {len(state)} chars — exceeds activity_log.State VARCHAR(50). "
            f"Got: {state!r}"
        )

    def test_missing_override_id_returns_400(self, client, mock_query):
        r = client.post('/api/members/revert-override', json={})
        assert r.status_code == 400
        assert r.get_json()['ok'] is False
        assert not mock_query.called

    def test_null_override_id_returns_400(self, client, mock_query):
        """Explicitly passing null override_id is also rejected."""
        r = client.post('/api/members/revert-override', json={'override_id': None})
        assert r.status_code == 400
        assert not mock_query.called

    def test_no_proc_result_still_returns_200(self, client, mock_query):
        """SP returning no rows (edge case) should not 500."""
        mock_query.return_value = []
        r = client.post('/api/members/revert-override', json={'override_id': 42})
        assert r.status_code == 200

    def test_idempotent_call_still_200(self, client, mock_query):
        """Calling twice with same override_id is safe (SP is idempotent)."""

        mock_query.return_value = self._sp_result(members_restored=3)
        r1 = client.post('/api/members/revert-override', json={'override_id': 42})
        r2 = client.post('/api/members/revert-override', json={'override_id': 42})
        assert r1.status_code == 200
        assert r2.status_code == 200
        assert r1.get_json()['data']['members_restored'] == \
               r2.get_json()['data']['members_restored']


# ─────────────────────────────────────────────────────────────────
# Regression: NULL Status in member_log silently skipped (V011 fix)
# ─────────────────────────────────────────────────────────────────

class TestRevertNullStatusRegression:
    """
    Regression tests for the bug where sp_revert_admin_override reported
    success but left members inactive because member_log rows written by
    Sheets sync have Status = NULL.

    COALESCE(NULL, Status) = Status (current wrong value) → no change.
    Fix: AND Status IS NOT NULL in the member_log SELECT.

    These tests verify the migration SQL contains the fix and that the
    endpoint correctly surfaces a zero-restored result when the SP finds
    no valid snapshots (so the admin knows to investigate rather than
    assuming success).
    """

    MIGRATION_PATH = os.path.abspath(
        os.path.join(os.path.dirname(__file__),
                     '../../db/MIGRATION_V011_fix_sp_revert_null_status.sql')
    )

    def test_migration_contains_status_is_not_null_guard(self):
        """
        Regression: the member_log SELECT must filter out NULL-Status rows.
        Without this, COALESCE(NULL, current_status) silently keeps wrong value.
        """
        with open(self.MIGRATION_PATH) as f:
            sql = f.read()
        assert 'Status IS NOT NULL' in sql, (
            "Migration must include 'AND Status IS NOT NULL' in the member_log "
            "SELECT inside sp_revert_admin_override. Without it, Sheets-sync log "
            "rows (which have NULL Status) cause COALESCE to fall back to the "
            "current wrong status, so the revert silently does nothing."
        )

    def test_migration_applies_fix_inside_cursor_loop(self):
        """Fix must be inside sp_revert_admin_override body, not just anywhere in the file."""
        with open(self.MIGRATION_PATH) as f:
            sql = f.read()
        # Locate the CREATE PROCEDURE statement for sp_revert_admin_override
        # (robust: not fragile to the number of DROP/mention occurrences before it)
        create_pos = sql.find('CREATE PROCEDURE sp_revert_admin_override')
        assert create_pos != -1, (
            "sp_revert_admin_override CREATE PROCEDURE not found in migration file."
        )
        revert_proc_body = sql[create_pos:]
        assert 'Status IS NOT NULL' in revert_proc_body, (
            "'AND Status IS NOT NULL' must be in sp_revert_admin_override, "
            "not only in sp_admin_update_member_status."
        )

    def test_zero_restored_when_sp_finds_no_snapshots(self, client, mock_query):
        """
        When all member_log Status rows are NULL (common for Sheets-sync members),
        the SP returns members_restored=0. Endpoint must surface this honestly
        rather than reporting false success.
        """
        with patch('api_members_status.log_activity'), \
             patch('api_members_status.get_admin_id', return_value='admin@mmrunners.org'):
            mock_query.return_value = [{
                'reverted_override_id':  13,
                'members_restored':      0,   # SP found no non-NULL Status snapshots
                'original_override_time': datetime(2026, 4, 12, 1, 5, 12),
                'impacted_member_ids':   'A0003,A0005',
            }]
            r = client.post('/api/members/revert-override', json={'override_id': 13})
        assert r.status_code == 200
        assert r.get_json()['data']['members_restored'] == 0, (
            "Endpoint must not hide a zero-restore result. "
            "Admin needs to know the SP found no valid snapshots."
        )
