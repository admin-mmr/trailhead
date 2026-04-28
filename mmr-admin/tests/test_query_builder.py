"""
Tests for query_builder.py — add_search() and add_date_filter().

Pure functions, no DB. Coverage target: 100% (was 0%).

Run:
    cd mmr-admin
    python3 -m pytest tests/test_query_builder.py -v
"""
import pytest
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from query_builder import add_search, add_date_filter


# ── add_search ────────────────────────────────────────────────────────────────

class TestAddSearch:
    BASE_SQL = "SELECT * FROM members WHERE Status = 'active'"
    BASE_PARAMS = ['active']

    def test_empty_search_returns_unchanged(self):
        sql, params = add_search(self.BASE_SQL, self.BASE_PARAMS, '', ['FirstName'])
        assert sql == self.BASE_SQL
        assert params == self.BASE_PARAMS

    def test_none_search_returns_unchanged(self):
        sql, params = add_search(self.BASE_SQL, self.BASE_PARAMS, None, ['FirstName'])
        assert sql == self.BASE_SQL
        assert params == self.BASE_PARAMS

    def test_empty_columns_returns_unchanged(self):
        sql, params = add_search(self.BASE_SQL, self.BASE_PARAMS, 'alice', [])
        assert sql == self.BASE_SQL
        assert params == self.BASE_PARAMS

    def test_single_column_appends_and_clause(self):
        sql, params = add_search(self.BASE_SQL, [], 'alice', ['FirstName'])
        assert 'AND' in sql
        assert 'FirstName LIKE %s' in sql
        assert '%alice%' in params

    def test_multiple_columns_joined_with_or(self):
        sql, params = add_search(self.BASE_SQL, [], 'alice', ['FirstName', 'LastName'])
        assert 'FirstName LIKE %s' in sql
        assert 'LastName LIKE %s' in sql
        assert ' OR ' in sql
        # Two LIKE params
        assert params.count('%alice%') == 2

    def test_three_columns_all_present(self):
        sql, params = add_search(self.BASE_SQL, [], 'abc', ['m.FirstName', 'm.LastName', 'm.MemberID'])
        assert 'm.FirstName LIKE %s' in sql
        assert 'm.LastName LIKE %s' in sql
        assert 'm.MemberID LIKE %s' in sql
        assert params.count('%abc%') == 3

    def test_does_not_mutate_original_params(self):
        original = ['active']
        _, new_params = add_search(self.BASE_SQL, original, 'test', ['Email'])
        assert original == ['active']  # original unchanged
        assert '%test%' in new_params

    def test_like_wildcard_wraps_search_term(self):
        _, params = add_search(self.BASE_SQL, [], 'A0001', ['MemberID'])
        assert params == ['%A0001%']

    def test_search_with_spaces_not_split(self):
        # The function does not tokenize; 'john smith' becomes '%john smith%' in one param
        _, params = add_search(self.BASE_SQL, [], 'john smith', ['FirstName'])
        assert params == ['%john smith%']

    def test_returned_sql_has_and_before_parens(self):
        sql, _ = add_search(self.BASE_SQL, [], 'x', ['Col'])
        # Pattern: original_sql + ' AND (Col LIKE %s)'
        assert sql.endswith('AND (Col LIKE %s)')

    def test_existing_params_preserved_at_front(self):
        sql, params = add_search(self.BASE_SQL, ['active', 'admin'], 'x', ['Email'])
        assert params[0] == 'active'
        assert params[1] == 'admin'
        assert params[2] == '%x%'


# ── add_date_filter ───────────────────────────────────────────────────────────

class TestAddDateFilter:
    BASE_SQL = "SELECT * FROM payments WHERE 1=1"

    def test_appends_date_sub_clause(self):
        sql, params = add_date_filter(self.BASE_SQL, [], 'p.PaymentDate', 30)
        assert 'DATE_SUB(NOW(), INTERVAL %s DAY)' in sql
        assert 'p.PaymentDate >=' in sql
        assert 30 in params

    def test_does_not_mutate_original_params(self):
        original = [42]
        _, new_params = add_date_filter(self.BASE_SQL, original, 'p.PaymentDate', 7)
        assert original == [42]
        assert new_params == [42, 7]

    def test_column_name_appears_in_sql(self):
        sql, _ = add_date_filter(self.BASE_SQL, [], 'tx.TransactionDate', 90)
        assert 'tx.TransactionDate' in sql

    def test_days_zero_appends_filter(self):
        sql, params = add_date_filter(self.BASE_SQL, [], 'p.PaymentDate', 0)
        assert '%s' in sql
        assert 0 in params

    def test_days_365_works(self):
        _, params = add_date_filter(self.BASE_SQL, [], 'p.PaymentDate', 365)
        assert 365 in params

    def test_combined_with_add_search(self):
        from query_builder import add_search
        sql = "SELECT * FROM payments WHERE 1=1"
        sql, params = add_search(sql, [], 'alice', ['Sender'])
        sql, params = add_date_filter(sql, params, 'PaymentDate', 30)
        assert 'Sender LIKE %s' in sql
        assert 'DATE_SUB' in sql
        assert params == ['%alice%', 30]
