"""
Static SQL column linter for mmr-admin.

Parses every SQL string literal in api_*.py files and checks that
column references actually exist in db/schema_snapshot.sql.

Catches bugs like:
  - 'LastUpdated' when schema has 'UpdatedAt'
  - 'TransactionReference' when schema has 'TransactionNumber'
  - 'MembershipType' when schema has 'PaymentType'

Does NOT require a live database — purely static analysis.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_sql_columns.py -v
    python3 -m pytest tests/test_sql_columns.py -v -k "api_sync"  # one file only
"""

import ast
import re
import pathlib
import textwrap
import pytest

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------

HERE        = pathlib.Path(__file__).parent
REPO_ROOT   = HERE.parent.parent
SCHEMA_FILE = REPO_ROOT / 'db' / 'schema_snapshot.sql'
ADMIN_ROOT  = HERE.parent


# ---------------------------------------------------------------------------
# Step 1: Parse schema_snapshot.sql → set of known column names
# ---------------------------------------------------------------------------

def _load_known_columns() -> set[str]:
    """
    Extract every column name from the COLUMNS section of schema_snapshot.sql.
    Row format: table_name \\t ordinal \\t column_name \\t col_type \\t ...
    """
    text = SCHEMA_FILE.read_text()
    col_section = re.search(
        r'=== 2\. COLUMNS ===.*?(?==== \d\.)', text, re.DOTALL
    )
    if not col_section:
        raise ValueError("Could not find '=== 2. COLUMNS ===' in schema_snapshot.sql")

    columns: set[str] = set()
    for line in col_section.group().splitlines():
        parts = line.split('\t')
        if len(parts) >= 3 and parts[1].isdigit():
            columns.add(parts[2].strip())
    return columns


# ---------------------------------------------------------------------------
# Step 2: Extract SQL strings from Python source — skip docstrings
# ---------------------------------------------------------------------------

_SQL_START = re.compile(
    r'^\s*(SELECT|INSERT\s+INTO|UPDATE\s+\w|DELETE\s+FROM|CALL\s+\w|'
    r'CREATE\s+TEMP|DROP\s+TEMP|ALTER\s+TABLE)',
    re.IGNORECASE,   # no MULTILINE — must match at true start of string
)

# INFORMATION_SCHEMA queries use system columns, not our app schema — skip them.
_INFORMATION_SCHEMA = re.compile(r'information_schema', re.IGNORECASE)


def _is_real_sql(sql: str) -> bool:
    """
    True only if string is a genuine SQL query against our app schema.
    Requirements:
      1. Starts with a DML keyword (not just contains one mid-string)
      2. Contains %s placeholders OR SQL operator syntax (catches non-parameterised)
      3. Not an INFORMATION_SCHEMA introspection query (system columns, not ours)
    """
    if not _SQL_START.match(sql):
        return False
    if _INFORMATION_SCHEMA.search(sql):
        return False
    # Must look like real SQL, not prose that starts with "Update members in..."
    has_params   = '%s' in sql
    has_operator = bool(re.search(
        r'(\bWHERE\b|\bSET\b\s+\w+\s*=|\bORDER\s+BY\b|\bGROUP\s+BY\b|'
        r'\bLIMIT\b|\bJOIN\b|\bHAVING\b|\bIN\s*\()',
        sql, re.IGNORECASE,
    ))
    return has_params or has_operator


def _extract_sql_strings(path: pathlib.Path) -> list[tuple[int, str]]:
    """
    Return (lineno, sql_text) for strings that look like real SQL statements.
    f-string interpolation slots are replaced with {...} placeholders.
    """
    try:
        source = path.read_text()
        tree   = ast.parse(source, filename=str(path))
    except SyntaxError:
        return []

    results: list[tuple[int, str]] = []

    for node in ast.walk(tree):
        # Plain string constants
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            sql = node.value
            if _is_real_sql(sql):
                results.append((node.lineno, sql))

        # f-strings
        elif isinstance(node, ast.JoinedStr):
            parts = []
            for v in node.values:
                if isinstance(v, ast.Constant):
                    parts.append(str(v.value))
                else:
                    parts.append('{...}')
            sql = ''.join(parts)
            if _is_real_sql(sql):
                results.append((node.lineno, sql))

    return results


# ---------------------------------------------------------------------------
# Step 3: Extract column candidates — skip SQL keywords and aliases
# ---------------------------------------------------------------------------

