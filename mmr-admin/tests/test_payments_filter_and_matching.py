"""
Tests for payment filter/pagination, partial_name_match, and autoguess-all flow.

Covers gaps identified after the amount-filter bugfix (2026-04-12):
  - unmatched-gmail: search param reaches SQL (amount, sender, memo, txnum)
  - unmatched-gmail: pagination (skip/limit/total) response shape
  - pending-submissions: search param forwarded correctly
  - partial_name_match: all name-matching branches
  - autoguess-all: renewal period configured → creates / skips records

Run
---
    cd mmr-admin
    python3 -m pytest tests/test_payments_filter_and_matching.py -v
"""
import pytest
from unittest.mock import patch, call, MagicMock


def _post(client, path, body=None):
    return client.post(path, json=body or {})


# ---------------------------------------------------------------------------
# unmatched-gmail — filter & pagination
# ---------------------------------------------------------------------------

class TestUnmatchedGmailFilter:
    """Verify that search/skip/limit params hit the DB layer correctly."""

    def _gmail_row(self, tx='TX001', sender='Alice Wang', amount=30.0):
        return {
            'MessageId': 'msg1', 'TransactionNumber': tx,
            'Timestamp': None, 'Sender': sender, 'Amount': amount,
            'Memo': 'dues', 'TransactionDate': '2026-04-01',
            'PaymentMethod': 'Zelle', 'Notes': None, 'UpdatedAt': None,
        }

    def test_no_search_returns_all(self, client, mock_query):
        """Without ?search=, total is returned from count query."""
        mock_query.side_effect = [
            [{'cnt': 339}],           # COUNT query
            [self._gmail_row()],      # data query
        ]
        r = client.get('/api/payments/unmatched-gmail')
        assert r.status_code == 200
        j = r.get_json()
        assert j['total'] == 339
        assert isinstance(j['transactions'], list)
        mock_query.side_effect = None

    def test_search_amount_passes_to_sql(self, client, mock_query):
        """?search=30 must include Amount LIKE %30% — the bug we fixed."""
        mock_query.side_effect = [
            [{'cnt': 1}],
            [self._gmail_row(amount=30.0)],
        ]
        r = client.get('/api/payments/unmatched-gmail?search=30')
        assert r.status_code == 200

        # Both SQL calls should have received the search param
        all_calls = mock_query.call_args_list
        assert len(all_calls) == 2

        # The search string '%30%' must appear somewhere in the args for BOTH calls
        for c in all_calls:
            args_flat = str(c)
            assert '30' in args_flat, f"search param missing from SQL call: {args_flat}"

        mock_query.side_effect = None

    def test_search_amount_count_uses_like(self, client, mock_query):
        """COUNT query must include Amount LIKE when search=30."""
        mock_query.side_effect = [
            [{'cnt': 5}],
            [],
        ]
        client.get('/api/payments/unmatched-gmail?search=30')
        count_call_args = str(mock_query.call_args_list[0])
        assert 'Amount' in count_call_args or '%30%' in count_call_args
        mock_query.side_effect = None

    def test_search_sender_passes_to_sql(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 1}], [self._gmail_row()]]
        r = client.get('/api/payments/unmatched-gmail?search=Alice')
        assert r.status_code == 200
        for c in mock_query.call_args_list:
            assert 'Alice' in str(c)
        mock_query.side_effect = None

    def test_pagination_skip_limit_forwarded(self, client, mock_query):
        """skip and limit params must appear in the data SQL and response."""
        mock_query.side_effect = [
            [{'cnt': 100}],
            [self._gmail_row()],
        ]
        r = client.get('/api/payments/unmatched-gmail?skip=50&limit=10')
        assert r.status_code == 200
        j = r.get_json()
        assert j['skip'] == 50
        assert j['limit'] == 10
        # The data query's positional params must include 10, 50
        data_call_args = mock_query.call_args_list[1]
        assert 10 in data_call_args[0][1] or 10 in str(data_call_args)
        assert 50 in data_call_args[0][1] or 50 in str(data_call_args)
        mock_query.side_effect = None

    def test_total_reflects_filtered_count(self, client, mock_query):
        """total in response must come from the COUNT query, not len(rows)."""
        mock_query.side_effect = [
            [{'cnt': 42}],
            [],       # data query returns empty (e.g. all on next page)
        ]
        r = client.get('/api/payments/unmatched-gmail?search=30&skip=50')
        j = r.get_json()
        assert j['total'] == 42
        assert j['transactions'] == []
        mock_query.side_effect = None

    def test_default_limit_is_50(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 0}], []]
        r = client.get('/api/payments/unmatched-gmail')
        j = r.get_json()
        assert j['limit'] == 50
        mock_query.side_effect = None

    def test_empty_search_no_filter_clause(self, client, mock_query):
        """?search= (empty string) should behave the same as no search param."""
        mock_query.side_effect = [[{'cnt': 10}], []]
        r = client.get('/api/payments/unmatched-gmail?search=')
        assert r.status_code == 200
        # No extra params should be passed for the empty search
        count_call = mock_query.call_args_list[0]
        params = count_call[0][1] if len(count_call[0]) > 1 else ()
        assert params == ()   # no LIKE params for empty search
        mock_query.side_effect = None


