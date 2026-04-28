"""
Tests for api_query.py — execute, config, diagnostics, and helper functions.

Coverage target: api_query.py 76% → ~95%
Uncovered lines: 47-68, 80-82, 161-173, 192-193, 231-233.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_api_query_exec.py -v
"""
import pytest
from unittest.mock import patch, MagicMock


# ── _is_select_query / _is_call_statement / _is_super_admin ──────────────────

class TestQueryHelpers:
    def setup_method(self):
        from api_query import _is_select_query, _is_call_statement, _is_super_admin
        self.is_select = _is_select_query
        self.is_call   = _is_call_statement
        self.is_super  = _is_super_admin

    # _is_select_query
    def test_select_returns_true(self):
        assert self.is_select('SELECT * FROM members') is True

    def test_select_case_insensitive(self):
        assert self.is_select('select id from t') is True

    def test_call_also_returns_true_for_is_select(self):
        # Legacy: CALL is treated as SELECT-like (read-only routing)
        assert self.is_select('CALL sp_foo()') is True

    def test_insert_returns_false(self):
        assert self.is_select('INSERT INTO t VALUES (1)') is False

    def test_update_returns_false(self):
        assert self.is_select('UPDATE members SET status=active') is False

    def test_delete_returns_false(self):
        assert self.is_select('DELETE FROM t WHERE id=1') is False

    def test_leading_whitespace_handled(self):
        assert self.is_select('   SELECT 1') is True

    # _is_call_statement
    def test_call_statement_detected(self):
        assert self.is_call('CALL sp_reconcile()') is True

    def test_call_case_insensitive(self):
        assert self.is_call('call sp_foo(1,2)') is True

    def test_select_not_a_call(self):
        assert self.is_call('SELECT 1') is False

    def test_insert_not_a_call(self):
        assert self.is_call('INSERT INTO t VALUES (1)') is False

    # _is_super_admin
    def test_known_super_admin(self):
        assert self.is_super('admin@mmrunners.org') is True

    def test_unknown_email_not_super(self):
        assert self.is_super('random@example.com') is False

    def test_empty_email_not_super(self):
        assert self.is_super('') is False


# ── POST /api/query/execute — SELECT ─────────────────────────────────────────

class TestQueryExecuteSelect:
    def _post(self, client, sql):
        return client.post('/api/query/execute', json={'sql': sql})

    def test_empty_sql_returns_400(self, client, mock_query):
        r = self._post(client, '')
        assert r.status_code == 400
        assert r.get_json()['ok'] is False

    def test_missing_sql_key_returns_400(self, client, mock_query):
        r = client.post('/api/query/execute', json={})
        assert r.status_code == 400

    def test_select_returns_rows(self, client, mock_query):
        mock_query.return_value = [{'MemberID': 'A0001', 'Status': 'active'}]
        r = self._post(client, 'SELECT * FROM members')
        assert r.status_code == 200
        j = r.get_json()
        assert j['ok'] is True
        assert j['count'] == 1
        assert j['rows'][0]['MemberID'] == 'A0001'

    def test_select_includes_columns(self, client, mock_query):
        mock_query.return_value = [{'MemberID': 'A0001', 'Status': 'active'}]
        r = self._post(client, 'SELECT * FROM members')
        j = r.get_json()
        assert 'columns' in j
        assert 'MemberID' in j['columns']

    def test_select_empty_result_returns_zero_count(self, client, mock_query):
        mock_query.return_value = []
        r = self._post(client, 'SELECT * FROM members WHERE 1=0')
        j = r.get_json()
        assert j['count'] == 0
        assert j['columns'] == []

    def test_non_super_admin_blocked_on_insert(self, client, mock_query):
        with client.session_transaction() as sess:
            sess['user'] = {'email': 'regular@example.com', 'role': 'admin'}
        r = self._post(client, 'INSERT INTO t VALUES (1)')
        assert r.status_code == 403
        j = r.get_json()
        assert j['ok'] is False
        assert 'SELECT' in j['error']

    def test_non_super_admin_blocked_on_update(self, client, mock_query):
        with client.session_transaction() as sess:
            sess['user'] = {'email': 'regular@example.com', 'role': 'admin'}
        r = self._post(client, 'UPDATE members SET Status="active"')
        assert r.status_code == 403

    def test_non_super_admin_blocked_on_delete(self, client, mock_query):
        with client.session_transaction() as sess:
            sess['user'] = {'email': 'regular@example.com', 'role': 'admin'}
        r = self._post(client, 'DELETE FROM t')
        assert r.status_code == 403

    def test_super_admin_can_run_insert(self, client, mock_query):
        with client.session_transaction() as sess:
            sess['user'] = {'email': 'admin@mmrunners.org', 'role': 'super_admin'}
        with patch('api_query.execute', return_value=1) as mock_exec:
            r = self._post(client, 'INSERT INTO t VALUES (1)')
        assert r.status_code == 200
        assert r.get_json()['ok'] is True

    def test_super_admin_can_run_update(self, client, mock_query):
        with client.session_transaction() as sess:
            sess['user'] = {'email': 'admin@mmrunners.org', 'role': 'super_admin'}
        with patch('api_query.execute', return_value=3):
            r = self._post(client, 'UPDATE members SET Status="active"')
        j = r.get_json()
        assert j['ok'] is True
        assert j['affected'] == 3


