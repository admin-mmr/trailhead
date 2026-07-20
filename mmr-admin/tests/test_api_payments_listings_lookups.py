"""
Dedicated tests for api_payments_listings.py, api_payments_lookups.py and
api_payments_debug.py (P1j — money-path coverage).

Extends smoke-only coverage (test_api_smoke*.py asserts status<500 only) with
real contract assertions:
  - /dashboard: exact key↔query mapping for the 6 counters
  - /autoguess-log: AUTOGUESS_RUN filter + pagination defaults
  - /submissions-for-member, /gmail-matching-candidates: filters + 404s
  - /debug-candidates: per-rule trace flags + priority sort
  - /debug-autoguess: SKIP verdicts for each failing criterion + duplicate guard
  - /test-fuzzy-match: scored-candidate shape + 404s
  - auth matrix: every /api/payments/* route requires admin role

All DB calls mocked — no live MySQL required.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_api_payments_listings_lookups.py -v
"""
import pytest
from unittest.mock import patch


# ── shared row builders ───────────────────────────────────────────────────────

def _member(member_id='A0001', type_='Individual'):
    return {
        'MemberID': member_id, 'FirstName': 'Jane', 'LastName': 'Lin',
        'Email': 'jane@example.com', 'PhoneNumber': '', 'WeChatID': '',
        'Type': type_, 'FamilyID': None, 'District': 'Queens',
        'Status': 'active', 'Expiration': None, 'MembershipFeePaid': 1,
        'PaymentDate': None, 'PaymentTransaction': '', 'UpdatedAt': None,
        'NYRRRunnerName': '',
    }


def _sub(amount=30):
    return {'SubmissionID': 'SUB001', 'MemberID': 'A0001', 'Amount': amount,
            'Status': 'pending', 'SubmissionType': 'membership'}


def _gmail(tx_num='TX001', memo='A0001 renewal', amount=30.0, sender='Jane Lin'):
    return {
        'MessageId': 'MSG001', 'TransactionNumber': tx_num, 'Sender': sender,
        'Memo': memo, 'Amount': amount, 'TransactionDate': '2025-11-01',
        'Notes': None, 'UpdatedAt': None, 'Timestamp': None,
    }


# ── GET /api/payments/dashboard ───────────────────────────────────────────────

class TestDashboardCounts:
    def test_six_counters_mapped_in_order(self, client, mock_query):
        """Route issues 6 COUNT queries; each response key must map to its own
        query (order contract: pending, matched, unmatched_gmail, approved_30d,
        rejected_30d, errors)."""
        mock_query.side_effect = [
            [{'cnt': 3}],   # pending submissions
            [{'cnt': 7}],   # matched payments
            [{'cnt': 2}],   # unmatched gmail
            [{'cnt': 5}],   # approved 30d
            [{'cnt': 1}],   # rejected 30d
            [{'cnt': 4}],   # errors 7d
        ]
        r = client.get('/api/payments/dashboard')
        mock_query.side_effect = None

        assert r.status_code == 200
        j = r.get_json()
        assert j == {'ok': True, 'pending': 3, 'matched': 7, 'unmatched_gmail': 2,
                     'approved_30d': 5, 'rejected_30d': 1, 'errors': 4}

    def test_query_error_returns_json_500(self, client, mock_query):
        mock_query.side_effect = Exception('DB down')
        r = client.get('/api/payments/dashboard')
        mock_query.side_effect = None
        assert r.status_code == 500
        assert r.get_json() is not None  # handle_api_errors → JSON, not HTML


# ── GET /api/payments/autoguess-log ───────────────────────────────────────────

