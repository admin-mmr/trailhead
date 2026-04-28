"""
Tests for api_admin.py — GET/POST/DELETE /api/admins.

Coverage target: api_admin.py 73% → ~95% (lines 30-31, 46-57, 67, 72-73).

Run:
    cd mmr-admin
    python3 -m pytest tests/test_api_admin.py -v
"""
import pytest
from unittest.mock import patch


def _admin_row(email='alice@mmrunners.org', role='admin'):
    return {'id': 1, 'email': email, 'role': role, 'created_at': '2026-01-01'}


# ── GET /api/admins ───────────────────────────────────────────────────────────

class TestGetAdmins:
    def test_returns_admin_list(self, client, mock_query):
        mock_query.return_value = [_admin_row()]
        r = client.get('/api/admins')
        assert r.status_code == 200
        j = r.get_json()
        assert j['ok'] is True
        assert isinstance(j['data'], list)
        assert len(j['data']) == 1

    def test_empty_list_ok(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/admins')
        assert r.status_code == 200
        assert r.get_json()['data'] == []

    def test_db_error_returns_500(self, client, mock_query):
        mock_query.side_effect = Exception('DB down')
        r = client.get('/api/admins')
        assert r.status_code == 500
        assert r.get_json()['ok'] is False
        mock_query.side_effect = None

    def test_response_includes_email_and_role(self, client, mock_query):
        mock_query.return_value = [_admin_row('bob@mmrunners.org', 'super_admin')]
        r = client.get('/api/admins')
        row = r.get_json()['data'][0]
        assert row['email'] == 'bob@mmrunners.org'
        assert row['role'] == 'super_admin'


# ── POST /api/admins ──────────────────────────────────────────────────────────

class TestCreateAdmin:
    def _post(self, client, body):
        return client.post('/api/admins', json=body)

    def test_missing_email_returns_400(self, client, mock_query):
        r = self._post(client, {'role': 'admin'})
        assert r.status_code == 400
        assert r.get_json()['ok'] is False

    def test_invalid_email_no_at_returns_400(self, client, mock_query):
        r = self._post(client, {'email': 'notanemail', 'role': 'admin'})
        assert r.status_code == 400

    def test_invalid_role_returns_400(self, client, mock_query):
        r = self._post(client, {'email': 'alice@x.com', 'role': 'hacker'})
        assert r.status_code == 400
        assert 'role' in r.get_json()['error'].lower()

    def test_valid_admin_creation(self, client, mock_query):
        with patch('api_admin.execute') as mock_exec:
            r = self._post(client, {'email': 'alice@x.com', 'role': 'admin'})
        assert r.status_code == 200
        assert r.get_json()['ok'] is True
        assert 'alice@x.com' in r.get_json()['message']

    def test_valid_super_admin_creation(self, client, mock_query):
        with patch('api_admin.execute') as mock_exec:
            r = self._post(client, {'email': 'boss@x.com', 'role': 'super_admin'})
        assert r.status_code == 200
        assert r.get_json()['ok'] is True

    def test_execute_called_with_upsert(self, client, mock_query):
        with patch('api_admin.execute') as mock_exec:
            self._post(client, {'email': 'alice@x.com', 'role': 'admin'})
        sql_call = str(mock_exec.call_args_list[0])
        assert 'INSERT' in sql_call or 'DUPLICATE' in sql_call

    def test_db_error_returns_500(self, client, mock_query):
        with patch('api_admin.execute', side_effect=Exception('DB error')):
            r = self._post(client, {'email': 'alice@x.com', 'role': 'admin'})
        assert r.status_code == 500
        assert r.get_json()['ok'] is False

    def test_empty_body_returns_400(self, client, mock_query):
        r = self._post(client, {})
        assert r.status_code == 400


# ── DELETE /api/admins/<email> ────────────────────────────────────────────────

class TestDeleteAdmin:
    def _delete(self, client, email, session_email='other@mmrunners.org'):
        with client.session_transaction() as sess:
            sess['user'] = {'email': session_email, 'role': 'super_admin'}
        return client.delete(f'/api/admins/{email}')

    def test_cannot_delete_yourself(self, client, mock_query):
        with client.session_transaction() as sess:
            sess['user'] = {'email': 'self@mmrunners.org', 'role': 'super_admin'}
        r = client.delete('/api/admins/self@mmrunners.org')
        assert r.status_code == 400
        assert 'yourself' in r.get_json()['error'].lower()

    def test_valid_delete_returns_ok(self, client, mock_query):
        with patch('api_admin.execute') as mock_exec:
            r = self._delete(client, 'alice@x.com')
        assert r.status_code == 200
        assert r.get_json()['ok'] is True
        assert 'alice@x.com' in r.get_json()['message']

    def test_delete_calls_execute_with_email(self, client, mock_query):
        with patch('api_admin.execute') as mock_exec:
            self._delete(client, 'alice@x.com')
        call_args = str(mock_exec.call_args_list[0])
        assert 'alice@x.com' in call_args

    def test_db_error_returns_500(self, client, mock_query):
        with patch('api_admin.execute', side_effect=Exception('DB error')):
            r = self._delete(client, 'alice@x.com')
        assert r.status_code == 500
        assert r.get_json()['ok'] is False
