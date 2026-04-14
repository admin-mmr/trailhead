"""
Static analysis tests: chk_actlog_email_valid constraint guard.

Recurring bug pattern:
  Symptom  : MySQL 3819 (HY000) "Check constraint 'chk_actlog_email_valid' is violated"
  Constraint: activity_log.Email must be NULL or contain '@'
              (Email IS NULL OR Email LIKE '%@%')
  Root cause: Session-email helpers used a string literal fallback ('admin', 'unknown', etc.)
              that contains no '@'. The fallback is inserted as-is into activity_log.Email,
              violating the CHECK constraint.
  Example  : session.get('user', {}).get('email', 'admin')  ← 'admin' has no '@'
  Fixed in : api_payments.py (3 sites), api_members_status.py (get_admin_id fallback)
  Guard    : No api_*.py file may use a bare string literal as email fallback unless
             it contains '@' or is empty (falsy → stored as NULL by activity_logger).

No live DB required — purely static analysis of source files.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_actlog_email_constraint.py -v
"""

import re
import ast
import pathlib
import pytest

ADMIN_ROOT = pathlib.Path(__file__).parent.parent

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _source_files() -> list[pathlib.Path]:
    return sorted(ADMIN_ROOT.glob('api_*.py')) + [ADMIN_ROOT / 'activity_logger.py']


def _all_source() -> list[tuple[str, str]]:
    """Return (filename, source) for every relevant Python file."""
    return [(p.name, p.read_text()) for p in _source_files() if p.exists()]


# Pattern 1: admin_email = session.get('user', {}).get('email', FALLBACK)
# Pattern 2: admin_email = session.get('user_email', FALLBACK)
# Pattern 3: get_admin_id() body with a string literal fallback
# Only flag when the variable is named admin_email or is a get_admin_id helper,
# since those values are the ones wired into activity_log.Email.
# Other uses (display, access-control) may legitimately use non-email fallbacks.
_ADMIN_EMAIL_ASSIGN_PATTERN = re.compile(
    r"admin_email\s*=\s*session\.get\(['\"]user['\"],\s*\{\}\)\.get\(['\"]email['\"],\s*(['\"][^'\"]+['\"])\)"
    r"|admin_email\s*=\s*session\.get\(['\"]user_email['\"],\s*(['\"][^'\"]+['\"])\)",
)


def _extract_bad_admin_email_fallbacks(source: str) -> list[tuple[int, str]]:
    """
    Return (lineno, fallback) for every admin_email = session.get(…) assignment
    whose fallback is a non-empty string literal without '@'.
    These are the values that flow into activity_log.Email.
    """
    bad = []
    lines = source.splitlines()
    for i, line in enumerate(lines, start=1):
        for m in _ADMIN_EMAIL_ASSIGN_PATTERN.finditer(line):
            fallback = (m.group(1) or m.group(2) or '').strip("'\"")
            if fallback and '@' not in fallback:
                bad.append((i, fallback))
    return bad


# ---------------------------------------------------------------------------
# Test: no non-email string literals as admin_email fallbacks
# ---------------------------------------------------------------------------

class TestSessionEmailFallbacks:
    """
    Any variable named admin_email that is sourced from session must use
    None / falsy as its fallback, not a plain string like 'admin' or 'unknown'.

    Scope is intentionally limited to `admin_email` assignments — these are the
    values wired into activity_log.Email (via log_activity or direct INSERT).
    Other session.get email reads (for display, access control, audit columns
    on non-Email-constrained fields) are out of scope for this constraint.
    """

    def test_no_non_email_admin_email_fallbacks_in_api_files(self):
        violations = []
        for fname, source in _all_source():
            for lineno, fallback in _extract_bad_admin_email_fallbacks(source):
                violations.append((fname, lineno, fallback))

        assert not violations, (
            "Found admin_email session reads with non-email string fallbacks.\n"
            "These violate chk_actlog_email_valid when stored in activity_log.Email.\n\n"
            + "\n".join(
                f"  {fname}:{line} — fallback={fallback!r}  "
                f"(must be None or contain '@')"
                for fname, line, fallback in violations
            )
            + "\n\nFix: admin_email = session.get('user', {}).get('email') or None"
        )

    def test_api_payments_fallbacks_are_safe(self):
        """
        Regression: api_payments.py had 3 sites using 'admin' as fallback.
        Ensure none remain.
        """
        path = ADMIN_ROOT / 'api_payments.py'
        if not path.exists():
            pytest.fail("api_payments.py not found")
        source = path.read_text()
        bad = _extract_bad_admin_email_fallbacks(source)
        assert not bad, (
            f"api_payments.py still has non-email email fallbacks: {bad}\n"
            "These were fixed to `or None` — do not reintroduce string literals."
        )

    def test_api_members_status_get_admin_id_is_safe(self):
        """
        Regression: get_admin_id() in api_members_status.py returned 'unknown'
        which was passed as admin_email to log_activity → activity_log.Email.
        Ensure the fallback is now None-producing.
        """
        path = ADMIN_ROOT / 'api_members_status.py'
        if not path.exists():
            pytest.fail("api_members_status.py not found")
        source = path.read_text()

        # Find get_admin_id function body (up to next def)
        m = re.search(r'def get_admin_id\(\):(.*?)(?=\ndef |\Z)', source, re.DOTALL)
        assert m, "get_admin_id() function not found in api_members_status.py"
        body = m.group(1)

        # Must not contain a non-email string literal as the return value
        bad_literals = re.findall(r"return\s+['\"]([^'\"@]+)['\"]", body)
        assert not bad_literals, (
            f"get_admin_id() returns a non-email string literal: {bad_literals}\n"
            "It must return None (or a value that is falsy) when email is absent."
        )

        # Must not use a non-email string as session.get fallback
        bad_fallbacks = _extract_bad_admin_email_fallbacks(body)
        assert not bad_fallbacks, (
            f"get_admin_id() uses a non-email fallback: {bad_fallbacks}"
        )