class TestAutoguessLog:
    def test_filters_on_autoguess_run_action(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/autoguess-log')
        assert r.status_code == 200
        sql = mock_query.call_args[0][0]
        assert "Action = 'AUTOGUESS_RUN'" in sql

    def test_default_limit_100(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/payments/autoguess-log')
        params = mock_query.call_args[0][1]
        assert params == (100, 0)

    def test_pagination_forwarded(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/payments/autoguess-log?skip=20&limit=10')
        params = mock_query.call_args[0][1]
        assert params == (10, 20)

    def test_rows_returned_under_data_logs(self, client, mock_query):
        row = {'LogID': 'L1', 'Timestamp': None, 'Email': 'a@b.c',
               'State': 'created=1,skipped=0,errors=0',
               'ErrorMessage': None, 'ErrorSeverity': 'INFO'}
        mock_query.return_value = [row]
        r = client.get('/api/payments/autoguess-log')
        j = r.get_json()
        assert j['ok'] is True
        assert j['data']['logs'][0]['LogID'] == 'L1'


# ── GET /api/payments/submissions-for-member/<member_id> ─────────────────────

class TestSubmissionsForMember:
    def test_filters_by_member_and_pending(self, client, mock_query):
        mock_query.return_value = [_sub()]
        r = client.get('/api/payments/submissions-for-member/A0001')
        assert r.status_code == 200
        sql, params = mock_query.call_args[0]
        assert "Status = 'pending'" in sql
        assert params == ('A0001',)
        assert r.get_json()['submissions'][0]['SubmissionID'] == 'SUB001'

    def test_no_pending_returns_empty_list(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/submissions-for-member/A0001')
        assert r.status_code == 200
        assert r.get_json()['submissions'] == []


# ── GET /api/payments/gmail-matching-candidates/<member_id> ──────────────────

class TestGmailMatchingCandidates:
    def test_member_not_found_returns_404(self, client, mock_query):
        with patch('api_payments_lookups.get_member_by_id', return_value=None):
            r = client.get('/api/payments/gmail-matching-candidates/A9999')
        assert r.status_code == 404
        assert r.get_json()['error'] == 'Member not found'

    def test_name_patterns_forwarded_to_sql(self, client, mock_query):
        mock_query.return_value = [_gmail()]
        with patch('api_payments_lookups.get_member_by_id', return_value=_member()):
            r = client.get('/api/payments/gmail-matching-candidates/A0001')
        assert r.status_code == 200
        sql, params = mock_query.call_args[0]
        assert 'Notes IS NULL OR UpdatedAt IS NULL' in sql
        assert params == ('%Jane%', '%Lin%', '%Jane%', '%Lin%')
        assert r.get_json()['transactions'][0]['TransactionNumber'] == 'TX001'


# ── GET /api/payments/debug-candidates/<submission_id> ────────────────────────

class TestDebugCandidates:
    def _qside(self, sub=True, candidates=None):
        def side(sql, *a, **kw):
            s = sql.lower()
            if 'from submissions' in s:
                return [_sub()] if sub else []
            if 'gmail_transactions' in s:
                return candidates or []
            return []
        return side

    def test_submission_not_found_returns_404(self, client, mock_query):
        mock_query.side_effect = self._qside(sub=False)
        r = client.get('/api/payments/debug-candidates/NOSUB')
        mock_query.side_effect = None
        assert r.status_code == 404

    def test_member_not_found_returns_404(self, client, mock_query):
        mock_query.side_effect = self._qside()
        with patch('api_payments_lookups.get_member_by_id', return_value=None):
            r = client.get('/api/payments/debug-candidates/SUB001')
        mock_query.side_effect = None
        assert r.status_code == 404

    def test_rule1_memberid_in_memo_traced(self, client, mock_query):
        mock_query.side_effect = self._qside(candidates=[_gmail(memo='A0001 renewal')])
        with patch('api_payments_lookups.get_member_by_id', return_value=_member()):
            r = client.get('/api/payments/debug-candidates/SUB001')
        mock_query.side_effect = None

        assert r.status_code == 200
        c = r.get_json()['candidates'][0]
        assert c['rules']['r1_memberid_in_tx'] is True
        assert c['matched_rule'] == 'r1_memberid_in_tx'
        assert c['priority'] == 1

    def test_rule2_tx_last4_traced(self, client, mock_query):
        # No id in memo, sender not member — tx number ends in member digits 0001
        g = _gmail(tx_num='TX990001', memo='random', sender='somebody else')
        mock_query.side_effect = self._qside(candidates=[g])
        with patch('api_payments_lookups.get_member_by_id', return_value=_member()):
            r = client.get('/api/payments/debug-candidates/SUB001')
        mock_query.side_effect = None

        c = r.get_json()['candidates'][0]
        assert c['rules']['r1_memberid_in_tx'] is False
        assert c['rules']['r2_tx_last4_eq_member_digits'] is True
        assert c['matched_rule'] == 'r2_tx_last4_eq_member_digits'
        assert c['priority'] == 2

    def test_unmatched_candidate_priority_zero_sorted_last(self, client, mock_query):
        no_match = _gmail(tx_num='TX99', memo='xyz', sender='xyz corp')
        match = _gmail(tx_num='TX01', memo='A0001')
        mock_query.side_effect = self._qside(candidates=[no_match, match])
        with patch('api_payments_lookups.get_member_by_id', return_value=_member()):
            r = client.get('/api/payments/debug-candidates/SUB001')
        mock_query.side_effect = None

        cands = r.get_json()['candidates']
        assert cands[0]['TransactionNumber'] == 'TX01'    # matched first
        assert cands[-1]['priority'] == 0                  # unmatched last

    def test_response_includes_member_text(self, client, mock_query):
        mock_query.side_effect = self._qside(candidates=[])
        with patch('api_payments_lookups.get_member_by_id', return_value=_member()):
            r = client.get('/api/payments/debug-candidates/SUB001')
        mock_query.side_effect = None
        j = r.get_json()
        assert 'jane' in j['member']['member_text']
        assert j['total_unmatched_at_amount'] == 0


# ── GET /api/payments/debug-autoguess/<tx> — per-criterion SKIP verdicts ─────

class TestDebugAutoguessCriteria:
    """Extends TestDebugAutoguess (test_api_payments_routes.py): each remaining
    criterion failing must yield verdict SKIP with the right failed step."""

    def _qside(self, gmail, pending=None, dup=None):
        def side(sql, *a, **kw):
            s = sql.lower()
            if 'gmail_transactions' in s:
                return [gmail]
            if 'from submissions' in s:
                return pending or []
            if 'from payments' in s:
                return dup or []
            return []
        return side

    def _get(self, client):
        return client.get('/api/payments/debug-autoguess/TX001')

    def _steps_by_name(self, j):
        return {s['step']: s for s in j['steps']}

    def test_member_not_found_skips(self, client, mock_query):
        mock_query.side_effect = self._qside(_gmail(memo='A0001 renewal'))
        with patch('api_payments_debug.get_member_by_id', return_value=None):
            r = self._get(client)
        mock_query.side_effect = None
        j = r.get_json()
        assert j['verdict'] == 'SKIP'
        assert self._steps_by_name(j)['member_exists']['passed'] is False

    def test_amount_mismatch_skips(self, client, mock_query):
        mock_query.side_effect = self._qside(_gmail(amount='50.00'))
        with patch('api_payments_debug.get_member_by_id', return_value=_member()):
            r = self._get(client)
        mock_query.side_effect = None
        j = r.get_json()
        assert j['verdict'] == 'SKIP'
        step = self._steps_by_name(j)['amount_match']
        assert step['passed'] is False
        assert '$50' in step['detail'] and '$30' in step['detail']

    def test_family_expects_50(self, client, mock_query):
        mock_query.side_effect = self._qside(_gmail(amount='30.00'))
        with patch('api_payments_debug.get_member_by_id',
                   return_value=_member(type_='Family')):
            r = self._get(client)
        mock_query.side_effect = None
        j = r.get_json()
        assert j['verdict'] == 'SKIP'
        assert '$50' in self._steps_by_name(j)['amount_match']['detail']

    def test_outside_renewal_period_skips(self, client, mock_query):
        mock_query.side_effect = self._qside(_gmail())
        with patch('api_payments_debug.get_member_by_id', return_value=_member()), \
             patch('api_payments_debug.get_renewal_period',
                   return_value=('2025-10-01', '2026-03-31')), \
             patch('api_payments_debug.is_within_renewal_period', return_value=False):
            r = self._get(client)
        mock_query.side_effect = None
        j = r.get_json()
        assert j['verdict'] == 'SKIP'
        assert self._steps_by_name(j)['renewal_period']['passed'] is False

    def test_duplicate_payment_skips_after_all_criteria_pass(self, client, mock_query):
        mock_query.side_effect = self._qside(
            _gmail(), pending=[_sub()], dup=[{'PaymentID': 'PAY-DUP'}])
        with patch('api_payments_debug.get_member_by_id', return_value=_member()), \
             patch('api_payments_debug.get_renewal_period',
                   return_value=('2025-10-01', '2026-03-31')), \
             patch('api_payments_debug.is_within_renewal_period', return_value=True):
            r = self._get(client)
        mock_query.side_effect = None
        j = r.get_json()
        assert j['verdict'] == 'SKIP'
        steps = self._steps_by_name(j)
        assert steps['no_duplicate']['passed'] is False
        assert 'PAY-DUP' in steps['no_duplicate']['detail']
        # everything upstream passed
        for name in ('memo_member_id', 'member_exists', 'amount_match',
                     'renewal_period'):
            assert steps[name]['passed'] is True, name


# ── GET /api/payments/test-fuzzy-match/<submission_id> ────────────────────────

class TestFuzzyMatchEndpoint:
    def _qside(self, sub=True, candidates=None):
        def side(sql, *a, **kw):
            s = sql.lower()
            if 'from submissions' in s:
                return [_sub()] if sub else []
            if 'gmail_transactions' in s:
                return candidates or []
            return []
        return side

    def test_submission_not_found_returns_404(self, client, mock_query):
        mock_query.side_effect = self._qside(sub=False)
        r = client.get('/api/payments/test-fuzzy-match/NOSUB')
        mock_query.side_effect = None
        assert r.status_code == 404

    def test_member_not_found_returns_404(self, client, mock_query):
        mock_query.side_effect = self._qside()
        with patch('api_payments_debug.get_member_by_id', return_value=None):
            r = client.get('/api/payments/test-fuzzy-match/SUB001')
        mock_query.side_effect = None
        assert r.status_code == 404

    def test_scored_candidates_shape(self, client, mock_query):
        mock_query.side_effect = self._qside(candidates=[_gmail(memo='A0001 renewal')])
        with patch('api_payments_debug.get_member_by_id', return_value=_member()):
            r = client.get('/api/payments/test-fuzzy-match/SUB001')
        mock_query.side_effect = None

        assert r.status_code == 200
        j = r.get_json()
        assert j['count'] == 1
        c = j['candidates'][0]
        assert c['matched'] is True
        assert c['priority'] == 1                     # rule 1: A0001 in memo
        assert 'a0001' in c['tx_text']
        assert 'jane' in c['member_text']
        assert j['member']['MemberID'] == 'A0001'
        assert j['submission']['Amount'] == 30.0


# ── auth matrix: all payments routes admin-only ───────────────────────────────

class TestPaymentsAuthMarkers:
    def test_every_payments_route_requires_admin(self, app):
        """Every /api/payments/* route must stack login_required +
        require_role('admin') — asserted via the decorator markers used by
        test_auth_matrix.py."""
        rules = [r for r in app.url_map.iter_rules()
                 if str(r).startswith('/api/payments')]
        assert len(rules) >= 19  # all payments endpoints registered
        for rule in rules:
            vf = app.view_functions[rule.endpoint]
            assert getattr(vf, '_auth_login_required', False), \
                f'{rule} missing login_required'
            assert getattr(vf, '_auth_min_role', None) == 'admin', \
                f'{rule} missing require_role(admin)'
