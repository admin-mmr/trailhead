"""
Static analysis tests: safe_columns whitelists and stored-procedure call sites.

Recurring bug pattern #1 — Stale column in safe_columns whitelist:
  Symptom : MySQL error 1054 "Unknown column 'LastLogin' in 'order clause'"
  Root cause: DB column deleted/renamed, whitelist not updated, sortBy param
              restored from localStorage still passes whitelist check → raw SQL injection
  Example : LastLogin → LastModified rename (fixed Apr-11)
  Guard   : safe_columns in api_district_members.py must only contain
            columns that exist in schema_snapshot.sql

Recurring bug pattern #2 — sp_link_transaction called with wrong param count:
  Symptom : MySQL error "Incorrect number of arguments for PROCEDURE"
  Root cause: Stored procedure takes 5 params; one call site passes 6
              (includes admin_email that the procedure doesn't accept)
  Example : manual-approve path (line ~395) vs admin-create path (line ~757)
  Guard   : every CALL sp_link_transaction(...) in api_*.py must use exactly
            the number of params the schema defines.

No live DB required — purely static analysis of source files.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_safe_columns.py -v
"""

import ast
import re
import pathlib
import pytest

HERE      = pathlib.Path(__file__).parent
REPO_ROOT = HERE.parent.parent
ADMIN_ROOT = HERE.parent
SCHEMA_FILE = REPO_ROOT / 'db' / 'schema_snapshot.sql'


# ---------------------------------------------------------------------------
# Schema helpers (shared with test_sql_columns.py approach)
# ---------------------------------------------------------------------------

def _load_known_columns() -> set[str]:
    """Return all column names from the schema (case-preserved)."""
    text = SCHEMA_FILE.read_text()
    col_section = re.search(r'=== 2\. COLUMNS ===.*?(?==== \d\.)', text, re.DOTALL)
    if not col_section:
        raise ValueError("Could not find '=== 2. COLUMNS ===' in schema_snapshot.sql")
    columns: set[str] = set()
    for line in col_section.group().splitlines():
        parts = line.split('\t')
        if len(parts) >= 3 and parts[1].isdigit():
            columns.add(parts[2].strip())
    return columns


# ---------------------------------------------------------------------------
# safe_columns extraction from api_district_members.py
# ---------------------------------------------------------------------------

def _extract_safe_columns() -> set[str]:
    """
    Parse api_district_members.py and return the set literal assigned to safe_columns.
    We look for:
        safe_columns = { ... }
    and collect all string elements.
    """
    src_file = ADMIN_ROOT / 'api_district_members.py'
    if not src_file.exists():
        pytest.fail(f"{src_file.name} not found")

    source = src_file.read_text()
    tree = ast.parse(source, filename=str(src_file))

    for node in ast.walk(tree):
        # Assignment: safe_columns = {...}
        if isinstance(node, ast.Assign):
            for target in node.targets:
                if isinstance(target, ast.Name) and target.id == 'safe_columns':
                    val = node.value
                    if isinstance(val, ast.Set):
                        return {
                            elt.value
                            for elt in val.elts
                            if isinstance(elt, ast.Constant) and isinstance(elt.value, str)
                        }
        # AugAssign, AnnAssign would be unusual here — skip

    # Fallback: regex if AST misses it (e.g. multi-line set literal)
    m = re.search(r'safe_columns\s*=\s*\{([^}]+)\}', source)
    if m:
        return {s.strip().strip("'\"") for s in m.group(1).split(',') if s.strip().strip("'\"")}

    pytest.fail("Could not find safe_columns assignment in api_district_members.py")


# ---------------------------------------------------------------------------
# sp_link_transaction: expected param count from schema
# ---------------------------------------------------------------------------

def _sp_link_transaction_param_count() -> int:
    """
    Count the number of parameters sp_link_transaction expects by scanning
    the procedure body in schema_snapshot.sql for p_* variable references.
    Uses the parameter names seen in the INSERT VALUES clause as ground truth.
    """
    text = SCHEMA_FILE.read_text()
    # Find the procedure body
    idx = text.find('PROCEDURE\tsp_link_transaction')
    if idx < 0:
        pytest.fail("sp_link_transaction not found in schema_snapshot.sql")

    # Extract until next PROCEDURE or end
    end_idx = text.find('\nPROCEDURE\t', idx + 1)
    body = text[idx: end_idx if end_idx > 0 else idx + 3000]

    # Find INSERT INTO payments VALUES (...) and count the p_* params used
    # They are: p_member_id, p_transaction_number, p_payment_type, p_amount, p_submission_id
    params = set(re.findall(r'\b(p_\w+)\b', body))
    return len(params)


