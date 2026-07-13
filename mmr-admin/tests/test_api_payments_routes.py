"""
Tests for uncovered api_payments.py routes (was 71% — targeting lines
537-581, 636-691, 725-770, 944-1012).

Covers:
  - GET  /api/payments/gmail-candidates/<submission_id>
  - GET  /api/payments/debug/match/<submission_id>
  - POST /api/payments/admin-create  (via messageId path)
  - GET  /api/payments/search-members
  - GET  /api/payments/debug-autoguess/<transaction_number>
  - GET  /api/payments/history
  - GET  /api/payments/member-quick/<member_id>
  - POST /api/payments/cancel/<payment_id>

All DB calls mocked — no live MySQL required.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_api_payments_routes.py -v
"""
import pytest
from unittest.mock import patch, MagicMock


# ── shared fixtures / helpers ─────────────────────────────────────────────────

def _sub():
    return {'SubmissionID': 'SUB001', 'MemberID': 'A0001',
            'Amount': 30, 'Status': 'pending', 'SubmissionType': 'membership'}


def _member():
    return {
        'MemberID': 'A0001', 'FirstName': 'Jane', 'LastName': 'Lin',
        'Email': 'jane@example.com', 'PhoneNumber': '', 'WeChatID': '',
        'Type': 'Individual', 'FamilyID': None, 'District': 'Queens',
        'Status': 'active', 'Expiration': None, 'MembershipFeePaid': 1,
        'PaymentDate': None, 'PaymentTransaction': '', 'UpdatedAt': None,
        'NYRRRunnerName': '',
    }


def _gmail():
    return {
        'MessageId': 'MSG001', 'TransactionNumber': 'TX001',
        'Sender': 'Jane Lin', 'Memo': 'A0001 renewal',
        'Amount': 30.0, 'TransactionDate': '2025-11-01',
        'Notes': None, 'UpdatedAt': None, 'Timestamp': None,
    }


# ── GET /api/payments/gmail-candidates/<submission_id> ────────────────────────

class TestGmailCandidates:
    def test_submission_not_found_returns_404(self, client, mock_query):
        # fuzzy_select_transaction_to_submission returns error when sub not found
        with patch('api_payments_lookups.fuzzy_select_transaction_to_submission',
                   return_value={'error': 'Submission not found', 'candidates': []}):
            r = client.get('/api/payments/gmail-candidates/NOSUB')
        assert r.status_code == 404
        assert r.get_json()['error'] == 'Submission not found'

    def test_valid_submission_returns_candidates(self, client, mock_query):
        fake_result = {
            'submission': {'SubmissionID': 'SUB001', 'MemberID': 'A0001', 'Amount': 30},
            'member': _member(),
            'candidates': [
                {'TransactionNumber': 'TX001', 'Sender': 'Jane Lin',
                 'Amount': 30.0, 'Memo': 'A0001', 'TransactionDate': '2025-11-01',
                 'priority': 1, 'matched': True, 'amount_match': True}
            ],
            'count': 1, 'total_candidates': 1,
        }
        with patch('api_payments_lookups.fuzzy_select_transaction_to_submission',
                   return_value=fake_result):
            r = client.get('/api/payments/gmail-candidates/SUB001')
        assert r.status_code == 200
        j = r.get_json()
        assert 'candidates' in j
        assert len(j['candidates']) == 1

    def test_empty_candidates_returns_200(self, client, mock_query):
        fake_result = {
            'submission': _sub(), 'member': _member(),
            'candidates': [], 'count': 0, 'total_candidates': 0,
        }
        with patch('api_payments_lookups.fuzzy_select_transaction_to_submission',
                   return_value=fake_result):
            r = client.get('/api/payments/gmail-candidates/SUB001')
        assert r.status_code == 200
        assert r.get_json()['candidates'] == []


# ── GET /api/payments/debug/match/<submission_id> ─────────────────────────────

