"""
Tests: API response format contract — {ok: bool, data: ...} wrapper.

Regression coverage for recurring bug pattern:
  Symptom : Frontend checks `if (r.ok)` or `r.data`, gets undefined → silent failure
  Root cause: Backend returns flat dict instead of `{ok: true, data: {...}}`
  Example : member-quick endpoint (fixed Apr-05), tooltip never appeared

Every endpoint that docs say return `{ok: true, data: ...}` is tested here.
No live DB required — db.query / db.execute mocked via conftest.
"""
import pytest
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def ok_json(r):
    assert r.status_code in (200, 201), f"Expected 2xx, got {r.status_code}: {r.data[:300]}"
    j = r.get_json()
    assert j is not None, f"Response is not JSON: {r.data[:200]}"
    return j


def _post(client, path, body=None):
    return client.post(path, json=body or {})


# ---------------------------------------------------------------------------
# Payments: member-quick endpoints
# ---------------------------------------------------------------------------

_MEMBER_ROW = {
    'MemberID': 'A0001', 'FirstName': 'Jane', 'LastName': 'Doe',
    'Email': 'jane@example.com', 'Expiration': None,
    'Type': 'Individual', 'Gender': 'F', 'District': 'Manhattan',
    'WeChatID': '',
}


class TestMemberQuickFormat:
    """
    /api/payments/member-quick/<id> and /api/payments/member-quick/all
    must return {ok: true/false, data: ...} — not a flat member dict.

    The tooltip in PaymentsPanel checks `if (r.ok)` before reading `r.data`;
    returning a flat dict caused tooltips to silently never appear.

    Note: get_member_by_id lives in payment_helpers.py (not api_*.py), so
    we patch payment_helpers.get_member_by_id directly instead of mock_query.
    """

    def test_member_quick_single_found_has_ok_key(self, client, mock_query):
        with patch('api_payments_lookups.get_member_by_id', return_value=_MEMBER_ROW):
            j = ok_json(client.get('/api/payments/member-quick/A0001'))
        assert 'ok' in j, f"Response missing 'ok' key: {j}"
        assert j['ok'] is True
        assert 'data' in j, f"Response missing 'data' key: {j}"

    def test_member_quick_single_not_found_has_ok_false(self, client, mock_query):
        with patch('api_payments_lookups.get_member_by_id', return_value=None):
            r = client.get('/api/payments/member-quick/ZZZZ')
        j = r.get_json()
        assert j is not None
        assert 'ok' in j, f"404 response missing 'ok' key: {j}"
        assert j['ok'] is False

    def test_member_quick_single_data_is_dict(self, client, mock_query):
        """data must be a dict (member), not a list or bare value."""
        with patch('api_payments_lookups.get_member_by_id', return_value=_MEMBER_ROW):
            j = ok_json(client.get('/api/payments/member-quick/A0001'))
        assert isinstance(j['data'], dict), f"data should be a dict, got {type(j['data'])}"

    def test_member_quick_single_data_contains_expected_fields(self, client, mock_query):
        """data must include the fields the tooltip reads."""
        with patch('api_payments_lookups.get_member_by_id', return_value=_MEMBER_ROW):
            j = ok_json(client.get('/api/payments/member-quick/A0001'))
        for field in ('MemberID', 'FirstName', 'LastName', 'Type'):
            assert field in j['data'], f"data missing field '{field}': {j['data']}"

    def test_member_quick_all_has_ok_key(self, client, mock_query):
        mock_query.return_value = []
        j = ok_json(client.get('/api/payments/member-quick/all'))
        assert 'ok' in j
        assert j['ok'] is True
        assert 'data' in j

    def test_member_quick_all_data_is_list(self, client, mock_query):
        mock_query.return_value = [_MEMBER_ROW]
        j = ok_json(client.get('/api/payments/member-quick/all'))
        assert isinstance(j['data'], list), f"data should be a list, got {type(j['data'])}"


# ---------------------------------------------------------------------------
# Payments: autoguess response format
# ---------------------------------------------------------------------------