_SQL_KEYWORDS: set[str] = {
    # DML / DDL
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM', 'WHERE', 'JOIN',
    'INNER', 'LEFT', 'RIGHT', 'OUTER', 'CROSS', 'FULL', 'ON', 'USING',
    'AS', 'AND', 'OR', 'NOT', 'IN', 'IS', 'NULL', 'LIKE', 'BETWEEN',
    'EXISTS', 'HAVING', 'GROUP', 'ORDER', 'BY', 'LIMIT', 'OFFSET',
    'DISTINCT', 'UNION', 'ALL', 'SET', 'INTO', 'VALUES', 'CALL',
    'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'WITH', 'RECURSIVE',
    'OVER', 'PARTITION', 'ROWS', 'RANGE', 'UNBOUNDED', 'PRECEDING',
    'FOLLOWING', 'CURRENT', 'RETURNING', 'REPLACE', 'IGNORE',
    'CREATE', 'DROP', 'ALTER', 'TABLE', 'TEMPORARY', 'INDEX',
    'PRIMARY', 'UNIQUE', 'FOREIGN', 'CONSTRAINT', 'KEY', 'DEFAULT',
    'AUTO_INCREMENT', 'COMMIT', 'ROLLBACK', 'START', 'BEGIN',
    'TRANSACTION', 'PROCEDURE', 'DECLARE', 'SHOW', 'COLUMNS',
    'INFORMATION_SCHEMA', 'TRUE', 'FALSE', 'BINARY', 'INTERVAL',
    'DESC', 'ASC',
    # Aggregate / scalar functions
    'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'NOW', 'COALESCE', 'IFNULL',
    'NULLIF', 'ISNULL', 'CAST', 'CONVERT', 'DATE', 'YEAR', 'MONTH',
    'DAY', 'CONCAT', 'LOWER', 'UPPER', 'TRIM', 'LENGTH', 'SUBSTRING',
    'GROUP_CONCAT', 'JSON_OBJECT', 'JSON_ARRAYAGG', 'UNIX_TIMESTAMP',
    'FROM_UNIXTIME', 'DATEDIFF', 'DATE_ADD', 'DATE_FORMAT', 'CURDATE',
    'STR_TO_DATE', 'ROW_NUMBER', 'RANK', 'DENSE_RANK', 'NTILE',
    # MySQL-specific
    'DUPLICATE', 'UPSERT', 'TINYINT', 'BIGINT', 'VARCHAR', 'DATETIME',
    'DECIMAL', 'BOOLEAN', 'ENUM', 'TEXT', 'BLOB', 'JSON', 'FLOAT',
    # Common English words that appear in inline comments kept in SQL strings
    'Individual', 'Family', 'Lifetime', 'Membership', 'Renewal',
    'Active', 'Expired', 'Inactive', 'Pending', 'Payment',
    'Member', 'Members', 'Table', 'Column', 'Index', 'Field',
    'WHERE', 'NULL', 'None', 'True', 'False',
}


def _clean_sql(sql: str) -> str:
    """Strip noise from SQL before extracting column candidates."""
    # Strip SQL line comments (-- ...) — contains prose like '-- Optional: ...'
    sql = re.sub(r'--[^\n]*', '', sql)
    # Strip SQL block comments
    sql = re.sub(r'/\*.*?\*/', '', sql, flags=re.DOTALL)
    # Strip string literals ('active', "pending")
    sql = re.sub(r"'[^']*'|\"[^\"]*\"", "''", sql)
    # Strip aliases: AS identifier → AS _alias_
    sql = re.sub(r'\bAS\s+\w+', 'AS _alias_', sql, flags=re.IGNORECASE)
    # Strip table-position tokens: FROM/JOIN/UPDATE/INTO followed by identifier
    # (these are table names, not columns)
    sql = re.sub(
        r'\b(FROM|JOIN|UPDATE|INTO|TABLE|CALL)\s+(\w+)',
        lambda m: m.group(1) + ' _table_',
        sql, flags=re.IGNORECASE,
    )
    # For table.column refs, keep only the column part
    sql = re.sub(r'\b[a-z_]\w*\.([A-Z]\w+)', r'\1', sql)
    return sql


def _extract_column_candidates(sql: str) -> list[str]:
    """
    Return PascalCase identifiers (≥4 chars) that look like column references.
    """
    sql = _clean_sql(sql)
    candidates = re.findall(r'\b([A-Z][a-zA-Z0-9]{3,})\b', sql)
    return [c for c in candidates if c not in _SQL_KEYWORDS]


# ---------------------------------------------------------------------------
# Step 4: Collect all violations across api_*.py files
# ---------------------------------------------------------------------------

def _collect_violations() -> list[tuple[str, int, str, str]]:
    """Return (filename, lineno, sql_snippet, bad_column) for each violation."""
    known = _load_known_columns()
    # Case-insensitive lookup: MySQL column names are case-insensitive in queries
    known_lower = {c.lower() for c in known}
    violations = []

    for path in sorted(ADMIN_ROOT.glob('api_*.py')):
        for lineno, sql in _extract_sql_strings(path):
            for col in _extract_column_candidates(sql):
                if col.lower() not in known_lower:
                    snippet = textwrap.shorten(sql.strip(), width=80, placeholder='…')
                    violations.append((path.name, lineno, snippet, col))

    # Deduplicate (same column flagged from duplicate SQL strings)
    seen = set()
    deduped = []
    for v in violations:
        key = (v[0], v[1], v[3])   # file + line + column
        if key not in seen:
            seen.add(key)
            deduped.append(v)
    return deduped


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_schema_snapshot_readable():
    """Schema file must exist and contain a parseable COLUMNS section."""
    assert SCHEMA_FILE.exists(), f"Not found: {SCHEMA_FILE}"
    known = _load_known_columns()
    assert len(known) > 20, "Too few columns parsed — schema format may have changed"


def test_schema_has_expected_columns():
    """Sanity check: well-known columns must be present."""
    known = _load_known_columns()
    for col in ('MemberID', 'UpdatedAt', 'Status', 'Email', 'PaymentDate', 'TransactionNumber'):
        assert col in known, f"Expected column '{col}' not in schema — parser broken?"


@pytest.mark.parametrize('filename,lineno,snippet,column', _collect_violations())
def test_no_unknown_column(filename, lineno, snippet, column):
    """
    Every column reference in a SQL string must exist in schema_snapshot.sql.
    Failure = MySQL 1054 'Unknown column' at runtime.
    """
    known = _load_known_columns()
    known_lower = {c.lower() for c in known}
    hint = ', '.join(
        c for c in sorted(known)
        if c[:3].lower() == column[:3].lower()
    ) or '(no close matches)'
    assert column.lower() in known_lower, (
        f"\n  File:    {filename}:{lineno}"
        f"\n  SQL:     {snippet}"
        f"\n  Unknown: '{column}'"
        f"\n  Hint:    Did you mean one of: {hint}"
    )