# ── POST /api/query/execute — CALL ───────────────────────────────────────────

class TestQueryExecuteCall:
    def _post(self, client, sql):
        return client.post('/api/query/execute', json={'sql': sql})

    def test_call_uses_execute_not_query(self, client, mock_query):
        """CALL statements must go through execute() to commit, not query()."""
        with patch('api_query.execute', return_value=0) as mock_exec:
            r = self._post(client, 'CALL sp_foo()')
        assert r.status_code == 200
        assert mock_exec.called
        # mock_query (SELECT path) should not have been called with this SQL
        for c in mock_query.call_args_list:
            assert 'sp_foo' not in str(c)

    def test_call_response_has_ok_true(self, client, mock_query):
        with patch('api_query.execute', return_value=0):
            r = self._post(client, 'CALL sp_reconcile_member_payments(1)')
        j = r.get_json()
        assert j['ok'] is True
        assert 'message' in j

    def test_call_case_insensitive(self, client, mock_query):
        with patch('api_query.execute', return_value=0):
            r = self._post(client, 'call sp_foo()')
        assert r.status_code == 200


# ── POST /api/query/execute — error handling ──────────────────────────────────

class TestQueryExecuteErrors:
    def _post(self, client, sql):
        return client.post('/api/query/execute', json={'sql': sql})

    def test_db_exception_returns_400(self, client, mock_query):
        mock_query.side_effect = Exception('Table not found')
        r = self._post(client, 'SELECT * FROM nonexistent')
        assert r.status_code == 400
        j = r.get_json()
        assert j['ok'] is False
        assert 'error' in j
        assert 'sql_snippet' in j
        mock_query.side_effect = None

    def test_error_includes_sql_snippet(self, client, mock_query):
        mock_query.side_effect = Exception('boom')
        r = self._post(client, 'SELECT boom FROM nowhere')
        assert 'SELECT boom' in r.get_json()['sql_snippet']
        mock_query.side_effect = None

    def test_long_sql_snippet_truncated(self, client, mock_query):
        mock_query.side_effect = Exception('err')
        long_sql = 'SELECT ' + 'x' * 300
        r = self._post(client, long_sql)
        assert len(r.get_json()['sql_snippet']) <= 100
        mock_query.side_effect = None


# ── GET /api/query/config ─────────────────────────────────────────────────────

class TestQueryConfig:
    def test_returns_config_rows(self, client, mock_query):
        mock_query.return_value = [
            {'ConfigKey': 'renewal_start_date', 'ConfigValue': '2025-10-01'},
            {'ConfigKey': 'renewal_end_date',   'ConfigValue': '2026-03-31'},
        ]
        r = client.get('/api/query/config')
        assert r.status_code == 200
        j = r.get_json()
        assert j['ok'] is True
        assert len(j['data']) == 2

    def test_empty_config_returns_empty_list(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/query/config')
        assert r.status_code == 200
        assert r.get_json()['data'] == []

    def test_db_error_returns_500(self, client, mock_query):
        mock_query.side_effect = Exception('DB error')
        r = client.get('/api/query/config')
        assert r.status_code == 500
        assert r.get_json()['ok'] is False
        mock_query.side_effect = None


# ── GET /api/query/diag ───────────────────────────────────────────────────────

class TestQueryDiagnostics:
    def test_returns_ok(self, client, mock_query):
        mock_query.return_value = [{'result': 1}]
        r = client.get('/api/query/diag')
        assert r.status_code == 200

    def test_response_has_ok_key(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/query/diag')
        j = r.get_json()
        assert 'ok' in j or 'status' in j
