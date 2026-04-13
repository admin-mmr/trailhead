"""
Tests for member log history and restore-from-log endpoints.

GET  /api/members/<id>/log-history
POST /api/members/<id>/restore-from-log

Coverage:
  log-history
  ├── 200 with member + log list
  ├── 404 for unknown member
  ├── limit param respected (default 50, max 200)
  ├── date fields serialised to strings (no datetime objects in JSON)
  └── MembershipFeePaid serialised to float

  restore-from-log
  ├── 200 happy path — calls sp_admin_update_member_status with log values
  ├── 400 missing log_id
  ├── 400 missing note
  ├── 404 unknown member
  ├── 404 log_id not found for this member
  ├── 400 log entry has no Status
  ├── stored proc called with correct status + expiration from the log row
  ├── response contains restored_status, restored_expiration, snapshot_time
  └── log_activity called (via mock)
"""
import pytest
from datetime import date, datetime
from unittest.mock import patch, MagicMock, call

# ─────────────────────────────────────────────────────────────────
# Shared test fixtures
# ─────────────────────────────────────────────────────────────────

def _member(member_id='A0001', status='expired', expiration='2024-03-31'):
    return {
        'MemberID': member_id, 'FirstName': 'Jane', 'LastName': 'Doe',
        'Email': 'jane@example.com', 'PhoneNumber': None, 'WeChatID': None,
        'Type': 'Individual', 'FamilyID': None, 'District': 'Manhattan',
        'Status': status, 'Expiration': expiration,
        'MembershipFeePaid': None, 'PaymentDate': None,
        'PaymentTransaction': None, 'UpdatedAt': None,
    }


def _log_row(**overrides):
    base = {
        'LogID': 'LOG001',
        'LoggingTime': datetime(2024, 1, 15, 10, 30, 0),
        'ChangeType': 'SYNC',
        'Status': 'active',
        'Expiration': date(2024, 3, 31),
        'Type': 'Individual',
        'FamilyID': None,
        'MembershipFeePaid': None,
        'PaymentDate': None,
        'PaymentTransaction': None,
    }
    base.update(overrides)
    return base


# ─────────────────────────────────────────────────────────────────
# GET /api/members/<id>/log-history
# ─────────────────────────────────────────────────────────────────

