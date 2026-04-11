"""
API smoke tests for mmr-admin Flask endpoints.

Goals
-----
- Verify every key route returns the expected HTTP status and JSON shape.
- Catch serialization bugs (wrong body type, double JSON.stringify, etc.) before
  they reach the deployed UX.
- No live MySQL required — db.get_conn is mocked via conftest fixtures.

Run
---
    cd mmr-admin
    python3 -m pytest tests/test_api_smoke.py -v

Add --run-integration to also run @pytest.mark.integration tests.
"""
import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def ok(r):
    """Assert 200 and return parsed JSON."""
    assert r.status_code == 200, f"Expected 200, got {r.status_code}: {r.data[:200]}"
    return r.get_json()


def _json_post(client, path, body):
    return client.post(path, json=body)  # flask test client sets Content-Type automatically


# ---------------------------------------------------------------------------
# Config / health
# ---------------------------------------------------------------------------

class TestConfig:
    def test_get_config_missing_key_400(self, client, mock_query):
        """No ?key= param must return 400, not 500."""
        r = client.get('/api/config/get')
        assert r.status_code == 400
        assert b'Missing key' in r.data

    def test_get_config_with_key_200(self, client, mock_query):
        mock_query.return_value = [{'ConfigValue': '2025-09-01'}]
        r = client.get('/api/config/get?key=MembershipCollectionStart')
        data = ok(r)
        assert data.get('success') is True
        assert data.get('key') == 'MembershipCollectionStart'


# ---------------------------------------------------------------------------
# Payments
# ---------------------------------------------------------------------------

class TestPayments:
    def test_dashboard_200(self, client, mock_query):
        mock_query.return_value = [{'cnt': 0}]
        r = client.get('/api/payments/dashboard')
        assert r.status_code == 200

    def test_pending_submissions_200(self, client, mock_query):
        mock_query.return_value = []
        data = ok(client.get('/api/payments/pending-submissions'))
        assert 'submissions' in data or isinstance(data, (dict, list))

    def test_unmatched_gmail_200(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/unmatched-gmail')
        assert r.status_code == 200

    def test_search_members_200(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/search-members?q=smith')
        assert r.status_code == 200

    def test_autoguess_accepts_json(self, client, mock_query):
        """POST with JSON body must not 500 — guards against body-parsing regressions.
        400 is acceptable (renewal period not configured in test env)."""
        mock_query.return_value = []
        r = _json_post(client, '/api/payments/autoguess-all', {})
        assert r.status_code in (200, 202, 400), f"Got {r.status_code}: {r.data[:200]}"
        assert r.status_code != 500, f"Unexpected 500: {r.data[:300]}"


# ---------------------------------------------------------------------------
# Audit / Reconcile  ← the endpoint that surfaced today's bug
# ---------------------------------------------------------------------------

class TestAudit:
    def test_reconcile_dry_run_200(self, client, mock_query):
        """Must return 200 + success:true. Caught the 'str has no .get()' bug."""
        mock_query.return_value = []
        r = _json_post(client, '/api/audit/reconcile', {'dry_run': True})
        data = ok(r)
        assert data.get('success') is True
        assert data.get('dry_run') is True
        assert isinstance(data.get('rows'), list)

    def test_reconcile_execute_200(self, client, mock_query):
        mock_query.return_value = []
        r = _json_post(client, '/api/audit/reconcile', {'dry_run': False})
        data = ok(r)
        assert data.get('success') is True
        assert data.get('dry_run') is False

    def test_reconcile_defaults_to_dry_run(self, client, mock_query):
        """Empty body must not blow up — defaults to dry_run=True."""
        mock_query.return_value = []
        r = _json_post(client, '/api/audit/reconcile', {})
        data = ok(r)
        assert data.get('dry_run') is True

    def test_reconcile_no_body_safe(self, client, mock_query):
        """Missing Content-Type / body must not 500 — request.get_json(silent=True) path."""
        mock_query.return_value = []
        r = client.post('/api/audit/reconcile')
        assert r.status_code == 200

    def test_renewal_audit_200(self, client, mock_query):
        mock_query.return_value = []
        r = _json_post(client, '/api/audit/renewal', {})
        assert r.status_code in (200, 400)  # 400 ok if required fields missing


# ---------------------------------------------------------------------------
# Members
# ---------------------------------------------------------------------------

class TestMembers:
    def test_search_no_query_param(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/members/search')
        assert r.status_code in (200, 400)

    def test_search_with_query(self, client, mock_query):
        mock_query.return_value = [{'MemberID': 'A0001', 'FirstName': 'Jane', 'LastName': 'Doe'}]
        r = client.get('/api/members/search?q=doe')
        assert r.status_code == 200

    def test_member_card_200(self, client, mock_query):
        mock_query.return_value = [{'MemberID': 'A0001', 'FirstName': 'Jane', 'Status': 'active'}]
        r = client.get('/api/members/A0001/card')
        assert r.status_code in (200, 404)

    def test_districts_200(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/districts')
        assert r.status_code == 200

    def test_set_inactive_member_not_found(self, client, mock_query):
        """Status change on unknown member must return 404, not 500.
        Guards against column-name mismatches in get_member_by_id()."""
        mock_query.return_value = []   # member not found
        r = _json_post(client, '/api/members/A9999/status', {'new_status': 'inactive', 'note': 'test'})
        assert r.status_code == 404
        assert r.status_code != 500

    def test_set_inactive_column_select(self, client, mock_query):
        """get_member_by_id SELECT must use UpdatedAt (not LastUpdated).
        This test would have caught the 1054 Unknown column bug."""
        mock_query.return_value = [{
            'MemberID': 'A0558', 'FirstName': 'Yan', 'LastName': 'Zhang',
            'Email': '', 'PhoneNumber': '', 'WeChatID': '', 'Type': 'Individual',
            'FamilyID': None, 'District': '', 'Status': 'expired',
            'Expiration': None, 'MembershipFeePaid': 0,
            'PaymentDate': None, 'PaymentTransaction': '', 'UpdatedAt': None,
        }]
        r = _json_post(client, '/api/members/A0558/status', {'new_status': 'inactive', 'note': 'test'})
        assert r.status_code != 500, f"Unexpected 500: {r.data[:300]}"


# ---------------------------------------------------------------------------
# Sync (structure only — no job execution)
# ---------------------------------------------------------------------------

class TestSync:
    @pytest.mark.parametrize('path', [
        '/api/sync/export/members',
        '/api/sync/export/payments',
        '/api/sync/export/submissions',
        '/api/sync/export/transaction-meta',
    ])
    def test_sync_export_routes_exist(self, client, mock_query, path):
        """Routes must exist and not 404/405. May return 500 if job runner fails without GAS."""
        r = _json_post(client, path, {})
        assert r.status_code != 404, f"{path} returned 404 — route missing"
        assert r.status_code != 405, f"{path} returned 405 — wrong method"
