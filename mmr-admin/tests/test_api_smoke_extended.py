"""
Extended API smoke tests — covers every route not already in test_api_smoke.py.

Goal: every endpoint must:
  - Return the expected HTTP method (not 404/405)
  - Return JSON (not a bare string, not HTML)
  - Return 2xx or 4xx — NEVER 5xx

Tests here are intentionally minimal. The point is pre-deployment assurance
that each route is reachable and doesn't crash on an empty/missing request.
Deeper behavioral tests live in the domain-specific files.

No live DB required — db.query / db.execute mocked via conftest.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_api_smoke_extended.py -v
"""

import pytest
from unittest.mock import patch, MagicMock


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ok(r, *, allow_status=(200, 201, 202, 204)):
    """Assert expected status and return JSON (or None for 204)."""
    assert r.status_code in allow_status, \
        f"Expected {allow_status}, got {r.status_code}: {r.data[:300]}"
    return r.get_json() if r.status_code != 204 else None


def _no500(r):
    """Route exists, returns JSON, never 5xx."""
    assert r.status_code not in (404, 405), \
        f"Route missing/wrong method: {r.status_code} — {r.data[:200]}"
    assert r.status_code < 500, \
        f"Unexpected 5xx: {r.status_code} — {r.data[:300]}"
    j = r.get_json()
    assert j is not None, f"Response is not JSON: {r.data[:200]}"
    return j


def _post(client, path, body=None):
    return client.post(path, json=body or {})

def _put(client, path, body=None):
    return client.put(path, json=body or {})

def _delete(client, path):
    return client.delete(path)


# ---------------------------------------------------------------------------
# Data / connection / utility
# ---------------------------------------------------------------------------