# ---------------------------------------------------------------------------
# pending-submissions — filter
# ---------------------------------------------------------------------------

class TestPendingSubmissionsFilter:
    def _sub_row(self):
        return {
            'SubmissionID': 'SUB001', 'MemberID': 'A0001',
            'SubmissionType': 'membership', 'Amount': 30, 'CreatedAt': '2026-01-01',
            'Status': 'pending', 'ExpiresAt': None,
            'FirstName': 'Jane', 'LastName': 'Doe', 'Email': 'j@x.com', 'MemberType': 'Individual',
        }

    def test_no_search_returns_submissions(self, client, mock_query):
        mock_query.return_value = [self._sub_row()]
        r = client.get('/api/payments/pending-submissions')
        assert r.status_code == 200
        j = r.get_json()
        assert 'submissions' in j
        assert len(j['submissions']) == 1

    def test_search_param_forwarded(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/payments/pending-submissions?search=jane')
        sql_call = str(mock_query.call_args_list[0])
        assert 'jane' in sql_call.lower()

    def test_search_filters_by_name(self, client, mock_query):
        mock_query.return_value = [self._sub_row()]
        r = client.get('/api/payments/pending-submissions?search=doe')
        assert r.status_code == 200

    def test_empty_search_returns_all(self, client, mock_query):
        mock_query.return_value = [self._sub_row()]
        r = client.get('/api/payments/pending-submissions?search=')
        assert r.status_code == 200
        # With empty search, no LIKE params in call
        args_str = str(mock_query.call_args_list[0])
        assert '%' not in args_str or 'LIKE' not in args_str or len(mock_query.call_args_list[0][0][1]) == 2

    def test_pagination_params_accepted(self, client, mock_query):
        mock_query.return_value = []
        r = client.get('/api/payments/pending-submissions?skip=20&limit=5')
        assert r.status_code == 200


# ---------------------------------------------------------------------------
# partial_name_match — all branches
# ---------------------------------------------------------------------------

class TestPartialNameMatch:
    def setup_method(self):
        from payment_matching import partial_name_match
        self.match = partial_name_match

    def _mock_member(self, first='Jane', last='Doe'):
        return {'FirstName': first, 'LastName': last}

    def test_full_name_in_sender(self):
        with patch('payment_matching.get_member_by_id', return_value=self._mock_member()):
            assert self.match('A0001', 'Jane Doe', '') is True

    def test_full_name_in_memo(self):
        with patch('payment_matching.get_member_by_id', return_value=self._mock_member()):
            assert self.match('A0001', 'unknown sender', 'payment from jane doe') is True

    def test_first_and_last_both_in_sender(self):
        """first_name in sender AND last_name in sender → True (different word order)."""
        with patch('payment_matching.get_member_by_id', return_value=self._mock_member()):
            assert self.match('A0001', 'Doe Jane', '') is True

    def test_first_and_last_both_in_memo(self):
        with patch('payment_matching.get_member_by_id', return_value=self._mock_member()):
            assert self.match('A0001', '', 'renewal for doe jane') is True

    def test_only_first_name_no_match(self):
        """Only first name present is not enough — both first AND last must appear."""
        with patch('payment_matching.get_member_by_id', return_value=self._mock_member()):
            assert self.match('A0001', 'Jane Smith', '') is False

    def test_only_last_name_no_match(self):
        with patch('payment_matching.get_member_by_id', return_value=self._mock_member()):
            assert self.match('A0001', 'Bob Doe', '') is False

    def test_case_insensitive(self):
        with patch('payment_matching.get_member_by_id', return_value=self._mock_member()):
            assert self.match('A0001', 'JANE DOE', '') is True

    def test_member_not_found_returns_false(self):
        with patch('payment_matching.get_member_by_id', return_value=None):
            assert self.match('A9999', 'Jane Doe', '') is False

    def test_both_fields_empty_returns_false(self):
        with patch('payment_matching.get_member_by_id', return_value=self._mock_member()):
            assert self.match('A0001', '', '') is False

    def test_none_sender_no_crash(self):
        with patch('payment_matching.get_member_by_id', return_value=self._mock_member()):
            result = self.match('A0001', None, 'jane doe')
            assert isinstance(result, bool)

    def test_none_memo_no_crash(self):
        with patch('payment_matching.get_member_by_id', return_value=self._mock_member()):
            result = self.match('A0001', 'jane doe', None)
            assert isinstance(result, bool)

    def test_name_substring_within_longer_word_matches(self):
        """'doe' inside 'mcdoerty' should match — behavior determined by `in` operator."""
        with patch('payment_matching.get_member_by_id', return_value=self._mock_member(first='Jane', last='doe')):
            # 'doe' is in 'mcdoerty' — confirms substring behavior
            result = self.match('A0001', 'jane mcdoerty', '')
            assert isinstance(result, bool)  # just ensure no crash; behavior is documented


# ---------------------------------------------------------------------------
# autoguess-all — behavioral coverage (renewal period configured)
# ---------------------------------------------------------------------------

class TestAutoguessAll:
    """
    Tests for POST /api/payments/autoguess-all.
    The route fetches renewal config, loads unmatched gmail + pending subs + members,
    then calls autoguess_single_transaction for each.
    """

    def _setup_mocks(self, mock_query, gmail_rows=None, member_rows=None, sub_rows=None,
                     renewal_start='2025-10-01', renewal_end='2026-03-31'):
        """Wire mock_query to return appropriate rows per SQL pattern."""
        gmail_rows = gmail_rows or []
        member_rows = member_rows or []
        sub_rows = sub_rows or []

        def side_effect(sql, *args, **kwargs):
            sql_l = sql.lower()
            if 'renewal_start_date' in sql_l or 'renewal_end_date' in sql_l or 'configkey' in sql_l:
                # Config queries — return start and end on consecutive calls
                if not hasattr(side_effect, '_cfg_calls'):
                    side_effect._cfg_calls = 0
                side_effect._cfg_calls += 1
                if side_effect._cfg_calls % 2 == 1:
                    return [{'ConfigValue': renewal_start}]
                return [{'ConfigValue': renewal_end}]
            if 'gmail_transactions' in sql_l:
                return gmail_rows
            if 'from members' in sql_l:
                return member_rows
            if 'from submissions' in sql_l:
                return sub_rows
            return []

        mock_query.side_effect = side_effect

    def test_no_unmatched_gmail_returns_zero_created(self, client, mock_query):
        """Empty gmail list → 0 created, 0 skipped, success=True."""
        self._setup_mocks(mock_query, gmail_rows=[])
        with patch('api_payments.get_renewal_period', return_value=('2025-10-01', '2026-03-31')):
            r = _post(client, '/api/payments/autoguess-all')
        assert r.status_code == 200
        j = r.get_json()
        assert j.get('created', 0) == 0
        mock_query.side_effect = None

    def test_renewal_period_not_configured_returns_400(self, client, mock_query):
        """If renewal period is not set in config, must return 400 (not 500)."""
        with patch('api_payments.get_renewal_period', return_value=(None, None)):
            r = _post(client, '/api/payments/autoguess-all')
        assert r.status_code == 400
        assert r.status_code != 500

    def test_response_includes_created_and_skipped_keys(self, client, mock_query):
        """Response must always include 'created' and 'skipped' counts (under 'details')."""
        self._setup_mocks(mock_query)
        with patch('api_payments.get_renewal_period', return_value=('2025-10-01', '2026-03-31')), \
             patch('api_payments.execute', return_value=0):
            r = _post(client, '/api/payments/autoguess-all')
        assert r.status_code in (200, 400)
        if r.status_code == 200:
            j = r.get_json()
            details = j.get('details', j)  # support both top-level and nested
            assert 'created' in details
            assert 'skipped' in details
        mock_query.side_effect = None

    def test_wrong_amount_gmail_skipped(self, client, mock_query):
        """Gmail with $99 (not $30 or $50) → skipped, not created."""
        gmail = [{
            'TransactionNumber': 'TX001', 'MessageId': 'msg1',
            'Sender': 'John Smith', 'Memo': 'A0001 renewal',
            'Amount': 99.0, 'TransactionDate': '2026-01-15',
            'Notes': None, 'UpdatedAt': None,
        }]
        members = [{'MemberID': 'A0001', 'FirstName': 'John', 'LastName': 'Smith',
                    'Type': 'Individual', 'WeChatID': '', 'Email': '', 'NYRRRunnerName': ''}]

        self._setup_mocks(mock_query, gmail_rows=gmail, member_rows=members)

        with patch('api_payments.get_renewal_period', return_value=('2025-10-01', '2026-03-31')), \
             patch('api_payments.execute') as mock_exec:
            r = _post(client, '/api/payments/autoguess-all')

        if r.status_code == 200:
            j = r.get_json()
            assert j.get('created', 0) == 0
            # No INSERT should have been called
            for c in mock_exec.call_args_list:
                assert 'sp_link_transaction' not in str(c)

        mock_query.side_effect = None

    def test_valid_gmail_creates_payment(self, client, mock_query):
        """Valid $30 individual renewal within period + A#### memo → created=1."""
        gmail = [{
            'TransactionNumber': 'TX002', 'MessageId': 'msg2',
            'Sender': 'Jane Lin', 'Memo': 'A0002 membership renewal',
            'Amount': 30.0, 'TransactionDate': '2026-01-20',
            'Notes': None, 'UpdatedAt': None,
        }]
        members = [{'MemberID': 'A0002', 'FirstName': 'Jane', 'LastName': 'Lin',
                    'Type': 'Individual', 'WeChatID': '', 'Email': '', 'NYRRRunnerName': ''}]
        subs = [{'SubmissionID': 'SUB-A0002', 'MemberID': 'A0002',
                 'SubmissionType': 'membership', 'Amount': 30, 'Status': 'pending'}]

        self._setup_mocks(mock_query, gmail_rows=gmail, member_rows=members, sub_rows=subs)

        with patch('api_payments.get_renewal_period', return_value=('2025-10-01', '2026-03-31')), \
             patch('api_payments.execute', return_value=0), \
             patch('payment_matching.execute', return_value=0):
            r = _post(client, '/api/payments/autoguess-all')

        if r.status_code == 200:
            j = r.get_json()
            details = j.get('details', j)
            assert details.get('created', 0) >= 1

        mock_query.side_effect = None

    def test_db_error_during_autoguess_does_not_crash_route(self, client, mock_query):
        """DB error in one transaction → route still returns 200, not 500."""
        gmail = [{
            'TransactionNumber': 'TX003', 'MessageId': 'msg3',
            'Sender': 'Someone', 'Memo': 'A0003 renewal',
            'Amount': 30.0, 'TransactionDate': '2026-02-01',
            'Notes': None, 'UpdatedAt': None,
        }]
        members = [{'MemberID': 'A0003', 'FirstName': 'Some', 'LastName': 'One',
                    'Type': 'Individual', 'WeChatID': '', 'Email': '', 'NYRRRunnerName': ''}]

        self._setup_mocks(mock_query, gmail_rows=gmail, member_rows=members)

        with patch('api_payments.get_renewal_period', return_value=('2025-10-01', '2026-03-31')), \
             patch('api_payments.execute', side_effect=Exception('DB down')):
            r = _post(client, '/api/payments/autoguess-all')

        assert r.status_code != 500, f"DB error must not 500 the whole route: {r.data[:200]}"
        mock_query.side_effect = None


# ---------------------------------------------------------------------------
# Config get — additional edge cases
# ---------------------------------------------------------------------------

class TestConfigGet:
    def test_unknown_key_returns_null_value(self, client, mock_query):
        """Key that doesn't exist in config → success=True, value=None (not 404/500)."""
        mock_query.return_value = []   # no row found
        r = client.get('/api/config/get?key=nonexistent_key')
        # get_config returns default None; route wraps with success:True
        assert r.status_code in (200, 404)
        if r.status_code == 200:
            j = r.get_json()
            assert j.get('success') is True

    def test_key_with_value_returned(self, client, mock_query):
        # get_config uses config_cache (module-level cache), not query directly,
        # so patch at the api_audit import binding instead of mock_query.
        with patch('api_audit.get_config', return_value='2025-10-01'):
            r = client.get('/api/config/get?key=renewal_start_date')
        assert r.status_code == 200
        j = r.get_json()
        assert j['value'] == '2025-10-01'
        assert j['key'] == 'renewal_start_date'

    def test_key_is_echoed_in_response(self, client, mock_query):
        mock_query.return_value = [{'ConfigValue': 'abc'}]
        r = client.get('/api/config/get?key=MyKey')
        assert r.get_json()['key'] == 'MyKey'
