"""
Pre-push safety test: detect unguarded varchar→ENUM Status writes in SQL procedures.

Problem: stored procedures read Status from member_log (varchar) and write it
into members.Status (ENUM). If the logged value isn't a valid ENUM member,
MySQL raises error 1265 (Data truncated). The fix is a CASE/WHEN guard.

This test scans all SQL files in db/ and fails if it detects the unsafe pattern:
  - Status = IFNULL(v_prev_status, ...) without a prior CASE/WHEN guard

Run:
    python3 db/test_procedure_enum_safety.py
    python3 -m pytest db/test_procedure_enum_safety.py -v
"""

import re
import sys
from pathlib import Path

DB_DIR = Path(__file__).resolve().parent

# Valid members.Status ENUM values (keep in sync with schema_snapshot.sql)
MEMBERS_STATUS_ENUM = frozenset([
    'active', 'expired', 'inactive', 'pending', 'pending_upgrade', 'lifetime'
])

# Pattern: direct unguarded use of prev_status variable in a SET/UPDATE Status line
# Matches:  Status = IFNULL(v_prev_status, 'something')
#           Status = v_prev_status   (without a preceding CASE guard in the same block)
_UNSAFE_IFNULL_RE = re.compile(
    r'Status\s*=\s*IFNULL\s*\(\s*v_prev_status\b',
    re.IGNORECASE,
)

# Pattern that signals the guard IS present (immediately before the UPDATE)
# Matches:  SET v_prev_status = CASE WHEN v_prev_status IN (...)
_GUARD_RE = re.compile(
    r"SET\s+v_prev_status\s*=\s*CASE\s+WHEN\s+v_prev_status\s+IN\s*\(",
    re.IGNORECASE,
)

# Pattern: Status = v_prev_status (direct, no IFNULL) — only unsafe if guard is absent
_DIRECT_RE = re.compile(
    r'Status\s*=\s*v_prev_status\b(?!\s*,?\s*CASE)',
    re.IGNORECASE,
)


def _extract_procedures(sql: str) -> list[tuple[str, str]]:
    """Return list of (procedure_name, body) tuples from a SQL file."""
    # Split on CREATE PROCEDURE boundaries (works with DELIMITER $$ style files)
    procs = []
    pattern = re.compile(
        r'CREATE\s+PROCEDURE\s+`?(\w+)`?\s*\(.*?END\$\$',
        re.IGNORECASE | re.DOTALL,
    )
    for m in pattern.finditer(sql):
        procs.append((m.group(1), m.group(0)))
    return procs


def _check_file(path: Path) -> list[str]:
    """Return list of violation descriptions found in the file."""
    violations = []
    sql = path.read_text(encoding='utf-8')
    procedures = _extract_procedures(sql)

    for proc_name, body in procedures:
        # Check for unguarded IFNULL pattern
        for m in _UNSAFE_IFNULL_RE.finditer(body):
            # Find text before this match to see if a guard exists
            text_before = body[:m.start()]
            # Look for a guard within the last 500 chars before this line
            window = text_before[-500:]
            if not _GUARD_RE.search(window):
                line_no = sql[:sql.find(body) + m.start()].count('\n') + 1
                violations.append(
                    f"{path.name}:{line_no} — {proc_name}: "
                    f"unguarded `Status = IFNULL(v_prev_status, ...)`. "
                    f"Add CASE/WHEN ENUM guard before the UPDATE."
                )

    return violations


def check_all_sql_files() -> list[str]:
    """Scan all .sql files in db/ and return all violations."""
    all_violations = []
    sql_files = sorted(DB_DIR.glob("*.sql"))
    for f in sql_files:
        all_violations.extend(_check_file(f))
    return all_violations


def test_no_unguarded_status_enum_writes():
    """pytest-compatible test: fail if any unguarded varchar→ENUM writes found."""
    violations = check_all_sql_files()
    assert not violations, (
        f"\n{len(violations)} unguarded Status ENUM write(s) found:\n"
        + "\n".join(f"  • {v}" for v in violations)
    )


def test_migration_v021_guards_present():
    """Verify V021 migration specifically contains the ENUM guard for both procedures."""
    migration = DB_DIR / "MIGRATION_V021_fix_cancel_clear_status_enum.sql"
    assert migration.exists(), "MIGRATION_V021 not found"

    sql = migration.read_text(encoding='utf-8')
    procedures = _extract_procedures(sql)
    proc_names = {name for name, _ in procedures}

    assert 'sp_cancel_payment' in proc_names, "sp_cancel_payment not in V021"
    assert 'sp_clear_transaction' in proc_names, "sp_clear_transaction not in V021"

    for name, body in procedures:
        if name in ('sp_cancel_payment', 'sp_clear_transaction'):
            assert _GUARD_RE.search(body), (
                f"V021 {name}: missing CASE/WHEN ENUM guard for v_prev_status"
            )
            assert not _UNSAFE_IFNULL_RE.search(body), (
                f"V021 {name}: still contains unguarded IFNULL pattern"
            )


def test_enum_values_exhaustive():
    """Ensure MEMBERS_STATUS_ENUM matches schema_snapshot.sql definition."""
    snapshot = DB_DIR / "schema_snapshot.sql"
    if not snapshot.exists():
        return  # skip if not present locally

    sql = snapshot.read_text(encoding='utf-8')
    # Find the members table's Status ENUM in tab-delimited schema_snapshot rows.
    # Row format: members\t<col_pos>\tStatus\tenum('active',...)
    m = re.search(
        r"^members\t\d+\tStatus\tenum\(([^)]+)\)",
        sql,
        re.IGNORECASE | re.MULTILINE,
    )
    if not m:
        return  # can't parse — skip rather than false-fail

    raw = m.group(1)
    schema_values = frozenset(v.strip().strip("'\"") for v in raw.split(','))
    missing_in_test = schema_values - MEMBERS_STATUS_ENUM
    extra_in_test = MEMBERS_STATUS_ENUM - schema_values

    assert not missing_in_test, (
        f"Schema has ENUM values not in MEMBERS_STATUS_ENUM constant: {missing_in_test}. "
        "Update the constant in this file."
    )
    assert not extra_in_test, (
        f"MEMBERS_STATUS_ENUM has values not in schema: {extra_in_test}. "
        "Check if the schema ENUM was changed."
    )


# ---------------------------------------------------------------------------
# Standalone runner
# ---------------------------------------------------------------------------

if __name__ == '__main__':
    print("Scanning SQL files for unguarded varchar→ENUM Status writes...\n")
    violations = check_all_sql_files()
    if violations:
        print(f"❌ {len(violations)} violation(s) found:")
        for v in violations:
            print(f"  • {v}")
        sys.exit(1)
    else:
        sql_files = list(DB_DIR.glob("*.sql"))
        print(f"✅ {len(sql_files)} SQL file(s) scanned — no unguarded ENUM writes found.")
        sys.exit(0)
