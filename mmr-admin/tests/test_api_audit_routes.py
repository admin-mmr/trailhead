"""
Tests for api_audit.py — unmatch, config, renewal audit, reconcile.

Coverage target: api_audit.py 48% → ~80%
Uncovered lines: 45, 72, 75, 81-97, 155-157, 161-169, 173-174, 186-300, 337-340.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_api_audit_routes.py -v
"""
import pytest
from unittest.mock import patch


# ── POST /api/audit/unmatch ───────────────────────────────────────────────────

class TestUnmatchTransaction:
    def _post(self, client, body):
        return client.post('/api/audit/unmatch', json=body)

    def test_missing_message_id_returns_400(self, client, mock_query):
        r = self._post(client, {})
        assert r.status_code == 400
        assert 'message_id' in r.get_json()['error'].lower()

    def test_empty_message_id_returns_400(self, client, mock_query):
        r = self._post(client, {'message_id': '  '})
        assert r.status_code == 400

    def test_invalid_json_returns_400(self, client, mock_query):
        r = client.post('/api/audit/unmatch',
                        data='not-json', content_type='application/json')
        assert r.status_code == 400

    def test_valid_unmatch_returns_success(self, client, mock_query):
        with patch('api_audit.execute') as mock_exec:
            r = self._post(client, {'message_id': 'MSG-ABC123'})
        assert r.status_code == 200
        j = r.get_json()
        assert j['success'] is True
        assert j['message_id'] == 'MSG-ABC123'

    def test_unmatch_calls_execute_with_message_id(self, client, mock_query):
        with patch('api_audit.execute') as mock_exec:
            self._post(client, {'message_id': 'MSG-XYZ'})
        call_str = str(mock_exec.call_args_list[0])
        assert 'MSG-XYZ' in call_str

    def test_unmatch_sql_clears_payment_id(self, client, mock_query):
        with patch('api_audit.execute') as mock_exec:
            self._post(client, {'message_id': 'MSG001'})
        sql = mock_exec.call_args_list[0][0][0]
        assert 'PaymentID' in sql
        assert 'NULL' in sql

    def test_db_error_propagates(self, client, mock_query):
        with patch('api_audit.execute', side_effect=Exception('DB down')):
            r = self._post(client, {'message_id': 'MSG001'})
        # handle_api_errors wraps it → 500
        assert r.status_code == 500

    def test_string_body_parsed_correctly(self, client, mock_query):
        """Handles double-encoded JSON (string body)."""
        import json
        with patch('api_audit.execute'):
            r = client.post('/api/audit/unmatch',
                            data=json.dumps(json.dumps({'message_id': 'MSG-STR'})),
                            content_type='application/json')
        # Should parse successfully or return 400 — must not 500
        assert r.status_code in (200, 400)


# ── GET /api/config/get ───────────────────────────────────────────────────────

class TestConfigGet:
    def test_missing_key_param_returns_400(self, client, mock_query):
        r = client.get('/api/config/get')
        assert r.status_code == 400

    def test_known_key_returns_value(self, client, mock_query):
        with patch('api_audit.get_config', return_value='2026-03-31'):
            r = client.get('/api/config/get?key=renewal_end_date')
        assert r.status_code == 200
        j = r.get_json()
        assert j['success'] is True
        assert j['value'] == '2026-03-31'
        assert j['key'] == 'renewal_end_date'

    def test_unknown_key_returns_none_value(self, client, mock_query):
        with patch('api_audit.get_config', return_value=None):
            r = client.get('/api/config/get?key=no_such_key')
        assert r.status_code == 200
        assert r.get_json()['value'] is None

    def test_key_echoed_in_response(self, client, mock_query):
        with patch('api_audit.get_config', return_value='x'):
            r = client.get('/api/config/get?key=MyKey')
        assert r.get_json()['key'] == 'MyKey'


# ── POST /api/audit/renewal ───────────────────────────────────────────────────

