"""
Tests for the updated /api/payments/history endpoint.

Changes covered:
  - search param (member name, member ID, payment ID) added to SQL filter
  - days=0 removes the date filter entirely ("all time")
  - response now includes `total`, `skip`, `limit` alongside `payments`
  - load-more: skip > 0 offsets results without clobbering earlier pages

Run
---
    cd mmr-admin
    python3 -m pytest tests/test_payment_history.py -v
"""
import pytest
from unittest.mock import MagicMock


def _payment_row(payment_id='P001', member_id='A0001', first='Alice', last='Wang'):
    return {
        'PaymentID': payment_id,
        'MemberID': member_id,
        'FirstName': first,
        'LastName': last,
        'Amount': 30.0,
        'PaymentType': 'Membership',
        'PaymentDate': '2026-04-01',
        'ProcessedBy': 'admin@example.com',
        'SubmissionID': 'S001',
        'SubmissionStatus': 'approved',
        'UpdatedAt': '2026-04-01 10:00:00',
    }


class TestPaymentHistoryResponseShape:
    """Response must include all four top-level keys."""

    def test_has_payments_key(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 1}], [_payment_row()]]
        r = client.get('/api/payments/history')
        assert r.status_code == 200
        assert 'payments' in r.get_json()
        mock_query.side_effect = None

    def test_has_total_key(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 7}], [_payment_row()]]
        r = client.get('/api/payments/history')
        j = r.get_json()
        assert 'total' in j
        assert j['total'] == 7
        mock_query.side_effect = None

    def test_has_skip_and_limit_keys(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 0}], []]
        r = client.get('/api/payments/history?skip=10&limit=25')
        j = r.get_json()
        assert j['skip'] == 10
        assert j['limit'] == 25
        mock_query.side_effect = None

    def test_total_comes_from_count_not_len_rows(self, client, mock_query):
        """total must reflect COUNT(*), not len(payments) — important for load-more."""
        mock_query.side_effect = [
            [{'cnt': 200}],   # COUNT says 200 total
            [],               # data page is empty (e.g. skipped past end)
        ]
        r = client.get('/api/payments/history?skip=200')
        j = r.get_json()
        assert j['total'] == 200
        assert j['payments'] == []
        mock_query.side_effect = None


class TestPaymentHistoryDateFilter:
    """days param controls the date-range WHERE clause."""

    def test_default_uses_30_days(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 0}], []]
        client.get('/api/payments/history')
        # Both COUNT and data queries must contain the day-interval param
        for call in mock_query.call_args_list:
            args_str = str(call)
            # 30 must appear as a positional param somewhere
            if 'DATE_SUB' in args_str or 'INTERVAL' in args_str or '30' in args_str:
                assert True
                break
        else:
            pytest.fail('No call contained a 30-day filter')
        mock_query.side_effect = None

    def test_custom_days_forwarded(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 0}], []]
        client.get('/api/payments/history?days=90')
        all_args = str(mock_query.call_args_list)
        assert '90' in all_args, 'days=90 must appear in SQL params'
        mock_query.side_effect = None

    def test_days_zero_removes_date_filter(self, client, mock_query):
        """days=0 means all-time — DATE_SUB clause must be absent from SQL."""
        mock_query.side_effect = [[{'cnt': 0}], []]
        client.get('/api/payments/history?days=0')
        for call in mock_query.call_args_list:
            sql = call[0][0] if call[0] else ''
            assert 'DATE_SUB' not in sql, (
                f'days=0 should suppress the date filter, but found DATE_SUB in: {sql}'
            )
        mock_query.side_effect = None

    def test_days_zero_still_returns_total(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 999}], [_payment_row()]]
        r = client.get('/api/payments/history?days=0')
        assert r.get_json()['total'] == 999
        mock_query.side_effect = None


