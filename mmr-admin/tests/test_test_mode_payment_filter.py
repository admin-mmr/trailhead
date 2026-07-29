"""
Contract tests for the Stripe test-mode exclusion (MIGRATION_V035 + V036).

V035 stamps test-mode Stripe rows as PaymentMethod = 'Stripe (TEST)' in both
`payments` and `gmail_transactions`. Anything that treats a payment row as real
money — reconciliation, membership-fee sync, the never-matched audit — must skip
them, or a $1 test charge silently activates a member / distorts a report.

These tests read the SQL actually sent to the DB, so they fail if someone edits a
query and drops the filter.
"""
import re

from payment_helpers import TEST_PAYMENT_METHOD, exclude_test_payments


def _sql_sent(mock_query):
    """All SQL strings passed to query() during the call under test."""
    return [c.args[0] for c in mock_query.call_args_list if c.args and isinstance(c.args[0], str)]


def _mentions_filter(sql: str, alias: str = 'p') -> bool:
    col = re.escape(f'{alias}.PaymentMethod')
    return bool(re.search(rf"{col}\s+IS NULL OR {col}\s*<>\s*'{re.escape(TEST_PAYMENT_METHOD)}'", sql))


# ---------------------------------------------------------------------------
# Helper itself
# ---------------------------------------------------------------------------

class TestExcludeTestPaymentsHelper:

    def test_default_alias(self):
        assert exclude_test_payments() == (
            "(p.PaymentMethod IS NULL OR p.PaymentMethod <> 'Stripe (TEST)')"
        )

    def test_custom_alias(self):
        assert 'fp.PaymentMethod' in exclude_test_payments('fp')

    def test_no_alias(self):
        frag = exclude_test_payments('')
        assert frag.startswith('(PaymentMethod IS NULL')

    def test_keeps_null_payment_method(self):
        # Legacy rows predate the column being populated — they must stay visible.
        assert 'IS NULL' in exclude_test_payments()


# ---------------------------------------------------------------------------
# Membership fee sync — writes MembershipFeePaid/PaymentDate onto real members
# ---------------------------------------------------------------------------

class TestMembershipFeeSyncExcludesTestPayments:

    def test_payments_query_filters_test_rows(self, client, mock_query):
        mock_query.return_value = []
        client.post('/api/sync/membership-fees', json={})

        payment_sqls = [s for s in _sql_sent(mock_query) if 'FROM payments p' in s]
        assert payment_sqls, 'membership-fee sync never queried payments'
        assert all(_mentions_filter(s) for s in payment_sqls)


# ---------------------------------------------------------------------------
# Never-matched / expiration-drift audit report
# ---------------------------------------------------------------------------

class TestExpirationDriftAuditExcludesTestPayments:

    def test_individual_join_filters_test_rows(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/audit/expiration-drift?type=individual')

        sqls = [s for s in _sql_sent(mock_query) if 'LEFT JOIN payments p' in s]
        assert sqls, 'individual drift report never joined payments'
        assert all(_mentions_filter(s) for s in sqls)

    def test_family_subquery_filters_test_rows(self, client, mock_query):
        mock_query.return_value = []
        client.get('/api/audit/expiration-drift?type=family')

        sqls = [s for s in _sql_sent(mock_query) if 'INNER JOIN payments fp' in s]
        assert sqls, 'family drift report never joined payments'
        assert all(_mentions_filter(s, 'fp') for s in sqls)


# ---------------------------------------------------------------------------
# Stored procedures (MIGRATION_V036) — guard the SQL that CI deploys
# ---------------------------------------------------------------------------

class TestMigrationV036:
    """Only asserts while the migration file is still in db/ (CI archives it on deploy)."""

    def _migration(self):
        from pathlib import Path
        p = Path(__file__).resolve().parents[2] / 'db' / 'MIGRATION_V036.sql'
        if not p.exists():
            p = Path(__file__).resolve().parents[2] / 'db' / 'archive' / 'MIGRATION_V036.sql'
        return p

    def test_both_procedures_filter_test_rows(self):
        p = self._migration()
        if not p.exists():
            return  # already deployed and pruned
        sql = p.read_text()
        assert sql.count(TEST_PAYMENT_METHOD) >= 2
        assert 'sp_reconcile_member_payments' in sql
        assert 'sp_renewal_audit' in sql
        assert "VALUES ('V036'" in sql  # self-registration is mandatory