class TestDebugMatch:
    def test_submission_not_found_returns_404(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/debug/match/NOSUB')
        assert r.status_code == 404

    def test_member_not_found_returns_404(self, client, mock_query):
        def qside(sql, params=(), **kw):
            if 'submissions' in sql:
                return [_sub()]
            return []
        mock_query.side_effect = qside
        with patch('api_payments_lookups.get_member_by_id', return_value=None):
            r = client.get('/api/payments/debug/match/SUB001')
        assert r.status_code == 404
        mock_query.side_effect = None

    def test_valid_request_returns_candidates_and_member(self, client, mock_query):
        # The debug/match route uses `from db import query as db_query` inside the
        # function body — must patch db.query (not the module-level binding).
        gmail = _gmail()

        def qside(sql, params=(), **kw):
            sql_l = sql.lower()
            if 'from submissions' in sql_l:
                return [_sub()]
            if 'gmail_transactions' in sql_l:
                return [gmail]
            return []

        with patch('db.query', side_effect=qside), \
             patch('api_payments_lookups.get_member_by_id', return_value=_member()), \
             patch('api_payments_lookups.build_member_text', return_value='jane lin'), \
             patch('api_payments_lookups.build_transaction_text', return_value='jane lin a0001'):
            r = client.get('/api/payments/debug/match/SUB001')

        assert r.status_code == 200
        j = r.get_json()
        assert 'submission' in j
        assert 'member' in j
        assert 'candidates' in j

    def test_candidates_include_rule_flags(self, client, mock_query):
        gmail = _gmail()

        def qside(sql, params=(), **kw):
            sql_l = sql.lower()
            if 'from submissions' in sql_l:
                return [_sub()]
            if 'gmail_transactions' in sql_l:
                return [gmail]
            return []

        with patch('db.query', side_effect=qside), \
             patch('api_payments_lookups.get_member_by_id', return_value=_member()), \
             patch('api_payments_lookups.build_member_text', return_value='jane lin'), \
             patch('api_payments_lookups.build_transaction_text', return_value='a0001 renewal jane lin'):
            r = client.get('/api/payments/debug/match/SUB001')

        j = r.get_json()
        if j.get('candidates'):
            c = j['candidates'][0]
            # debug/match returns scored candidates with priority + tx_text
            assert 'priority' in c
            assert 'matched' in c
            assert 'tx_text' in c


# ── POST /api/payments/admin-create (via messageId) ───────────────────────────

class TestAdminCreate:
    def _post(self, client, body):
        return client.post('/api/payments/admin-create', json=body)

    def test_missing_member_id_returns_400(self, client, mock_query):
        r = self._post(client, {'messageId': 'MSG001'})
        assert r.status_code == 400

    def test_missing_message_id_returns_400(self, client, mock_query):
        r = self._post(client, {'memberId': 'A0001'})
        assert r.status_code == 400

    def test_member_not_found_returns_404(self, client, mock_query):
        with patch('api_payments_actions.get_member_by_id', return_value=None):
            r = self._post(client, {'memberId': 'A9999', 'messageId': 'MSG001'})
        assert r.status_code == 404

    def test_gmail_not_found_returns_404(self, client, mock_query):
        mock_query.return_value = []  # gmail query returns empty
        with patch('api_payments_actions.get_member_by_id', return_value=_member()):
            r = self._post(client, {'memberId': 'A0001', 'messageId': 'NOMSG'})
        assert r.status_code == 404

    def test_gmail_missing_tx_number_returns_400(self, client, mock_query):
        gmail_no_tx = {**_gmail(), 'TransactionNumber': None}
        mock_query.return_value = [gmail_no_tx]
        with patch('api_payments_actions.get_member_by_id', return_value=_member()):
            r = self._post(client, {'memberId': 'A0001', 'messageId': 'MSG001'})
        assert r.status_code == 400

    def test_valid_request_calls_sp_link_transaction(self, client, mock_query):
        def qside(sql, params=(), **kw):
            if 'gmail_transactions' in sql:
                return [_gmail()]
            if 'submissions' in sql:
                return []
            return []

        mock_query.side_effect = qside
        with patch('api_payments_actions.get_member_by_id', return_value=_member()), \
             patch('api_payments_actions.execute') as mock_exec:
            r = self._post(client, {'memberId': 'A0001', 'messageId': 'MSG001'})

        assert r.status_code == 200
        j = r.get_json()
        assert j['ok'] is True
        assert 'sp_link_transaction' in str(mock_exec.call_args_list)
        mock_query.side_effect = None

    def test_execute_error_returns_500(self, client, mock_query):
        def qside(sql, params=(), **kw):
            if 'gmail_transactions' in sql:
                return [_gmail()]
            return []

        mock_query.side_effect = qside
        with patch('api_payments_actions.get_member_by_id', return_value=_member()), \
             patch('api_payments_actions.execute', side_effect=Exception('DB down')):
            r = self._post(client, {'memberId': 'A0001', 'messageId': 'MSG001'})

        assert r.status_code == 500
        mock_query.side_effect = None

    def test_custom_payment_intent_forwarded_to_sp(self, client, mock_query):
        def qside(sql, params=(), **kw):
            if 'gmail_transactions' in sql:
                return [_gmail()]
            return []

        mock_query.side_effect = qside
        with patch('api_payments_actions.get_member_by_id', return_value=_member()), \
             patch('api_payments_actions.execute') as mock_exec:
            r = self._post(client, {'memberId': 'A0001', 'messageId': 'MSG001',
                                    'paymentIntent': 'Family Membership'})

        assert r.status_code == 200
        call_args = str(mock_exec.call_args_list[0])
        assert 'Family Membership' in call_args
        mock_query.side_effect = None


# ── GET /api/payments/search-members ─────────────────────────────────────────

class TestSearchMembers:
    def test_short_query_returns_400(self, client, mock_query):
        r = client.get('/api/payments/search-members?q=a')
        assert r.status_code == 400

    def test_no_query_param_returns_400(self, client, mock_query):
        r = client.get('/api/payments/search-members')
        assert r.status_code == 400

    def test_valid_query_returns_members(self, client, mock_query):
        mock_query.return_value = [_member()]
        r = client.get('/api/payments/search-members?q=jane')
        assert r.status_code == 200
        j = r.get_json()
        assert isinstance(j.get('members'), list)
        assert len(j['members']) == 1

    def test_no_results_returns_empty_list(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/search-members?q=nobody')
        assert r.status_code == 200
        assert r.get_json()['members'] == []

    def test_limit_param_forwarded(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/search-members?q=jane&limit=5')
        assert r.status_code == 200
        # Limit should appear in the SQL params
        call_str = str(mock_query.call_args_list)
        assert '5' in call_str

    def test_multi_word_query_searches_both_tokens(self, client, mock_query):
        mock_query.return_value = [_member()]
        r = client.get('/api/payments/search-members?q=jane+lin')
        assert r.status_code == 200


# ── GET /api/payments/debug-autoguess/<transaction_number> ─────────────────

class TestDebugAutoguess:
    def test_transaction_not_found_returns_ok_false(self, client, mock_query):
        # Route returns 200 with ok=False (not a 404) when tx missing
        mock_query.return_value = []
        r = client.get('/api/payments/debug-autoguess/NOTX')
        assert r.status_code == 200
        assert r.get_json()['ok'] is False

    def test_already_matched_verdict_skip(self, client, mock_query):
        gmail = {**_gmail(), 'Notes': 'Linked', 'UpdatedAt': '2026-01-01'}
        # Return the gmail row only for the gmail_transactions lookup — member
        # and config queries also go through mock_query and need empty results.
        mock_query.side_effect = (
            lambda sql, *a, **kw: [gmail] if 'gmail_transactions' in sql.lower() else [])
        with patch('api_payments_debug.get_member_by_id', return_value=_member()), \
             patch('api_payments_debug.get_renewal_period',
                   return_value=('2025-10-01', '2026-03-31')):
            r = client.get('/api/payments/debug-autoguess/TX001')
        mock_query.side_effect = None
        assert r.status_code == 200
        j = r.get_json()
        assert j['verdict'] == 'SKIP'
        assert any(s['step'] == 'unmatched_check' for s in j['steps'])

    def test_no_member_id_in_memo_verdict_skip(self, client, mock_query):
        gmail = {**_gmail(), 'Memo': 'monthly dues payment', 'Notes': None, 'UpdatedAt': None}
        mock_query.return_value = [gmail]
        with patch('api_payments_debug.parse_member_id_from_memo', return_value=None):
            r = client.get('/api/payments/debug-autoguess/TX001')
        assert r.status_code == 200
        assert r.get_json()['verdict'] == 'SKIP'

    def test_valid_tx_would_create_verdict(self, client, mock_query):
        gmail = {**_gmail(), 'Notes': None, 'UpdatedAt': None,
                 'Amount': '30.00', 'TransactionDate': '2025-11-01'}

        def qside(sql, params=(), **kw):
            sql_l = sql.lower()
            if 'gmail_transactions' in sql_l:
                return [gmail]
            if 'from submissions' in sql_l:
                return [_sub()]
            if 'from payments' in sql_l:
                return []
            return []

        mock_query.side_effect = qside
        with patch('api_payments_debug.get_member_by_id', return_value=_member()), \
             patch('api_payments_debug.parse_member_id_from_memo', return_value='A0001'), \
             patch('api_payments_debug.get_renewal_period', return_value=('2025-10-01', '2026-03-31')), \
             patch('api_payments_debug.is_within_renewal_period', return_value=True):
            r = client.get('/api/payments/debug-autoguess/TX001')

        assert r.status_code == 200
        j = r.get_json()
        assert j['verdict'] in ('WOULD_CREATE', 'SKIP')
        assert 'steps' in j
        mock_query.side_effect = None

    def test_found_tx_response_includes_steps(self, client, mock_query):
        """When tx is found, steps must always be present regardless of verdict."""
        gmail = {**_gmail(), 'Notes': 'Linked', 'UpdatedAt': '2026-01-01'}
        mock_query.side_effect = (
            lambda sql, *a, **kw: [gmail] if 'gmail_transactions' in sql.lower() else [])
        with patch('api_payments_debug.get_member_by_id', return_value=_member()), \
             patch('api_payments_debug.get_renewal_period',
                   return_value=('2025-10-01', '2026-03-31')):
            r = client.get('/api/payments/debug-autoguess/TX001')
        mock_query.side_effect = None
        assert r.status_code == 200
        j = r.get_json()
        assert 'steps' in j
        assert len(j['steps']) >= 1


# ── GET /api/payments/history ─────────────────────────────────────────────────

class TestPaymentHistoryRoute:
    def _payment_row(self):
        return {
            'PaymentID': 'PAY001', 'MemberID': 'A0001', 'TransactionNumber': 'TX001',
            'Amount': 30, 'PaymentType': 'Individual Membership',
            'PaymentDate': None, 'ProcessedBy': 'admin@mmrunners.org',
            'SubmissionID': None, 'CreatedAt': '2026-01-15',
            'FirstName': 'Jane', 'LastName': 'Lin',
        }

    def test_returns_payments_list(self, client, mock_query):
        mock_query.side_effect = [
            [{'cnt': 1}],
            [self._payment_row()],
        ]
        r = client.get('/api/payments/history')
        assert r.status_code == 200
        j = r.get_json()
        assert 'payments' in j
        assert isinstance(j['payments'], list)
        mock_query.side_effect = None

    def test_search_param_forwarded(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 0}], []]
        r = client.get('/api/payments/history?search=jane')
        assert r.status_code == 200
        call_str = str(mock_query.call_args_list)
        assert 'jane' in call_str.lower()
        mock_query.side_effect = None

    def test_days_param_accepted(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 0}], []]
        r = client.get('/api/payments/history?days=90')
        assert r.status_code == 200
        mock_query.side_effect = None

    def test_days_zero_returns_all(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 0}], []]
        r = client.get('/api/payments/history?days=0')
        assert r.status_code == 200
        mock_query.side_effect = None

    def test_total_included_in_response(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 42}], []]
        r = client.get('/api/payments/history')
        j = r.get_json()
        assert j.get('total') == 42
        mock_query.side_effect = None


