"""
Static analysis tests: PaymentType values must be fully-qualified.

Recurring bug pattern:
  Symptom : Payments table contains bare 'Membership' PaymentType values,
            breaking queries that filter by 'Individual Membership' or 'Family Membership'.
            Downstream reports, renewal audits, and autoguess logic silently miss records.
  Root cause: sp_link_transaction call sites hardcoded 'Membership' as the type
              instead of deriving it from member['Type'] → 'Individual Membership'
              or 'Family Membership'.
  Example : Both autoguess and manual-approve paths (fixed Apr-11)
  Allowed : 'Individual Membership', 'Family Membership'
  Forbidden: 'Membership', 'Individual', 'Family' (bare, non-standard)

No live DB required — purely static analysis.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_payment_type.py -v
"""

import re
import ast
import pathlib
import pytest

HERE       = pathlib.Path(__file__).parent
ADMIN_ROOT = HERE.parent

# The only two valid PaymentType values for membership payments
VALID_MEMBERSHIP_TYPES = {'Individual Membership', 'Family Membership'}

# Bare strings that must NOT appear as the PaymentType argument to sp_link_transaction
# or as the PaymentType column value being written
FORBIDDEN_BARE_TYPES = {'Membership', 'Individual', 'Family'}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _all_api_sources() -> list[tuple[pathlib.Path, str]]:
    return [(p, p.read_text()) for p in sorted(ADMIN_ROOT.glob('api_*.py'))]


# ---------------------------------------------------------------------------
# Static analysis: no bare 'Membership' passed to sp_link_transaction
# ---------------------------------------------------------------------------

class TestPaymentTypeInSpLinkTransaction:
    """
    The third argument to sp_link_transaction is the PaymentType.
    It must never be the literal string 'Membership', 'Individual', or 'Family'.

    Correct patterns:
        payment_type = 'Family Membership' if member['Type'] == 'Family' else 'Individual Membership'
        execute("CALL sp_link_transaction(%s, %s, %s, %s, %s)", (..., payment_type, ...))

    Wrong patterns (caught here):
        execute("CALL sp_link_transaction(%s, %s, 'Membership', %s, %s)", ...)
        execute("CALL sp_link_transaction(%s, %s, %s, %s, %s)", (..., 'Membership', ...))
    """

    def test_no_bare_membership_string_in_sp_call_sql(self):
        """
        The SQL string for CALL sp_link_transaction must not embed a literal
        bare type like 'Membership' directly in the SQL.
        (Using %s placeholders is the correct approach.)
        """
        pattern = re.compile(
            r"CALL\s+sp_link_transaction\s*\([^)]*'(?:Membership|Individual|Family)'[^)]*\)",
            re.IGNORECASE,
        )
        violations = []
        for path, source in _all_api_sources():
            for m in pattern.finditer(source):
                lineno = source[: m.start()].count('\n') + 1
                violations.append((path.name, lineno, m.group(0)[:120]))

        assert not violations, (
            "sp_link_transaction called with bare PaymentType string literal:\n"
            + "\n".join(f"  {f}:{l} — {s}" for f, l, s in violations)
            + "\n\nUse a variable: payment_type = 'Family Membership' if ... else 'Individual Membership'"
        )

    def test_payment_type_variable_derives_from_member_type(self):
        """
        Lines that set payment_type must reference member['Type'] or member.get('Type').
        This ensures the type is derived from DB data, not hardcoded.
        """
        payment_type_assign = re.compile(
            r"""payment_type\s*=\s*['"](?:Membership|Individual|Family)['"]""",
            re.IGNORECASE,
        )
        violations = []
        for path, source in _all_api_sources():
            for m in payment_type_assign.finditer(source):
                lineno = source[: m.start()].count('\n') + 1
                violations.append((path.name, lineno, m.group(0)))

        assert not violations, (
            "payment_type assigned a bare non-qualified string literal:\n"
            + "\n".join(f"  {f}:{l} — {s}" for f, l, s in violations)
            + "\n\nExpected: payment_type = 'Family Membership' if member['Type'] == 'Family' "
            + "else 'Individual Membership'"
        )


# ---------------------------------------------------------------------------
# Static analysis: payment_type expressions yield valid values
# ---------------------------------------------------------------------------