# ---------------------------------------------------------------------------
# Test: activity_logger safely converts empty/None to SQL NULL
# ---------------------------------------------------------------------------

class TestActivityLoggerNullGuard:
    """
    activity_logger.log_activity() must convert falsy admin_email to None
    before writing to activity_log.Email.  None → SQL NULL passes the CHECK
    constraint; an empty string '' does NOT (MySQL treats '' as non-null).

    This is the single safe-conversion point for all callers.
    """

    def test_activity_logger_uses_or_none_guard(self):
        path = ADMIN_ROOT / 'activity_logger.py'
        if not path.exists():
            pytest.fail("activity_logger.py not found")
        source = path.read_text()

        # Expect the pattern `admin_email or None` somewhere before the INSERT
        assert 'admin_email or None' in source or 'or None' in source, (
            "activity_logger.py must convert admin_email to None when falsy "
            "(e.g. `admin_email or None`) before the INSERT. "
            "Empty string '' inserted as Email would still violate chk_actlog_email_valid."
        )

    def test_activity_logger_default_is_falsy(self):
        """
        The default value for admin_email in log_activity() signature must be
        falsy (None or '') so callers that omit it don't insert a bad value.
        """
        path = ADMIN_ROOT / 'activity_logger.py'
        if not path.exists():
            pytest.fail("activity_logger.py not found")
        source = path.read_text()
        tree = ast.parse(source)

        for node in ast.walk(tree):
            if isinstance(node, ast.FunctionDef) and node.name == 'log_activity':
                for arg, default in zip(
                    reversed(node.args.args),
                    reversed(node.args.defaults),
                ):
                    if arg.arg == 'admin_email':
                        # Default must be None or empty string (both falsy → NULL in DB)
                        is_none = isinstance(default, ast.Constant) and default.value is None
                        is_empty = isinstance(default, ast.Constant) and default.value == ''
                        assert is_none or is_empty, (
                            f"log_activity(admin_email=...) default is "
                            f"{ast.unparse(default)!r} — must be None or '' "
                            f"so omitted callers don't write a bad Email value."
                        )
                        return
        # If we reach here, admin_email param wasn't found — skip rather than fail
        pytest.fail("Could not locate admin_email parameter in log_activity()")


# ---------------------------------------------------------------------------
# Test: direct activity_log INSERT statements don't use string literals for Email
# ---------------------------------------------------------------------------

class TestDirectActivityLogInserts:
    """
    Some code paths bypass log_activity() and INSERT into activity_log directly.
    These must not use a hardcoded non-email string literal in the Email column.
    """

    # Matches: INSERT INTO activity_log (...Email...) VALUES (..., 'something', ...)
    # We look for string literals adjacent to Email in the column list.
    _INSERT_PATTERN = re.compile(
        r"INSERT\s+INTO\s+activity_log\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)",
        re.IGNORECASE | re.DOTALL,
    )

    def _find_direct_inserts(self, source: str) -> list[tuple[int, str, str]]:
        """
        Return (lineno, columns, values) for every direct activity_log INSERT.
        """
        results = []
        for m in self._INSERT_PATTERN.finditer(source):
            lineno = source[: m.start()].count('\n') + 1
            results.append((lineno, m.group(1), m.group(2)))
        return results

    def test_no_hardcoded_non_email_in_direct_inserts(self):
        """
        Direct INSERT INTO activity_log must not use a hardcoded non-email
        string literal in the position corresponding to the Email column.
        Parameterised queries (%s) are always safe.
        """
        violations = []
        for fname, source in _all_source():
            for lineno, cols, vals in self._find_direct_inserts(source):
                col_list = [c.strip().strip('`') for c in cols.split(',')]
                val_list = [v.strip() for v in vals.split(',')]

                if 'Email' not in col_list:
                    continue

                email_idx = col_list.index('Email')
                if email_idx >= len(val_list):
                    continue

                email_val = val_list[email_idx]
                # %s placeholder is safe; None/NULL literal is safe; string with @ is safe
                if email_val == '%s' or email_val.upper() == 'NULL':
                    continue
                # String literal without @
                literal_m = re.match(r"^['\"]([^'\"]*)['\"]$", email_val)
                if literal_m and '@' not in literal_m.group(1):
                    violations.append((fname, lineno, email_val))

        assert not violations, (
            "Direct INSERT INTO activity_log uses a non-email string literal "
            "in the Email column:\n"
            + "\n".join(f"  {f}:{l} — {v}" for f, l, v in violations)
            + "\n\nUse %s with a Python variable that is None when email is absent."
        )
