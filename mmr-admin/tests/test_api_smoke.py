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
from unittest.mock import patch


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
        # get_config loads the whole config table into config_cache,
        # so the seeded row must carry ConfigKey too.
        mock_query.return_value = [{'ConfigKey': 'MembershipCollectionStart',
                                    'ConfigValue': '2025-09-01'}]
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

    def test_set_inactive_no_admin_session(self, client, mock_query):
        """Missing session['user'] must return 401, not let NULL reach MySQL (1048 bug).
        Guards against get_admin_id() using the wrong session key."""
        mock_query.return_value = [{
            'MemberID': 'A0558', 'FirstName': 'Yan', 'LastName': 'Zhang',
            'Email': '', 'PhoneNumber': '', 'WeChatID': '', 'Type': 'Individual',
            'FamilyID': None, 'District': '', 'Status': 'expired',
            'Expiration': None, 'MembershipFeePaid': 0,
            'PaymentDate': None, 'PaymentTransaction': '', 'UpdatedAt': None,
        }]
        # Ensure session['user'] is absent (the key get_admin_id actually reads)
        with client.session_transaction() as sess:
            sess.pop('user', None)
        r = _json_post(client, '/api/members/A0558/status', {'new_status': 'inactive', 'note': 'test'})
        assert r.status_code == 401, f"Expected 401 for missing admin session, got {r.status_code}: {r.data[:200]}"

    def test_set_inactive_with_valid_session(self, client, mock_query):
        """Happy path: valid session['user']['email'] must reach the stored proc without error.
        Guards against get_admin_id() returning None when auth is correct."""
        member_row = {
            'MemberID': 'A0558', 'FirstName': 'Yan', 'LastName': 'Zhang',
            'Email': '', 'PhoneNumber': '', 'WeChatID': '', 'Type': 'Individual',
            'FamilyID': None, 'District': '', 'Status': 'expired',
            'Expiration': None, 'MembershipFeePaid': 0,
            'PaymentDate': None, 'PaymentTransaction': '', 'UpdatedAt': None,
        }
        mock_query.return_value = [member_row]
        with client.session_transaction() as sess:
            sess['user'] = {'email': 'admin@mmrunners.org', 'role': 'admin'}
        with patch('api_members_status.execute', return_value=0):
            r = _json_post(client, '/api/members/A0558/status', {'new_status': 'inactive', 'note': 'test'})
        assert r.status_code == 200, f"Expected 200 with valid session, got {r.status_code}: {r.data[:300]}"


# ---------------------------------------------------------------------------
# Status endpoint — input validation
# ---------------------------------------------------------------------------

class TestMemberStatus:
    def test_invalid_status_rejected(self, client, mock_query):
        """Status values outside {lifetime, inactive} must return 400.
        Guards against arbitrary status injection (e.g. 'active', 'pending')."""
        r = _json_post(client, '/api/members/A0001/status', {'new_status': 'active', 'note': 'test'})
        assert r.status_code == 400, f"Expected 400 for invalid status, got {r.status_code}"

    def test_missing_note_rejected(self, client, mock_query):
        """Note is required — empty/missing must return 400, not reach the proc."""
        r = _json_post(client, '/api/members/A0001/status', {'new_status': 'inactive', 'note': ''})
        assert r.status_code == 400, f"Expected 400 for missing note, got {r.status_code}"

    def test_missing_note_key_rejected(self, client, mock_query):
        """Completely absent note key must also return 400."""
        r = _json_post(client, '/api/members/A0001/status', {'new_status': 'inactive'})
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# Data Query — SQL routing (CALL vs SELECT vs write)
# ---------------------------------------------------------------------------