def _find_sp_call_sites() -> list[tuple[str, int, int]]:
    """
    Return (filename, lineno, placeholder_count) for every
    CALL sp_link_transaction(...) found in api_*.py files.
    """
    sites = []
    pattern = re.compile(
        r'CALL\s+sp_link_transaction\s*\(([^)]+)\)',
        re.IGNORECASE | re.DOTALL,
    )
    for path in sorted(ADMIN_ROOT.glob('api_*.py')):
        source = path.read_text()
        for lineno, line in enumerate(source.splitlines(), start=1):
            pass  # just to get lineno mapping — use search on full source below

        for m in pattern.finditer(source):
            # Count %s placeholders in the argument list
            args_str = m.group(1)
            count = args_str.count('%s')
            # Find approximate line number
            lineno = source[: m.start()].count('\n') + 1
            sites.append((path.name, lineno, count))
    return sites


# ---------------------------------------------------------------------------
# Tests: safe_columns
# ---------------------------------------------------------------------------

class TestSafeColumns:
    """
    Every entry in safe_columns must exist in schema_snapshot.sql.

    Prevents "Unknown column '...' in ORDER BY" bugs where a deleted/renamed
    DB column is still whitelisted and gets injected into a raw SQL ORDER BY.
    """

    def test_safe_columns_all_in_schema(self):
        """
        All safe_columns entries must be either:
          (a) a real column in schema_snapshot.sql, OR
          (b) a known SQL alias defined in the same query
              (e.g. UpdatedAt aliased as LastModified — ORDER BY can use aliases)
        Virtual sort keys like 'Name' (expands to FirstName/LastName in code) are also allowed.
        """
        safe_cols = _extract_safe_columns()
        known = _load_known_columns()
        known_lower = {c.lower() for c in known}

        # SQL aliases defined in api_district_members.py that are valid ORDER BY targets
        # because MySQL allows ORDER BY to reference SELECT-list aliases
        known_aliases = {'LastModified', 'Name'}  # UpdatedAt AS LastModified; virtual Name sort

        bad = [
            col for col in safe_cols
            if col.lower() not in known_lower
            and col not in known_aliases
        ]
        assert not bad, (
            f"safe_columns contains entries not in schema and not a known alias: {sorted(bad)}\n"
            f"These would cause MySQL 1054 if used for ORDER BY.\n"
            f"If this is a query alias (e.g. UpdatedAt AS SomeAlias), add it to known_aliases above.\n"
            f"If it's a deleted column, remove it from safe_columns in api_district_members.py."
        )

    def test_safe_columns_not_empty(self):
        safe_cols = _extract_safe_columns()
        assert len(safe_cols) >= 3, f"safe_columns seems too small: {safe_cols}"

    def test_last_login_not_in_safe_columns(self):
        """
        Regression: 'LastLogin' was the deleted column that caused production 1054 errors.
        It must never reappear in safe_columns.
        """
        safe_cols = _extract_safe_columns()
        assert 'LastLogin' not in safe_cols, (
            "'LastLogin' is in safe_columns but this column was deleted from the DB. "
            "Use 'LastModified' (aliased from UpdatedAt) instead."
        )

    def test_last_login_date_not_in_safe_columns(self):
        """'LastLoginDate' is the JS frontend name — must not appear in Python whitelist."""
        safe_cols = _extract_safe_columns()
        assert 'LastLoginDate' not in safe_cols, (
            "'LastLoginDate' is in safe_columns — this column was removed from the DB."
        )

    def test_last_modified_in_safe_columns(self):
        """
        'LastModified' is the correct alias for UpdatedAt in the district query.
        If it's missing, sorting by date column will silently fall back to District.
        """
        safe_cols = _extract_safe_columns()
        assert 'LastModified' in safe_cols, (
            "'LastModified' is missing from safe_columns. "
            "The district query aliases UpdatedAt as LastModified and it should be sortable."
        )


# ---------------------------------------------------------------------------
# Tests: sp_link_transaction call site consistency
# ---------------------------------------------------------------------------