class TestDataEndpoints:
    def test_version(self, client, mock_query):
        r = client.get('/api/version')
        _no500(r)

    def test_connection_config(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/connection/config')
        _no500(r)

    def test_connection_presets(self, client, mock_query):
        r = client.get('/api/connection/presets')
        _no500(r)

    def test_connection_set_no_body(self, client, mock_query):
        """Missing body must return 4xx not 5xx."""
        r = _post(client, '/api/connection/set')
        assert r.status_code < 500, f"5xx on empty body: {r.data[:200]}"

    def test_log_200(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/log')
        _no500(r)

    def test_tables_200(self, client, mock_query):
        mock_query.return_value = [{'TABLE_NAME': 'members'}]
        r = client.get('/api/tables')
        _no500(r)

    def test_table_data_200(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/tables/members')
        _no500(r)

    def test_user_settings_get(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/user-settings/members')
        _no500(r)

    def test_user_settings_put(self, client, mock_query):
        mock_query.return_value = []
        r = _put(client, '/api/user-settings/members', {'visible_columns': ['MemberID']})
        assert r.status_code < 500, f"5xx: {r.data[:200]}"

    def test_backfill_unix_timestamps(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/backfill-unix-timestamps')
        assert r.status_code < 500, f"5xx: {r.data[:200]}"

    def test_export_schema(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/export-schema')
        assert r.status_code < 500

    def test_export_schema_ddl(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/export-schema-ddl')
        assert r.status_code < 500

    def test_me_endpoint(self, client, mock_query):
        """GET /api/me returns current user or 401."""
        r = client.get('/api/me')
        assert r.status_code in (200, 401, 403), \
            f"Expected 200/401/403 for /api/me, got {r.status_code}"


# ---------------------------------------------------------------------------
# Admins
# ---------------------------------------------------------------------------

class TestAdminEndpoints:
    def test_list_admins(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/admins')
        _no500(r)

    def test_create_admin_no_body(self, client, mock_query):
        r = _post(client, '/api/admins')
        assert r.status_code < 500, f"5xx: {r.data[:200]}"

    def test_delete_admin(self, client, mock_query):
        mock_query.return_value = []
        r = _delete(client, '/api/admins/test@example.com')
        assert r.status_code in (200, 204, 404, 422), \
            f"Unexpected status {r.status_code}: {r.data[:200]}"
        assert r.status_code < 500



# ---------------------------------------------------------------------------
# Audit
# ---------------------------------------------------------------------------

class TestAuditExtended:
    def test_unmatch_no_body(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/audit/unmatch')
        assert r.status_code < 500, f"5xx: {r.data[:200]}"
        j = r.get_json()
        assert j is not None, "Response must be JSON"

    def test_unmatch_with_ids(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/audit/unmatch', {'payment_id': 'P001'})
        assert r.status_code < 500


# ---------------------------------------------------------------------------
# Districts
# ---------------------------------------------------------------------------

class TestDistrictEndpoints:
    def test_district_list(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/district/list')
        _no500(r)

    def test_district_districts(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/district/districts')
        _no500(r)

    def test_district_export_csv(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/district/export-csv')
        assert r.status_code < 500

    def test_district_export_all_districts(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/district/export-all-districts')
        assert r.status_code < 500

    def test_district_export_all_sheet(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/district/export-all-sheet')
        assert r.status_code < 500


# ---------------------------------------------------------------------------
# Members (extended)
# ---------------------------------------------------------------------------

class TestMembersExtended:
    def test_member_family_not_found(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/members/A0001/family')
        assert r.status_code in (200, 404)
        assert r.status_code < 500
        j = r.get_json()
        assert j is not None

    def test_member_overrides(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/members/A0001/overrides')
        assert r.status_code < 500
        j = r.get_json()
        assert j is not None

    def test_member_revert_status_no_body(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/members/A0001/revert-status')
        assert r.status_code < 500

    def test_member_revert_status_not_found(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/members/ZZZZ/revert-status', {'note': 'test'})
        assert r.status_code in (200, 400, 404, 422)
        assert r.status_code < 500

    # ── Mark Active ──────────────────────────────────────────────

    def test_mark_active_no_note(self, client, mock_query):
        """Missing note → 400."""
        mock_query.return_value = [{'MemberID': 'A0001', 'Status': 'expired',
                                    'FirstName': 'Jane', 'LastName': 'Doe',
                                    'Email': '', 'PhoneNumber': '', 'WeChatID': '',
                                    'Type': 'individual', 'FamilyID': None,
                                    'District': '', 'Expiration': None,
                                    'MembershipFeePaid': None, 'PaymentDate': None,
                                    'PaymentTransaction': None, 'UpdatedAt': None}]
        r = _post(client, '/api/members/A0001/mark-active', {})
        assert r.status_code == 400
        j = r.get_json()
        assert j['ok'] is False
        assert 'note' in j['error'].lower()

    def test_mark_active_member_not_found(self, client, mock_query):
        """Unknown member → 404."""
        mock_query.return_value = []  # get_member_by_id returns nothing
        r = _post(client, '/api/members/ZZZZ/mark-active', {'note': 'test'})
        assert r.status_code == 404
        j = r.get_json()
        assert j['ok'] is False

    def test_mark_active_year_end_not_configured(self, client, mock_query):
        """MembershipYearEnd missing from config → 400."""
        member_row = [{'MemberID': 'A0001', 'Status': 'expired',
                       'FirstName': 'Jane', 'LastName': 'Doe',
                       'Email': '', 'PhoneNumber': '', 'WeChatID': '',
                       'Type': 'individual', 'FamilyID': None,
                       'District': '', 'Expiration': None,
                       'MembershipFeePaid': None, 'PaymentDate': None,
                       'PaymentTransaction': None, 'UpdatedAt': None}]
        # First call (get_member_by_id) returns a member; second (config) returns empty
        mock_query.side_effect = [member_row, []]
        r = _post(client, '/api/members/A0001/mark-active', {'note': 'test'})
        assert r.status_code == 400
        j = r.get_json()
        assert j['ok'] is False
        assert 'MembershipYearEnd' in j['error']

    def test_mark_active_success(self, client, mock_query):
        """Happy path: member found, year-end in config, SP called, returns updated member."""
        member_row = [{'MemberID': 'A0001', 'Status': 'expired',
                       'FirstName': 'Jane', 'LastName': 'Doe',
                       'Email': '', 'PhoneNumber': '', 'WeChatID': '',
                       'Type': 'individual', 'FamilyID': None,
                       'District': '', 'Expiration': None,
                       'MembershipFeePaid': None, 'PaymentDate': None,
                       'PaymentTransaction': None, 'UpdatedAt': None}]
        updated_row = [{**member_row[0], 'Status': 'active', 'Expiration': '2025-12-31'}]
        config_row = [{'ConfigValue': '2025-12-31'}]
        # Calls: get_member_by_id → config → get_member_by_id (updated)
        mock_query.side_effect = [member_row, config_row, updated_row]
        with patch('api_members_status.execute'):
            r = _post(client, '/api/members/A0001/mark-active', {'note': 'Manual renewal'})
        assert r.status_code == 200
        j = r.get_json()
        assert j['ok'] is True
        assert j['data']['expiration_set'] == '2025-12-31'
        assert j['data']['updated_member']['Status'] == 'active'

    def test_config_year_end_not_set(self, client, mock_query):
        """GET config/year-end with no row in config → 404."""
        mock_query.return_value = []
        r = client.get('/api/members/config/year-end')
        assert r.status_code == 404
        j = r.get_json()
        assert j['ok'] is False

    def test_config_year_end_success(self, client, mock_query):
        """GET config/year-end returns the date string."""
        mock_query.return_value = [{'ConfigValue': '2025-12-31'}]
        r = client.get('/api/members/config/year-end')
        assert r.status_code == 200
        j = r.get_json()
        assert j['ok'] is True
        assert j['data']['year_end'] == '2025-12-31'

    def test_member_district_update(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/members/A0001/district', {'district': 'Manhattan'})
        assert r.status_code < 500

    def test_family_add_member_no_body(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/members/family/add-member')
        assert r.status_code in (200, 400, 422)
        assert r.status_code < 500

    def test_family_remove_member_no_body(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/members/family/remove-member')
        assert r.status_code in (200, 400, 422)
        assert r.status_code < 500

    def test_family_assign_family_id_no_body(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/members/family/assign-family-id')
        assert r.status_code in (200, 400, 422)
        assert r.status_code < 500


# ---------------------------------------------------------------------------
# Payments (extended — routes not in test_api_smoke.py or test_api_response_format.py)
# ---------------------------------------------------------------------------

class TestPaymentsExtended:
    def test_payment_history(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/history')
        assert r.status_code < 500
        j = r.get_json()
        assert j is not None

    def test_autoguess_log(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/autoguess-log')
        assert r.status_code < 500
        j = r.get_json()
        assert j is not None

    def test_submissions_for_member(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/submissions-for-member/A0001')
        assert r.status_code < 500
        j = r.get_json()
        assert j is not None

    def test_gmail_matching_candidates(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/gmail-matching-candidates/A0001')
        assert r.status_code < 500

    def test_gmail_candidates(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/gmail-candidates/SUB001')
        assert r.status_code < 500

    def test_debug_candidates(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/debug-candidates/SUB001')
        assert r.status_code < 500

    def test_debug_match(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/debug/match/SUB001')
        assert r.status_code < 500

    def test_debug_autoguess(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/debug-autoguess/TX001')
        assert r.status_code < 500

    def test_test_fuzzy_match(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/test-fuzzy-match/SUB001')
        assert r.status_code < 500

    def test_cancel_payment_returns_ok(self, client, mock_query):
        """Cancel must return 200 ok:true. Uses execute() (commits), not query()."""
        with patch('api_payments.execute', return_value=1):
            r = _post(client, '/api/payments/cancel/PAY_NOPE')
        assert r.status_code == 200
        j = r.get_json()
        assert j is not None and j.get('ok') is True

    def test_admin_create_no_body(self, client, mock_query):
        """Missing body must return 4xx not 5xx."""
        mock_query.return_value = []
        r = _post(client, '/api/payments/admin-create')
        assert r.status_code in (200, 400, 422), \
            f"Expected 2xx or 4xx for empty body, got {r.status_code}: {r.data[:200]}"
        assert r.status_code < 500

    def test_admin_create_json_response(self, client, mock_query):
        """Response must always be JSON, never a bare string."""
        mock_query.return_value = []
        r = _post(client, '/api/payments/admin-create', {'member_id': 'ZZZZ'})
        j = r.get_json()
        assert j is not None, f"admin-create returned non-JSON: {r.data[:200]}"
        assert r.status_code < 500


# ---------------------------------------------------------------------------
# Events
# ---------------------------------------------------------------------------

class TestEventEndpoints:
    def test_events_list(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/events')
        _no500(r)

    def test_event_by_id(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/events/1')
        assert r.status_code in (200, 404)
        assert r.status_code < 500

    def test_event_runners(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/events/1/runners')
        assert r.status_code < 500

    def test_event_automatch(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/events/1/automatch')
        assert r.status_code < 500

    def test_stats(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/stats')
        _no500(r)

    def test_stats_years(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/stats/years')
        _no500(r)


# ---------------------------------------------------------------------------
# Runners
# ---------------------------------------------------------------------------

class TestRunnerEndpoints:
    def test_runners_search(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/runners/search')
        _no500(r)

    def test_runner_history(self, client, mock_query):
        """
        Runner history calls the external NYRR API — mock NyrrApiClient.get_runner_races
        so the test doesn't make a real network request.
        """
        mock_query.return_value = []
        with patch('nyrr_api.NyrrApiClient') as mock_nyrr:
            mock_instance = MagicMock()
            mock_instance.get_runner_races.return_value = []
            mock_nyrr.return_value = mock_instance
            r = client.get('/api/runner/123/history')
        _no500(r)

    def test_runner_match_post(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/runners/1/match', {'member_id': 'A0001'})
        assert r.status_code < 500

    def test_runner_match_delete(self, client, mock_query):
        mock_query.return_value = []
        r = _delete(client, '/api/runners/1/match')
        assert r.status_code < 500


# ---------------------------------------------------------------------------
# NYRR sync / load
# ---------------------------------------------------------------------------

class TestNyrrSyncEndpoints:
    def test_load_event(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/load/1')
        assert r.status_code < 500

    def test_load_cancel(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/load/EVENT-CODE/cancel')
        assert r.status_code < 500

    def test_load_status(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/load/EVENT-CODE/status')
        assert r.status_code < 500

    def test_sync_membership_fees(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/sync/membership-fees')
        assert r.status_code < 500

    def test_sync_members_lastupdated(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/sync/members-lastupdated')
        assert r.status_code < 500


# ---------------------------------------------------------------------------
# Sheets sync (extended — import routes)
# ---------------------------------------------------------------------------

class TestSyncImportEndpoints:
    def test_import_members(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/sync/import/members')
        assert r.status_code not in (404, 405), "Route missing"
        assert r.status_code < 500

    def test_import_transactions(self, client, mock_query):
        mock_query.return_value = []
        r = _post(client, '/api/sync/import/transactions')
        assert r.status_code not in (404, 405), "Route missing"
        assert r.status_code < 500

    def test_sync_jobs_list(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/sync/jobs')
        _no500(r)

    def test_sync_job_status(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/sync/status/fake-job-id')
        assert r.status_code in (200, 404)
        assert r.status_code < 500
        j = r.get_json()
        assert j is not None


# ---------------------------------------------------------------------------
# Python exec
# ---------------------------------------------------------------------------

class TestPyExecEndpoints:
    def test_py_exec_health(self, client, mock_query):
        r = client.get('/api/py-exec/health')
        _no500(r)

    def test_py_exec_list(self, client, mock_query):
        r = client.get('/api/py-exec/list')
        _no500(r)

    def test_py_exec_code_no_body(self, client, mock_query):
        """Missing code must return 4xx not 5xx."""
        r = _post(client, '/api/py-exec/code')
        assert r.status_code < 500

    def test_py_exec_run_unknown_fn(self, client, mock_query):
        r = _post(client, '/api/py-exec/run/nonexistent_function')
        assert r.status_code in (200, 400, 404, 422)
        assert r.status_code < 500


# ---------------------------------------------------------------------------
# Query endpoint
# ---------------------------------------------------------------------------

class TestQueryEndpoints:
    def test_query_config(self, client, mock_query):
        r = client.get('/api/query/config')
        _no500(r)

    def test_query_diag(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/query/diag')
        _no500(r)

    def test_query_execute_no_body(self, client, mock_query):
        r = _post(client, '/api/query/execute')
        assert r.status_code < 500

    def test_query_execute_safe_query(self, client, mock_query):
        """A SELECT query must not 5xx."""
        mock_query.return_value = [{'count': 5}]
        r = _post(client, '/api/query/execute', {'sql': 'SELECT COUNT(*) FROM members'})
        assert r.status_code < 500