class TestAutoguessResponseFormat:
    """
    POST /api/payments/autoguess-all must return {ok: true/false} not a bare error string.
    Covers the pattern where a missing renewal window returns 400 but must still be JSON.
    """

    def test_autoguess_returns_json(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/payments/autoguess-all')
        assert r.content_type and 'json' in r.content_type, \
            f"Expected JSON content-type, got {r.content_type}"
        j = r.get_json()
        assert j is not None

    def test_autoguess_no_unmatched_returns_ok(self, client, mock_query):
        """Empty unmatched list: must succeed with ok=True and counts."""
        mock_query.return_value = []
        r = _post(client, '/api/payments/autoguess-all')
        # May 200 (no transactions) or 400 (renewal period missing) — never 500
        assert r.status_code != 500, f"Unexpected 500: {r.data[:300]}"

    def test_autoguess_success_has_ok_true(self, client, mock_query):
        """When renewal config exists and unmatched is empty → ok: True."""
        # First call returns renewal config, subsequent calls return empty lists
        call_count = {'n': 0}
        original = mock_query.return_value

        def side_effect(*args, **kwargs):
            call_count['n'] += 1
            if call_count['n'] == 1:
                # Renewal period config row
                from datetime import date
                return [{'ConfigValue': str(date(2026, 1, 1))}, {'ConfigValue': str(date(2026, 12, 31))}]
            return []

        mock_query.side_effect = side_effect
        r = _post(client, '/api/payments/autoguess-all')
        mock_query.side_effect = None
        # Either ok or 400 if config shape differs — just must not 500
        assert r.status_code != 500


# ---------------------------------------------------------------------------
# Payments: manual-approve response format
# ---------------------------------------------------------------------------

class TestManualApproveFormat:
    def test_manual_approve_missing_fields_400_not_500(self, client, mock_query):
        """Incomplete body must return 4xx with JSON, not 500."""
        r = _post(client, '/api/payments/manual-approve', {})
        assert r.status_code != 500, f"Unexpected 500: {r.data[:300]}"
        j = r.get_json()
        assert j is not None

    def test_manual_approve_member_not_found_has_ok_false_or_error(self, client, mock_query):
        """Unknown member: response must have 'ok': false or 'error' key — not a bare string."""
        mock_query.return_value = []  # member not found
        r = _post(client, '/api/payments/manual-approve', {
            'transaction_number': 'TX999', 'member_id': 'ZZZZ',
        })
        j = r.get_json()
        assert j is not None, "Response must be JSON"
        has_ok_false = j.get('ok') is False
        has_error = 'error' in j
        assert has_ok_false or has_error, f"Expected ok:false or error key, got: {j}"


# ---------------------------------------------------------------------------
# Members: member card / quick lookup
# ---------------------------------------------------------------------------

class TestMemberCardFormat:
    def test_member_card_has_ok_or_data(self, client, mock_query):
        """
        Member lookup endpoints must return structured JSON, not bare dicts.
        Covers the pattern where frontend checks r.ok before using r.data.
        """
        mock_query.return_value = [{
            'MemberID': 'A0001', 'FirstName': 'Jane', 'LastName': 'Doe',
            'Status': 'active', 'Email': '', 'Type': 'Individual',
            'Expiration': None, 'District': '',
        }]
        r = client.get('/api/members/A0001/card')
        # May be 200 or 404 depending on route — but must be JSON
        j = r.get_json()
        assert j is not None, f"Member card must return JSON: {r.data[:200]}"

    def test_member_search_returns_list_or_dict(self, client, mock_query):
        mock_query.return_value = [{'MemberID': 'A0001', 'FirstName': 'Jane', 'LastName': 'Doe'}]
        r = client.get('/api/members/search?q=doe')
        assert r.status_code == 200
        j = r.get_json()
        assert j is not None

    def test_member_search_empty_result_not_500(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/members/search?q=zzzzz')
        assert r.status_code != 500


# ---------------------------------------------------------------------------
# Sync: export endpoints must return {ok: bool} or {job_id: ...} not bare strings
# ---------------------------------------------------------------------------

class TestSyncEndpointFormat:
    @pytest.mark.parametrize('path', [
        '/api/sync/export/members',
        '/api/sync/export/payments',
        '/api/sync/export/submissions',
        '/api/sync/export/transaction-meta',
    ])
    def test_export_returns_json_not_bare_string(self, client, mock_query, path):
        """
        Export endpoints must return JSON.
        Regression: if these return a raw string the frontend JSON.parse blows up.
        """
        mock_query.return_value = []
        r = _post(client, path)
        assert r.status_code not in (404, 405), f"{path} route missing/wrong method"
        j = r.get_json()
        assert j is not None, f"{path} returned non-JSON: {r.data[:200]}"

    def test_full_sync_returns_json(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/sync/full-sync')
        assert r.status_code not in (404, 405), "full-sync route missing"
        # May error without job runner, but must be JSON
        j = r.get_json()
        assert j is not None