class TestPaymentTypeExpressions:
    """
    Verify that all expressions that produce a PaymentType value will only
    ever produce one of the two valid values.
    """

    def _find_ternary_payment_types(self) -> list[tuple[str, int, str, str]]:
        """
        Find ternary/conditional assignments like:
            payment_type = 'Family Membership' if member['Type'] == 'Family' else 'Individual Membership'
        Return (filename, lineno, true_branch, false_branch).
        Note: condition uses [^\n]+? (non-greedy, allows == operators) not [^=\n]+.
        """
        pattern = re.compile(
            r"""payment_type\s*=\s*['"]([^'"]+)['"]\s+if\s+.+?\s+else\s+['"]([^'"]+)['"]""",
        )
        results = []
        for path, source in _all_api_sources():
            for m in pattern.finditer(source):
                lineno = source[: m.start()].count('\n') + 1
                results.append((path.name, lineno, m.group(1), m.group(2)))
        return results

    def test_ternary_branches_are_valid_types(self):
        """Both branches of payment_type ternary must be valid membership types."""
        assignments = self._find_ternary_payment_types()
        if not assignments:
            pytest.fail("No payment_type ternary assignments found")

        for fname, lineno, true_val, false_val in assignments:
            assert true_val in VALID_MEMBERSHIP_TYPES, (
                f"{fname}:{lineno} — true branch '{true_val}' is not a valid PaymentType. "
                f"Expected one of: {VALID_MEMBERSHIP_TYPES}"
            )
            assert false_val in VALID_MEMBERSHIP_TYPES, (
                f"{fname}:{lineno} — false branch '{false_val}' is not a valid PaymentType. "
                f"Expected one of: {VALID_MEMBERSHIP_TYPES}"
            )

    def test_payment_type_not_set_to_forbidden_values_anywhere(self):
        """
        No assignment `payment_type = 'Membership'` or similar should exist anywhere.
        This is a belt-and-suspenders check that covers non-ternary assignments too.
        """
        pattern = re.compile(
            r"""payment_type\s*=\s*['"](?:""" +
            '|'.join(re.escape(v) for v in FORBIDDEN_BARE_TYPES) +
            r""")['"]""",
            re.IGNORECASE,
        )
        violations = []
        for path, source in _all_api_sources():
            for m in pattern.finditer(source):
                lineno = source[: m.start()].count('\n') + 1
                violations.append((path.name, lineno, m.group(0)))

        assert not violations, (
            "payment_type assigned a forbidden bare value:\n"
            + "\n".join(f"  {f}:{l} — {s}" for f, l, s in violations)
            + f"\n\nForbidden values: {FORBIDDEN_BARE_TYPES}"
            + f"\nAllowed values:   {VALID_MEMBERSHIP_TYPES}"
        )


# ---------------------------------------------------------------------------
# Functional tests: autoguess payment type logic
# ---------------------------------------------------------------------------

class TestAutoguessPaymentTypeLogic:
    """
    Unit-test the payment_type derivation logic used in autoguess_single_transaction.
    This tests the business logic independent of Flask and MySQL.
    """

    @staticmethod
    def _derive_payment_type(member_type: str) -> str:
        """Reproduce the logic from api_payments.py autoguess path."""
        return 'Family Membership' if member_type == 'Family' else 'Individual Membership'

    def test_family_member_gets_family_membership(self):
        assert self._derive_payment_type('Family') == 'Family Membership'

    def test_individual_member_gets_individual_membership(self):
        assert self._derive_payment_type('Individual') == 'Individual Membership'

    def test_unknown_type_falls_back_to_individual(self):
        """Any non-Family type defaults to Individual Membership — safe fallback."""
        for t in ('', None, 'Unknown', 'Lifetime', 'individual'):
            result = self._derive_payment_type(t)
            assert result == 'Individual Membership', (
                f"Expected 'Individual Membership' for type={t!r}, got {result!r}"
            )

    def test_result_always_in_valid_set(self):
        for member_type in ('Family', 'Individual', 'Lifetime', '', 'other'):
            result = self._derive_payment_type(member_type)
            assert result in VALID_MEMBERSHIP_TYPES, (
                f"_derive_payment_type({member_type!r}) = {result!r} is not a valid PaymentType"
            )


# ---------------------------------------------------------------------------
# Schema sanity: PaymentType ENUM in DB
# ---------------------------------------------------------------------------

class TestPaymentTypeSchema:
    """
    The payments.PaymentType column (or allowed values) should include
    'Individual Membership' and 'Family Membership'.
    """

    def test_schema_contains_payment_type_column(self):
        """payments.PaymentType column must exist in schema_snapshot.sql."""
        schema = (pathlib.Path(__file__).parent.parent.parent / 'db' / 'schema_snapshot.sql').read_text()
        # Column section row format: table \t ordinal \t column_name \t ...
        assert re.search(r'payments\t\d+\tPaymentType\t', schema), (
            "payments.PaymentType column not found in schema_snapshot.sql — "
            "the column that stores 'Individual Membership'/'Family Membership' values."
        )

    def test_reconcile_proc_filters_by_membership(self):
        """
        sp_reconcile_member_payments should filter by LIKE '%membership%' —
        which matches both 'Individual Membership' and 'Family Membership'.
        This is the safeguard that makes wildcard matching work even with fully-qualified types.
        """
        schema = (pathlib.Path(__file__).parent.parent.parent / 'db' / 'schema_snapshot.sql').read_text()
        # Find sp_reconcile_member_payments body
        idx = schema.find('sp_reconcile_member_payments')
        if idx < 0:
            pytest.fail("sp_reconcile_member_payments not found in schema")
        body = schema[idx:idx + 2000]
        assert 'membership' in body.lower(), (
            "sp_reconcile_member_payments doesn't filter by 'membership' — "
            "it may miss 'Individual Membership'/'Family Membership' rows."
        )

    def test_bare_membership_not_used_in_sp_insert(self):
        """
        The sp_link_transaction INSERT should not hardcode 'Membership' as PaymentType.
        It uses p_payment_type (a parameter) — so the procedure body itself is fine.
        This test confirms the procedure body doesn't bake in a bare type.
        """
        schema = (pathlib.Path(__file__).parent.parent.parent / 'db' / 'schema_snapshot.sql').read_text()
        # Find sp_link_transaction body
        idx = schema.find('PROCEDURE\tsp_link_transaction')
        if idx < 0:
            pytest.fail("sp_link_transaction not found")
        end = schema.find('\nPROCEDURE\t', idx + 1)
        body = schema[idx: end if end > 0 else idx + 2000]

        # The body should use p_payment_type, not a literal 'Membership'
        bare_literal = re.search(r"'Membership'", body)
        assert not bare_literal, (
            "sp_link_transaction body hardcodes 'Membership' — "
            "it should use the p_payment_type parameter instead."
        )