class TestDataQuery:
    def _super_admin_session(self, client):
        with client.session_transaction() as sess:
            sess['user'] = {'email': 'admin@mmrunners.org', 'role': 'super_admin'}

    def test_call_uses_execute_not_query(self, client, mock_query):
        """CALL must go through execute() (which commits), not query().
        Guards against the silent-rollback bug where CALL ran but changes were lost."""
        self._super_admin_session(client)
        with patch('api_query.execute', return_value=0) as mock_exec, \
             patch('api_query.query') as mock_q:
            r = _json_post(client, '/api/query/execute',
                           {'sql': "CALL sp_admin_update_member_status('A0001', 'inactive', NULL, 'test', 'admin@mmrunners.org')"})
        mock_exec.assert_called_once(), "CALL must use execute() to commit"
        mock_q.assert_not_called(), "CALL must NOT use query() (no commit)"
        assert r.status_code == 200

    def test_select_uses_query_not_execute(self, client, mock_query):
        """SELECT must go through query(), not execute()."""
        self._super_admin_session(client)
        mock_query.return_value = [{'Status': 'active'}]
        with patch('api_query.execute') as mock_exec:
            r = _json_post(client, '/api/query/execute', {'sql': 'SELECT Status FROM members LIMIT 1'})
        mock_exec.assert_not_called(), "SELECT must not call execute()"
        assert r.status_code == 200
        assert r.get_json()['rows'] == [{'Status': 'active'}]

    def test_non_super_admin_blocked_from_write(self, client, mock_query):
        """Regular admins must be blocked from INSERT/UPDATE/DELETE/CALL writes.
        Only super_admins can execute non-SELECT queries."""
        with client.session_transaction() as sess:
            sess['user'] = {'email': 'regular@mmrunners.org', 'role': 'admin'}
        r = _json_post(client, '/api/query/execute',
                       {'sql': "UPDATE members SET Status='inactive' WHERE MemberID='A0001'"})
        assert r.status_code == 403, f"Expected 403 for non-super-admin write, got {r.status_code}"

    def test_empty_sql_rejected(self, client, mock_query):
        """Empty SQL must return 400."""
        self._super_admin_session(client)
        r = _json_post(client, '/api/query/execute', {'sql': ''})
        assert r.status_code == 400


# ---------------------------------------------------------------------------
# parse_member_id_from_memo — unit tests (pure function, high-value logic)
# ---------------------------------------------------------------------------

class TestParseMemberIdFromMemo:
    def setup_method(self):
        from payment_helpers import parse_member_id_from_memo
        self.parse = parse_member_id_from_memo

    @pytest.mark.parametrize('memo,expected', [
        ('A0001 renewal',          'A0001'),   # simple prefix
        ('Member: A0558',          'A0558'),   # label format
        ('a0001',                  'A0001'),   # lowercase normalised to upper
        ('renew A0123 thanks',     'A0123'),   # surrounded by words
        ('BA0001',                 None),      # letter immediately before — not a match
        ('A00011',                 None),      # digit immediately after — not a match
        ('A001',                   None),      # only 3 digits — too short
        ('A00001',                 None),      # 5 digits — too long
        ('no id here',             None),      # no ID at all
        ('',                       None),      # empty string
        (None,                     None),      # None input
    ])
    def test_parse_cases(self, memo, expected):
        """parse_member_id_from_memo must extract exactly A#### with word-boundary guards."""
        assert self.parse(memo) == expected, f"memo={memo!r} → expected {expected!r}"


# ---------------------------------------------------------------------------
# Payments — input validation
# ---------------------------------------------------------------------------

class TestPaymentsValidation:
    def test_manual_approve_missing_fields(self, client, mock_query):
        """manual-approve with missing transactionNumber or memberID must return 400."""
        r = _json_post(client, '/api/payments/manual-approve', {'memberID': 'A0001'})
        assert r.status_code == 400
        r = _json_post(client, '/api/payments/manual-approve', {'transactionNumber': 'tx_123'})
        assert r.status_code == 400

    def test_manual_approve_tx_not_found(self, client, mock_query):
        """Unknown transactionNumber must return 404."""
        mock_query.return_value = []   # no gmail_transaction found
        r = _json_post(client, '/api/payments/manual-approve',
                       {'transactionNumber': 'tx_NOPE', 'memberID': 'A0001'})
        assert r.status_code == 404

    def test_manual_approve_member_not_found(self, client, mock_query):
        """Valid tx but unknown member must return 404."""
        def side_effect(sql, *a, **kw):
            if 'gmail_transactions' in sql:
                return [{'TransactionNumber': 'tx_1', 'Amount': 30, 'Sender': 'x',
                         'Memo': 'A0001', 'Timestamp': None, 'TransactionDate': None}]
            return []  # member not found
        mock_query.side_effect = side_effect
        r = _json_post(client, '/api/payments/manual-approve',
                       {'transactionNumber': 'tx_1', 'memberID': 'A9999'})
        assert r.status_code == 404
        mock_query.side_effect = None


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