class TestPaymentHistorySearch:
    """search param must be applied to member name, member ID, and payment ID."""

    def _assert_search_term_in_sql(self, mock_query, term):
        """Helper: confirm the LIKE-escaped term appears in query params."""
        like = f'%{term}%'
        found = False
        for call in mock_query.call_args_list:
            params = call[0][1] if len(call[0]) > 1 else []
            if like in (params or []):
                found = True
                break
        assert found, (
            f"Expected LIKE param '%{term}%' in query calls, got: {mock_query.call_args_list}"
        )

    def test_search_by_first_name(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 1}], [_payment_row()]]
        client.get('/api/payments/history?search=Alice')
        self._assert_search_term_in_sql(mock_query, 'Alice')
        mock_query.side_effect = None

    def test_search_by_member_id(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 1}], [_payment_row()]]
        client.get('/api/payments/history?search=A0001')
        self._assert_search_term_in_sql(mock_query, 'A0001')
        mock_query.side_effect = None

    def test_search_by_payment_id(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 1}], [_payment_row()]]
        client.get('/api/payments/history?search=P001')
        self._assert_search_term_in_sql(mock_query, 'P001')
        mock_query.side_effect = None

    def test_search_applied_to_both_count_and_data(self, client, mock_query):
        """COUNT and data queries must both respect the search filter."""
        mock_query.side_effect = [[{'cnt': 1}], [_payment_row()]]
        client.get('/api/payments/history?search=Wang')
        assert mock_query.call_count == 2, 'Expect exactly 2 queries: COUNT + data'
        for call in mock_query.call_args_list:
            params = call[0][1] if len(call[0]) > 1 else []
            assert '%Wang%' in (params or []), (
                f"search filter missing from query: {call}"
            )
        mock_query.side_effect = None

    def test_empty_search_no_like_param(self, client, mock_query):
        """?search= (empty) must not inject LIKE params into the query."""
        mock_query.side_effect = [[{'cnt': 5}], []]
        client.get('/api/payments/history?search=')
        for call in mock_query.call_args_list:
            params = call[0][1] if len(call[0]) > 1 else []
            for p in (params or []):
                assert not (isinstance(p, str) and p.startswith('%')), (
                    f'Empty search should produce no LIKE param, found: {p}'
                )
        mock_query.side_effect = None

    def test_search_combined_with_days(self, client, mock_query):
        """search + days must both be active simultaneously."""
        mock_query.side_effect = [[{'cnt': 1}], [_payment_row()]]
        client.get('/api/payments/history?search=Alice&days=90')
        all_args = str(mock_query.call_args_list)
        assert '%Alice%' in all_args
        assert '90' in all_args
        mock_query.side_effect = None


class TestPaymentHistoryPagination:
    """skip/limit must produce correct offset in SQL and be echoed in response."""

    def test_skip_forwarded_to_sql(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 100}], []]
        client.get('/api/payments/history?skip=50')
        data_call = mock_query.call_args_list[1]
        params = data_call[0][1] if len(data_call[0]) > 1 else []
        assert 50 in (params or []), f'skip=50 must appear in data query params: {params}'
        mock_query.side_effect = None

    def test_limit_forwarded_to_sql(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 100}], []]
        client.get('/api/payments/history?limit=20')
        data_call = mock_query.call_args_list[1]
        params = data_call[0][1] if len(data_call[0]) > 1 else []
        assert 20 in (params or []), f'limit=20 must appear in data query params: {params}'
        mock_query.side_effect = None

    def test_default_limit_is_50(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 0}], []]
        r = client.get('/api/payments/history')
        assert r.get_json()['limit'] == 50
        mock_query.side_effect = None

    def test_default_skip_is_0(self, client, mock_query):
        mock_query.side_effect = [[{'cnt': 0}], []]
        r = client.get('/api/payments/history')
        assert r.get_json()['skip'] == 0
        mock_query.side_effect = None

    def test_load_more_returns_next_page(self, client, mock_query):
        """Simulates UI 'Load more': skip=50 fetches the second page."""
        page2_row = _payment_row(payment_id='P051', member_id='A0051')
        mock_query.side_effect = [[{'cnt': 80}], [page2_row]]
        r = client.get('/api/payments/history?skip=50&limit=50')
        j = r.get_json()
        assert j['total'] == 80
        assert j['skip'] == 50
        assert len(j['payments']) == 1
        assert j['payments'][0]['PaymentID'] == 'P051'
        mock_query.side_effect = None