class TestMemberLogHistory:

    def _setup(self, mock_query, member=None, log=None):
        """Two query calls: get_member_by_id then log SELECT."""
        calls = {'n': 0}
        member_row = [member or _member()]
        log_rows = log if log is not None else [_log_row()]

        def _side(*args, **kwargs):
            calls['n'] += 1
            if calls['n'] == 1:
                return member_row
            return log_rows

        mock_query.side_effect = _side

    def test_200_with_member_and_log(self, client, mock_query):
        self._setup(mock_query)
        r = client.get('/api/members/A0001/log-history')
        assert r.status_code == 200
        data = r.get_json()
        assert data['ok'] is True
        assert 'member' in data['data']
        assert 'log' in data['data']
        assert data['data']['count'] == 1

    def test_member_not_found_returns_404(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/members/XXXX/log-history')
        assert r.status_code == 404
        assert r.get_json()['ok'] is False

    def test_log_empty_still_returns_200(self, client, mock_query):
        self._setup(mock_query, log=[])
        r = client.get('/api/members/A0001/log-history')
        assert r.status_code == 200
        assert r.get_json()['data']['count'] == 0
        assert r.get_json()['data']['log'] == []

    def test_logging_time_serialised_to_string(self, client, mock_query):
        self._setup(mock_query)
        r = client.get('/api/members/A0001/log-history')
        log = r.get_json()['data']['log']
        assert isinstance(log[0]['LoggingTime'], str)
        assert 'T' in log[0]['LoggingTime']  # ISO 8601

    def test_expiration_serialised_to_string(self, client, mock_query):
        self._setup(mock_query)
        r = client.get('/api/members/A0001/log-history')
        exp = r.get_json()['data']['log'][0]['Expiration']
        assert isinstance(exp, str)
        assert exp == '2024-03-31'

    def test_null_expiration_stays_null(self, client, mock_query):
        self._setup(mock_query, log=[_log_row(Expiration=None)])
        r = client.get('/api/members/A0001/log-history')
        exp = r.get_json()['data']['log'][0]['Expiration']
        assert exp is None

    def test_membership_fee_paid_serialised_to_float(self, client, mock_query):
        from decimal import Decimal
        self._setup(mock_query, log=[_log_row(MembershipFeePaid=Decimal('30.00'))])
        r = client.get('/api/members/A0001/log-history')
        fee = r.get_json()['data']['log'][0]['MembershipFeePaid']
        assert isinstance(fee, float)
        assert fee == 30.0

    def test_null_fee_stays_null(self, client, mock_query):
        self._setup(mock_query, log=[_log_row(MembershipFeePaid=None)])
        r = client.get('/api/members/A0001/log-history')
        assert r.get_json()['data']['log'][0]['MembershipFeePaid'] is None

    def test_default_limit_sent_to_db(self, client, mock_query):
        self._setup(mock_query, log=[])
        client.get('/api/members/A0001/log-history')
        # Second call is the log SELECT — check LIMIT 50 in params
        log_call = mock_query.call_args_list[1]
        params = log_call[0][1] if len(log_call[0]) > 1 else log_call[1].get('params', [])
        assert 50 in params

    def test_custom_limit_respected(self, client, mock_query):
        self._setup(mock_query, log=[])
        client.get('/api/members/A0001/log-history?limit=10')
        log_call = mock_query.call_args_list[1]
        params = log_call[0][1] if len(log_call[0]) > 1 else log_call[1].get('params', [])
        assert 10 in params

    def test_limit_capped_at_200(self, client, mock_query):
        self._setup(mock_query, log=[])
        client.get('/api/members/A0001/log-history?limit=9999')
        log_call = mock_query.call_args_list[1]
        params = log_call[0][1] if len(log_call[0]) > 1 else log_call[1].get('params', [])
        assert 200 in params
        assert 9999 not in params

    def test_multiple_log_rows_returned(self, client, mock_query):
        rows = [_log_row(LogID=f'L{i}', Status='active') for i in range(5)]
        self._setup(mock_query, log=rows)
        r = client.get('/api/members/A0001/log-history')
        assert r.get_json()['data']['count'] == 5
        assert len(r.get_json()['data']['log']) == 5


# ─────────────────────────────────────────────────────────────────
# POST /api/members/<id>/restore-from-log
# ─────────────────────────────────────────────────────────────────

class TestRestoreFromLog:
    """Tests for the restore-from-log endpoint."""

    @pytest.fixture(autouse=True)
    def _mock_execute_and_log(self):
        """Patch execute, log_activity, and get_admin_id (no live session in tests)."""
        with patch('api_members_status.execute') as mock_exec, \
             patch('api_members_status.log_activity') as mock_log, \
             patch('api_members_status.get_admin_id', return_value='admin@test.com'):
            self.mock_exec = mock_exec
            self.mock_log = mock_log
            yield

    def _setup(self, mock_query, member=None, log_row=None, not_found=False):
        """
        Query sequence:
          1. get_member_by_id  → member row (or [] for 404)
          2. log SELECT        → [log_row] (or [] for 'log not found')
          3. get_member_by_id  → updated member (after SP call)
        """
        calls = {'n': 0}
        m = [member or _member()]
        lr = [] if not_found else [log_row or _log_row()]
        updated = [member or _member(status='active', expiration='2024-03-31')]

        def _side(*args, **kwargs):
            calls['n'] += 1
            if calls['n'] == 1:
                return m
            if calls['n'] == 2:
                return lr
            return updated

        mock_query.side_effect = _side

    # ── Happy path ──

    def test_200_happy_path(self, client, mock_query):
        self._setup(mock_query)
        r = client.post('/api/members/A0001/restore-from-log',
                        json={'log_id': 'LOG001', 'note': 'Reverting bad sync'})
        assert r.status_code == 200
        assert r.get_json()['ok'] is True

    def test_response_contains_restored_fields(self, client, mock_query):
        self._setup(mock_query)
        r = client.post('/api/members/A0001/restore-from-log',
                        json={'log_id': 'LOG001', 'note': 'Reverting'})
        data = r.get_json()['data']
        assert 'restored_status' in data
        assert 'restored_expiration' in data
        assert 'snapshot_time' in data
        assert 'updated_member' in data
        assert 'message' in data

    def test_restored_status_matches_log_row(self, client, mock_query):
        self._setup(mock_query, log_row=_log_row(Status='active'))
        r = client.post('/api/members/A0001/restore-from-log',
                        json={'log_id': 'LOG001', 'note': 'Reverting'})
        assert r.get_json()['data']['restored_status'] == 'active'

    def test_restored_expiration_matches_log_row(self, client, mock_query):
        self._setup(mock_query, log_row=_log_row(Expiration=date(2025, 3, 31)))
        r = client.post('/api/members/A0001/restore-from-log',
                        json={'log_id': 'LOG001', 'note': 'Reverting'})
        assert r.get_json()['data']['restored_expiration'] == '2025-03-31'

    def test_null_expiration_in_log_passes_none_to_proc(self, client, mock_query):
        self._setup(mock_query, log_row=_log_row(Expiration=None))
        client.post('/api/members/A0001/restore-from-log',
                    json={'log_id': 'LOG001', 'note': 'Reverting'})
        args = self.mock_exec.call_args[0][1]
        assert args[2] is None  # restore_expiration param

    def test_stored_proc_called_with_correct_args(self, client, mock_query):
        self._setup(mock_query, log_row=_log_row(Status='active', Expiration=date(2024, 3, 31)))
        with patch('api_members_status.get_admin_id', return_value='admin@test.com'):
            client.post('/api/members/A0001/restore-from-log',
                        json={'log_id': 'LOG001', 'note': 'Reverting bad sync'})
        args = self.mock_exec.call_args[0][1]
        assert args[0] == 'A0001'           # member_id
        assert args[1] == 'active'          # restored status
        assert args[2] == '2024-03-31'      # restored expiration as string
        assert args[3] == 'Reverting bad sync'  # note
        assert args[4] == 'admin@test.com'  # admin email

    def test_log_activity_called(self, client, mock_query):
        self._setup(mock_query)
        client.post('/api/members/A0001/restore-from-log',
                    json={'log_id': 'LOG001', 'note': 'Reverting'})
        assert self.mock_log.called
        kwargs = self.mock_log.call_args[1]
        assert kwargs.get('action') == 'member_restore_from_log'
        assert kwargs.get('member_id') == 'A0001'

    # ── Validation errors ──

    def test_missing_log_id_returns_400(self, client, mock_query):
        self._setup(mock_query)
        r = client.post('/api/members/A0001/restore-from-log', json={'note': 'hi'})
        assert r.status_code == 400
        assert 'log_id' in r.get_json()['error']

    def test_empty_log_id_returns_400(self, client, mock_query):
        self._setup(mock_query)
        r = client.post('/api/members/A0001/restore-from-log',
                        json={'log_id': '', 'note': 'hi'})
        assert r.status_code == 400

    def test_missing_note_returns_400(self, client, mock_query):
        self._setup(mock_query)
        r = client.post('/api/members/A0001/restore-from-log', json={'log_id': 'LOG001'})
        assert r.status_code == 400
        assert 'note' in r.get_json()['error']

    def test_empty_note_returns_400(self, client, mock_query):
        self._setup(mock_query)
        r = client.post('/api/members/A0001/restore-from-log',
                        json={'log_id': 'LOG001', 'note': '   '})
        assert r.status_code == 400

    def test_empty_body_returns_400(self, client, mock_query):
        self._setup(mock_query)
        r = client.post('/api/members/A0001/restore-from-log', json={})
        assert r.status_code == 400

    # ── Not found errors ──

    def test_unknown_member_returns_404(self, client, mock_query):
        mock_query.return_value = []
        r = client.post('/api/members/XXXX/restore-from-log',
                        json={'log_id': 'LOG001', 'note': 'hi'})
        assert r.status_code == 404
        assert r.get_json()['ok'] is False

    def test_log_id_not_found_for_member_returns_404(self, client, mock_query):
        self._setup(mock_query, not_found=True)
        r = client.post('/api/members/A0001/restore-from-log',
                        json={'log_id': 'LOG999', 'note': 'hi'})
        assert r.status_code == 404
        assert 'not found' in r.get_json()['error'].lower()

    def test_log_row_with_no_status_returns_400(self, client, mock_query):
        self._setup(mock_query, log_row=_log_row(Status=None))
        r = client.post('/api/members/A0001/restore-from-log',
                        json={'log_id': 'LOG001', 'note': 'hi'})
        assert r.status_code == 400
        assert 'Status' in r.get_json()['error']

    # ── No stored proc call on error paths ──

    def test_stored_proc_not_called_on_validation_error(self, client, mock_query):
        self._setup(mock_query)
        client.post('/api/members/A0001/restore-from-log', json={'log_id': 'LOG001'})
        assert not self.mock_exec.called

    def test_stored_proc_not_called_when_log_missing(self, client, mock_query):
        self._setup(mock_query, not_found=True)
        client.post('/api/members/A0001/restore-from-log',
                    json={'log_id': 'LOG999', 'note': 'hi'})
        assert not self.mock_exec.called

    # ── Snapshot time in response ──

    def test_snapshot_time_is_iso_string(self, client, mock_query):
        snap_time = datetime(2024, 1, 15, 10, 30, 0)
        self._setup(mock_query, log_row=_log_row(LoggingTime=snap_time))
        r = client.post('/api/members/A0001/restore-from-log',
                        json={'log_id': 'LOG001', 'note': 'hi'})
        assert '2024-01-15' in r.get_json()['data']['snapshot_time']