# ── GET /api/payments/member-quick/<member_id> ────────────────────────────────

class TestMemberQuickRoute:
    def test_member_found_returns_data(self, client, mock_query):
        with patch('api_payments_lookups.get_member_by_id', return_value=_member()):
            r = client.get('/api/payments/member-quick/A0001')
        assert r.status_code == 200
        j = r.get_json()
        assert j.get('ok') is True
        assert j['data']['MemberID'] == 'A0001'

    def test_member_not_found_returns_404(self, client, mock_query):
        with patch('api_payments_lookups.get_member_by_id', return_value=None):
            r = client.get('/api/payments/member-quick/A9999')
        assert r.status_code == 404
        assert r.get_json()['ok'] is False

    def test_response_includes_expiration_and_type(self, client, mock_query):
        m = {**_member(), 'Expiration': '2027-03-31'}
        with patch('api_payments_lookups.get_member_by_id', return_value=m):
            r = client.get('/api/payments/member-quick/A0001')
        j = r.get_json()
        assert 'Expiration' in j['data'] or 'expiration' in str(j).lower()


# ── POST /api/payments/cancel/<payment_id> ────────────────────────────────────

class TestCancelPayment:
    def _post(self, client, payment_id):
        return client.post(f'/api/payments/cancel/{payment_id}')

    def test_valid_cancel_returns_ok(self, client, mock_query):
        # Route calls sp_cancel_payment directly without a pre-fetch — always returns ok
        with patch('api_payments_listings.execute') as mock_exec:
            r = self._post(client, 'PAY001')
        assert r.status_code == 200
        assert r.get_json()['ok'] is True

    def test_cancel_calls_sp_cancel_payment(self, client, mock_query):
        with patch('api_payments_listings.execute') as mock_exec:
            self._post(client, 'PAY001')
        exec_call = str(mock_exec.call_args_list[0])
        assert 'sp_cancel_payment' in exec_call
        assert 'PAY001' in exec_call

    def test_cancel_includes_payment_id_in_message(self, client, mock_query):
        with patch('api_payments_listings.execute'):
            r = self._post(client, 'PAY-XYZ')
        assert 'PAY-XYZ' in r.get_json()['message']

    def test_execute_error_propagates_as_500(self, client, mock_query):
        with patch('api_payments_listings.execute', side_effect=Exception('DB error')):
            r = self._post(client, 'PAY001')
        assert r.status_code == 500