class TestRenewalAudit:
    def _post(self, client, body):
        return client.post('/api/audit/renewal', json=body)

    def _valid_body(self):
        return {
            'start_date': '2025-10-01',
            'end_date': '2026-03-31',
            'target_expiration': '2027-03-31',
        }

    def test_missing_start_date_returns_400(self, client, mock_query):
        body = self._valid_body()
        del body['start_date']
        r = self._post(client, body)
        assert r.status_code == 400

    def test_missing_end_date_returns_400(self, client, mock_query):
        body = self._valid_body()
        del body['end_date']
        r = self._post(client, body)
        assert r.status_code == 400

    def test_missing_target_expiration_returns_400(self, client, mock_query):
        body = self._valid_body()
        del body['target_expiration']
        r = self._post(client, body)
        assert r.status_code == 400

    def test_empty_body_returns_400(self, client, mock_query):
        r = self._post(client, {})
        assert r.status_code == 400

    def test_valid_request_returns_success(self, client, mock_query):
        # Audit queries DB for transactions and members
        mock_query.return_value = []
        r = self._post(client, self._valid_body())
        assert r.status_code == 200
        j = r.get_json()
        assert j['success'] is True
        assert 'audit_results' in j
        assert 'summary' in j

    def test_audit_results_is_list(self, client, mock_query):
        mock_query.return_value = []
        r = self._post(client, self._valid_body())
        assert isinstance(r.get_json()['audit_results'], list)

    def test_summary_contains_counts(self, client, mock_query):
        mock_query.return_value = []
        r = self._post(client, self._valid_body())
        summary = r.get_json()['summary']
        assert isinstance(summary, dict)

    def test_with_matching_transactions(self, client, mock_query):
        txn_rows = [{
            'TransactionNumber': 'TX001', 'Sender': 'Jane Lin',
            'Amount': 30.0, 'Memo': 'A0001 renewal',
            'TransactionDate': '2025-11-01', 'Notes': None,
        }]
        mock_query.return_value = txn_rows
        r = self._post(client, self._valid_body())
        assert r.status_code == 200

    def test_non_dict_body_returns_400(self, client, mock_query):
        r = client.post('/api/audit/renewal',
                        data='"just a string"',
                        content_type='application/json')
        assert r.status_code == 400


# ── POST /api/audit/reconcile ────────────────────────────────────────────────

class TestReconcilePayments:
    def _post(self, client, body=None):
        return client.post('/api/audit/reconcile', json=body or {})

    def test_dry_run_true_by_default(self, client, mock_query):
        mock_query.return_value = []
        r = self._post(client)
        assert r.status_code == 200
        j = r.get_json()
        assert j['dry_run'] is True

    def test_dry_run_false_executes(self, client, mock_query):
        mock_query.return_value = []
        r = self._post(client, {'dry_run': False})
        assert r.status_code == 200
        assert r.get_json()['dry_run'] is False

    def test_returns_rows_and_count(self, client, mock_query):
        mock_query.return_value = [{'MemberID': 'A0001', 'OldStatus': 'pending', 'NewStatus': 'active'}]
        r = self._post(client, {'dry_run': True})
        assert r.status_code == 200
        j = r.get_json()
        assert j['success'] is True
        assert 'rows' in j
        assert 'count' in j

    def test_empty_results_returns_zero_count(self, client, mock_query):
        mock_query.return_value = []
        r = self._post(client)
        j = r.get_json()
        assert j['count'] == 0
        assert j['rows'] == []

    def test_db_error_returns_500_with_error(self, client, mock_query):
        mock_query.side_effect = Exception('Stored proc error')
        r = self._post(client)
        assert r.status_code == 500
        j = r.get_json()
        assert j['success'] is False
        assert 'error' in j
        mock_query.side_effect = None

    def test_stored_proc_called(self, client, mock_query):
        mock_query.return_value = []
        self._post(client, {'dry_run': True})
        call_str = str(mock_query.call_args_list[0])
        assert 'sp_reconcile_member_payments' in call_str

    def test_dry_run_param_forwarded_to_sql(self, client, mock_query):
        mock_query.return_value = []
        self._post(client, {'dry_run': False})
        call_args = mock_query.call_args_list[0][0][1]
        assert False in call_args or 0 in call_args


# ── _serialize_for_json ───────────────────────────────────────────────────────

class TestSerializeForJson:
    """Unit tests for the _serialize_for_json helper."""

    def setup_method(self):
        from api_audit import _serialize_for_json
        self.serialize = _serialize_for_json

    def test_none_returns_none(self):
        # None is not a dict/list/date — passes through unchanged
        assert self.serialize(None) is None

    def test_empty_list_returns_empty_list(self):
        assert self.serialize([]) == []

    def test_plain_dict_rows_passed_through(self):
        rows = [{'MemberID': 'A0001', 'Status': 'active'}]
        result = self.serialize(rows)
        assert result == rows

    def test_date_values_converted_to_strings(self):
        from datetime import date, datetime
        rows = [{'Expires': date(2027, 3, 31), 'UpdatedAt': datetime(2026, 1, 1, 12, 0)}]
        result = self.serialize(rows)
        assert isinstance(result[0]['Expires'], str)
        assert isinstance(result[0]['UpdatedAt'], str)

    def test_bytes_values_passed_through(self):
        # _serialize_for_json has no bytes handler — passes bytes unchanged
        rows = [{'Data': b'hello'}]
        result = self.serialize(rows)
        assert result[0]['Data'] == b'hello'

    def test_none_values_preserved(self):
        rows = [{'Field': None}]
        result = self.serialize(rows)
        assert result[0]['Field'] is None

    def test_multiple_rows_all_serialized(self):
        from datetime import date
        rows = [
            {'MemberID': 'A0001', 'Expires': date(2027, 1, 1)},
            {'MemberID': 'A0002', 'Expires': date(2027, 6, 1)},
        ]
        result = self.serialize(rows)
        assert len(result) == 2
        assert isinstance(result[0]['Expires'], str)
        assert isinstance(result[1]['Expires'], str)