class TestSpLinkTransactionParams:
    """
    All call sites for sp_link_transaction must use exactly the same number
    of parameters as the stored procedure definition expects.

    Prevents: "Incorrect number of arguments for PROCEDURE sp_link_transaction"
    Example bug: manual-approve path called with 6 params (added admin_email),
                 but the procedure only accepts 5.
    """

    def test_sp_param_count_consistent_across_call_sites(self):
        """All CALL sp_link_transaction sites must agree on parameter count."""
        sites = _find_sp_call_sites()
        if not sites:
            pytest.fail("No sp_link_transaction call sites found")

        counts = {count for _, _, count in sites}
        assert len(counts) == 1, (
            f"sp_link_transaction called with inconsistent param counts: {counts}\n"
            + "\n".join(f"  {fname}:{line} — {cnt} params" for fname, line, cnt in sites)
            + "\n\nAll call sites must pass the same number of arguments."
        )

    def test_sp_param_count_matches_schema(self):
        """
        Call sites must pass exactly as many params as the procedure expects.

        sp_link_transaction(p_transaction_number, p_member_id, p_payment_type,
                            p_amount, p_submission_id) = 5 params.
        Adding admin_email as a 6th param would cause a MySQL error.
        """
        sites = _find_sp_call_sites()
        if not sites:
            pytest.fail("No sp_link_transaction call sites found")

        expected = _sp_link_transaction_param_count()
        if expected == 0:
            pytest.fail("Could not determine expected param count from schema")

        for fname, lineno, count in sites:
            assert count == expected, (
                f"{fname}:{lineno} calls sp_link_transaction with {count} params "
                f"but the procedure definition uses {expected} parameters.\n"
                f"Extra params (e.g. admin_email) must be handled outside the stored proc "
                f"and written to activity_log separately."
            )

    def test_no_seven_plus_sp_params(self):
        """Sanity upper bound: no call site should pass 7+ params."""
        sites = _find_sp_call_sites()
        for fname, lineno, count in sites:
            assert count <= 6, (
                f"{fname}:{lineno} passes {count} params to sp_link_transaction — seems too many"
            )


# ---------------------------------------------------------------------------
# Tests: no VALUES() deprecated syntax in UPSERT statements
# ---------------------------------------------------------------------------

_VALUES_SYNTAX = re.compile(r'\bVALUES\s*\(\s*\w+\s*\)', re.IGNORECASE)
_NEW_COL_UPSERT = re.compile(
    r'ON\s+DUPLICATE\s+KEY\s+UPDATE.*?\bNEW\.\w+',
    re.IGNORECASE | re.DOTALL,
)


class TestMySQLSyntax:
    """
    Prevent MySQL 8.0.20+ deprecated syntax from creeping back in.

    VALUES(col) in ON DUPLICATE KEY UPDATE was deprecated in MySQL 8.0.20.
    NEW.col in ON DUPLICATE KEY is also problematic with certain MySQL versions.
    Parameter placeholders (%s) are the safe approach for both.
    """

    def _all_sql_strings(self) -> list[tuple[str, int, str]]:
        """Collect (filename, lineno, sql) from all api_*.py files."""
        results = []
        for path in sorted(ADMIN_ROOT.glob('api_*.py')):
            source = path.read_text()
            # Find multi-line strings containing ON DUPLICATE KEY
            for m in re.finditer(
                r'("""|\'\'\')(.*?)\1',
                source, re.DOTALL,
            ):
                content = m.group(2)
                if 'ON DUPLICATE KEY' in content.upper():
                    lineno = source[: m.start()].count('\n') + 1
                    results.append((path.name, lineno, content))
            # Also single-line strings
            for m in re.finditer(r'"([^"]*ON\s+DUPLICATE\s+KEY[^"]*)"', source, re.IGNORECASE):
                lineno = source[: m.start()].count('\n') + 1
                results.append((path.name, lineno, m.group(1)))
        return results

    def test_no_deprecated_values_syntax_in_upserts(self):
        """
        ON DUPLICATE KEY UPDATE must not use `VALUES(col)` syntax.
        This was deprecated in MySQL 8.0.20 and causes error 1093 in some configs.
        Use parameter placeholders (%s) instead.
        """
        violations = []
        for fname, lineno, sql in self._all_sql_strings():
            if _VALUES_SYNTAX.search(sql):
                violations.append((fname, lineno, sql[:120]))

        assert not violations, (
            "Found deprecated VALUES(col) syntax in ON DUPLICATE KEY UPDATE:\n"
            + "\n".join(f"  {f}:{l} — {s!r}" for f, l, s in violations)
            + "\n\nReplace with parameter placeholders (%s) — see sync_config.py for examples."
        )
