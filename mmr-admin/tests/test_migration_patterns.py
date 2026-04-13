"""
test_migration_patterns.py — Static analysis of MIGRATION_V*.sql files.

Every bug that reached production during the sp_revert_admin_override saga
introduced a repeatable anti-pattern.  These tests scan ALL migration files
so any future migration that repeats a known mistake fails pre-push.

Bug → anti-pattern catalogue
─────────────────────────────────────────────────────────────────────────────
V011  NULL-Status Sheets rows  →  member_log SELECT without Status IS NOT NULL
V011  Empty-string FamilyID    →  FamilyID IS NOT NULL guard without != '' check
V012  Collation mismatch       →  JSON_TABLE used in cursor comparing members cols
V013  FK violation             →  Literal non-member string in TargetMemberID INSERT
V014  Expiration trigger       →  UPDATE members...Expiration without @internal_proc=1
All   Missing cleanup          →  SET @internal_proc=1 without matching NULL reset
All   LEAVE without label      →  LEAVE <proc_name> (proc name ≠ a valid block label)
All   MySQL 5.7 compat.        →  ALTER TABLE ... IF NOT EXISTS / multi-clause ALTER
All   No self-registration     →  Migration with no INSERT INTO schema_migrations
All   No idempotent DROP       →  CREATE PROCEDURE without preceding DROP
─────────────────────────────────────────────────────────────────────────────

Tests in this file have NO database dependency — they parse SQL text only.
"""
from __future__ import annotations

import os
import re
import glob
import pytest

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

DB_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), '../../db'))

# Migrations that were deployed before these pattern tests existed and have
# known violations that were fixed in later migrations.  They are excluded from
# structural-pattern checks (but still scanned for self-registration, etc.).
LEGACY_MIGRATIONS = {
    'MIGRATION_V011_fix_sp_revert_null_status.sql',   # missing @internal_proc, JSON_TABLE, FK literal
    'MIGRATION_V012_fix_revert_collation.sql',         # missing @internal_proc, FK literal
    'MIGRATION_V013_fix_revert_fk.sql',                # missing @internal_proc
    'MIGRATION_V014_fix_revert_expiration_trigger.sql', # missing SQLEXCEPTION handler
}


def _migration_files() -> list[tuple[str, str]]:
    """Return [(filename, sql_text), ...] for all MIGRATION_V*.sql files."""
    pattern = os.path.join(DB_DIR, 'MIGRATION_V*.sql')
    files = sorted(glob.glob(pattern))
    assert files, f"No MIGRATION_V*.sql files found in {DB_DIR}"
    result = []
    for path in files:
        with open(path) as f:
            result.append((os.path.basename(path), f.read()))
    return result


def _proc_bodies(sql: str) -> dict[str, str]:
    """
    Return {proc_name: body_text} for every CREATE PROCEDURE in sql.
    body_text starts at 'CREATE PROCEDURE <name>' and runs to END$$ / END;
    so it includes the full definition.
    """
    bodies: dict[str, str] = {}
    for m in re.finditer(r'CREATE\s+PROCEDURE\s+(\w+)', sql, re.IGNORECASE):
        name = m.group(1)
        bodies[name] = sql[m.start():]
    return bodies


def _strip_comments(sql: str) -> str:
    """Remove -- line comments and /* block comments */ from SQL text."""
    sql = re.sub(r'--[^\n]*', '', sql)
    sql = re.sub(r'/\*.*?\*/', '', sql, flags=re.DOTALL)
    return sql


# ─────────────────────────────────────────────────────────────────────────────
# Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope='module')
def migration_files():
    return _migration_files()


@pytest.fixture(scope='module')
def all_migration_sql(migration_files):
    return '\n'.join(sql for _, sql in migration_files)


# ─────────────────────────────────────────────────────────────────────────────
# 1. Self-registration — every migration must record itself
# ─────────────────────────────────────────────────────────────────────────────

class TestSelfRegistration:
    """Every MIGRATION_V*.sql must INSERT its version into schema_migrations."""

    def test_every_migration_inserts_into_schema_migrations(self, migration_files):
        missing = []
        for fname, sql in migration_files:
            stripped = _strip_comments(sql)
            if 'schema_migrations' not in stripped:
                missing.append(fname)
        assert not missing, (
            "These migration files have no INSERT INTO schema_migrations.\n"
            "Every migration must self-register for audit trail + re-run prevention:\n"
            "  INSERT INTO schema_migrations (version, description, executed_at)\n"
            "  VALUES ('V###', '...', NOW())\n"
            "  ON DUPLICATE KEY UPDATE executed_at = NOW();\n\n"
            "Missing:\n" + '\n'.join(f'  {f}' for f in missing)
        )

    def test_schema_migrations_insert_is_on_duplicate_key(self, migration_files):
        """Ensures the INSERT is idempotent (safe to re-run)."""
        bad = []
        for fname, sql in migration_files:
            stripped = _strip_comments(sql)
            if 'schema_migrations' in stripped:
                if 'ON DUPLICATE KEY' not in stripped.upper():
                    bad.append(fname)
        assert not bad, (
            "schema_migrations INSERT must include ON DUPLICATE KEY UPDATE "
            "to be idempotent (safe if migration is re-run).\n"
            "Missing in:\n" + '\n'.join(f'  {f}' for f in bad)
        )


# ─────────────────────────────────────────────────────────────────────────────
# 2. Idempotent procedure definitions
# ─────────────────────────────────────────────────────────────────────────────

class TestIdempotentProcedures:
    """Every CREATE PROCEDURE must be preceded by DROP PROCEDURE IF EXISTS."""

    def test_create_procedure_has_preceding_drop(self, migration_files):
        bad = []
        for fname, sql in migration_files:
            stripped = _strip_comments(sql)
            creates = re.findall(r'CREATE\s+PROCEDURE\s+(\w+)', stripped, re.IGNORECASE)
            for proc_name in creates:
                drop_pattern = rf'DROP\s+PROCEDURE\s+IF\s+EXISTS\s+{re.escape(proc_name)}'
                drop_pos = [(m.start()) for m in re.finditer(drop_pattern, stripped, re.IGNORECASE)]
                create_pos = [m.start() for m in re.finditer(
                    rf'CREATE\s+PROCEDURE\s+{re.escape(proc_name)}', stripped, re.IGNORECASE)]
                if not any(d < c for d in drop_pos for c in create_pos):
                    bad.append(f'{fname}::{proc_name}')
        assert not bad, (
            "CREATE PROCEDURE must be preceded by DROP PROCEDURE IF EXISTS "
            "in the same migration file so re-runs are safe.\n"
            "Offenders:\n" + '\n'.join(f'  {x}' for x in bad)
        )


# ─────────────────────────────────────────────────────────────────────────────
# 3. MySQL 5.7 compatibility
# ─────────────────────────────────────────────────────────────────────────────

class TestMySQL57Compat:
    """
    MySQL 5.7 forbids:
      - ALTER TABLE ... ADD COLUMN IF NOT EXISTS
      - CREATE INDEX IF NOT EXISTS
      - Multiple clauses in a single ALTER TABLE
    """

    def test_no_alter_table_if_not_exists(self, migration_files):
        bad = []
        for fname, sql in migration_files:
            stripped = _strip_comments(sql)
            if re.search(r'ALTER\s+TABLE\s+\w+\s+ADD\s+\w+.*IF\s+NOT\s+EXISTS', stripped, re.IGNORECASE):
                bad.append(fname)
        assert not bad, (
            "MySQL 5.7 does not support ALTER TABLE ... ADD ... IF NOT EXISTS.\n"
            "Check INFORMATION_SCHEMA before conditional column additions.\n"
            "Offenders:\n" + '\n'.join(f'  {f}' for f in bad)
        )

    def test_no_create_index_if_not_exists(self, migration_files):
        bad = []
        for fname, sql in migration_files:
            stripped = _strip_comments(sql)
            if re.search(r'CREATE\s+(UNIQUE\s+)?INDEX\s+IF\s+NOT\s+EXISTS', stripped, re.IGNORECASE):
                bad.append(fname)
        assert not bad, (
            "MySQL 5.7 does not support CREATE INDEX IF NOT EXISTS.\n"
            "Offenders:\n" + '\n'.join(f'  {f}' for f in bad)
        )


# ─────────────────────────────────────────────────────────────────────────────
# 4. @internal_proc trigger bypass
# ─────────────────────────────────────────────────────────────────────────────

class TestInternalProcFlag:
    """
    The members_before_update trigger blocks direct Expiration UPDATEs unless
    @internal_proc = 1 is set (error 1644).  Any procedure that UPDATEs
    members.Expiration must:
      (a) SET @internal_proc = 1 before the UPDATE
      (b) SET @internal_proc = NULL after (to restore the guard)
    """

    def test_expiration_update_sets_internal_proc(self, migration_files):
        bad = []
        for fname, sql in migration_files:
            if fname in LEGACY_MIGRATIONS:
                continue
            for proc_name, body in _proc_bodies(sql).items():
                body_no_comments = _strip_comments(body)
                updates_expiration = bool(re.search(
                    r'UPDATE\s+members\b[^;]*\bExpiration\b', body_no_comments, re.IGNORECASE | re.DOTALL
                ))
                if updates_expiration and 'SET @internal_proc = 1' not in body_no_comments:
                    bad.append(f'{fname}::{proc_name}')
        assert not bad, (
            "These procedures UPDATE members.Expiration but do NOT set "
            "@internal_proc = 1. The members_before_update trigger will raise "
            "1644 'Direct update to Expiration column is not allowed'.\n"
            "Add: SET @internal_proc = 1;  before the UPDATE\n"
            "     SET @internal_proc = NULL;  after the UPDATE/loop\n\n"
            "Offenders:\n" + '\n'.join(f'  {x}' for x in bad)
        )

    def test_internal_proc_always_reset_to_null(self, migration_files):
        bad = []
        for fname, sql in migration_files:
            if fname in LEGACY_MIGRATIONS:
                continue
            for proc_name, body in _proc_bodies(sql).items():
                body_nc = _strip_comments(body)
                if 'SET @internal_proc = 1' in body_nc and 'SET @internal_proc = NULL' not in body_nc:
                    bad.append(f'{fname}::{proc_name}')
        assert not bad, (
            "These procedures SET @internal_proc = 1 but never reset it to NULL.\n"
            "Leaving @internal_proc = 1 in the session bypasses the Expiration "
            "trigger for ALL subsequent statements in that connection.\n\n"
            "Offenders:\n" + '\n'.join(f'  {x}' for x in bad)
        )


# ─────────────────────────────────────────────────────────────────────────────
# 5. Collation safety — no JSON_TABLE in member-column comparisons
# ─────────────────────────────────────────────────────────────────────────────

class TestCollationSafety:
    """
    JSON_TABLE derived columns inherit the server default collation
    (utf8mb4_0900_ai_ci on MySQL 8), which conflicts with members.MemberID
    (utf8mb4_unicode_ci) → 'Illegal mix of collations' (HY000 1267).

    Use FIND_IN_SET for comma-separated member ID lists instead.
    """

    def test_no_json_table_comparing_member_columns(self, migration_files):
        bad = []
        for fname, sql in migration_files:
            if fname in LEGACY_MIGRATIONS:
                continue
            for proc_name, body in _proc_bodies(sql).items():
                body_nc = _strip_comments(body)
                has_json_table = 'JSON_TABLE' in body_nc.upper()
                compares_member_id = bool(re.search(
                    r'\bMemberID\b.*=|\b=.*\bMemberID\b', body_nc, re.IGNORECASE
                ))
                if has_json_table and compares_member_id:
                    bad.append(f'{fname}::{proc_name}')
        assert not bad, (
            "JSON_TABLE in a procedure that also compares MemberID will cause "
            "'Illegal mix of collations' on Azure MySQL (HY000 1267).\n"
            "Replace JSON_TABLE iteration with FIND_IN_SET(MemberID, csv_column) > 0\n\n"
            "Offenders:\n" + '\n'.join(f'  {x}' for x in bad)
        )


# ─────────────────────────────────────────────────────────────────────────────
# 6. FK-safe audit INSERTs into admin_member_overrides
# ─────────────────────────────────────────────────────────────────────────────

class TestFKSafeAuditInserts:
    """
    admin_member_overrides.TargetMemberID has fk_override_member → members.MemberID.
    The column list order is (AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType, ...).
    Inserting a literal string that doesn't exist in members raises 1452 (e.g. 'REVERT').

    Strategy: for any INSERT into admin_member_overrides that names the columns
    explicitly, extract the VALUES 2nd token and verify it's a variable (@var or v_xxx),
    not a string literal.
    """

    def test_target_member_id_is_variable_not_literal(self, migration_files):
        """
        The 2nd value in VALUES (TargetMemberID column position) must be a
        SQL variable (v_... or @...), not a quoted literal string.
        """
        bad = []
        for fname, sql in migration_files:
            if fname in LEGACY_MIGRATIONS:
                continue
            for proc_name, body in _proc_bodies(sql).items():
                body_nc = _strip_comments(body)
                for insert_m in re.finditer(
                    r'INSERT\s+INTO\s+admin_member_overrides\s*'
                    r'\([^)]*\bTargetMemberID\b[^)]*\)\s*VALUES\s*\(([^)]+)\)',
                    body_nc, re.IGNORECASE | re.DOTALL
                ):
                    values_str = insert_m.group(1)
                    # Split on top-level commas only
                    values = [v.strip() for v in re.split(r',(?![^(]*\))', values_str)]
                    # Find TargetMemberID position in column list
                    col_match = re.search(
                        r'INSERT\s+INTO\s+admin_member_overrides\s*\(([^)]+)\)',
                        insert_m.group(0), re.IGNORECASE
                    )
                    if not col_match:
                        continue
                    cols = [c.strip() for c in col_match.group(1).split(',')]
                    try:
                        idx = next(i for i, c in enumerate(cols) if 'TargetMemberID' in c)
                    except StopIteration:
                        continue
                    if idx >= len(values):
                        continue
                    target_val = values[idx]
                    # Must be a variable (v_xxx / @xxx) — not a quoted literal
                    if re.match(r"^'[^']*'$|^\"[^\"]*\"$", target_val):
                        bad.append(
                            f'{fname}::{proc_name} — TargetMemberID = {target_val!r} '
                            f'(literal string not in members → fk_override_member 1452)'
                        )
        assert not bad, (
            "TargetMemberID in admin_member_overrides INSERT must be a variable "
            "that holds a real MemberID from the members table.\n"
            "A literal string like 'REVERT' fails fk_override_member (1452).\n\n"
            "Offenders:\n" + '\n'.join(f'  {x}' for x in bad)
        )


# ─────────────────────────────────────────────────────────────────────────────
# 7. member_log reads must filter NULL-Status rows
# ─────────────────────────────────────────────────────────────────────────────

class TestMemberLogNullStatus:
    """
    Sheets-sync writes member_log rows with Status = NULL.
    Any SP that reads member_log to restore a previous Status must include
    AND Status IS NOT NULL — otherwise COALESCE(NULL, current_val) silently
    returns the current (wrong) value and the UPDATE does nothing.
    """

    def test_member_log_restore_queries_filter_null_status(self, migration_files):
        bad = []
        for fname, sql in migration_files:
            for proc_name, body in _proc_bodies(sql).items():
                body_nc = _strip_comments(body)
                # Look for SELECT ... FROM member_log WHERE ... (restore pattern)
                selects_from_log = re.findall(
                    r'SELECT\b[^;]+\bFROM\s+member_log\b[^;]+?;',
                    body_nc, re.IGNORECASE | re.DOTALL
                )
                for sel in selects_from_log:
                    # Only flag selects that look like status restores
                    # (selecting Status or Expiration INTO a variable)
                    if re.search(r'\bStatus\b.*\bINTO\b|\bINTO\b.*\bStatus\b', sel, re.IGNORECASE):
                        if 'Status IS NOT NULL' not in sel:
                            bad.append(f'{fname}::{proc_name}')
                            break
        assert not bad, (
            "member_log SELECT that reads Status INTO a variable must include "
            "'AND Status IS NOT NULL' in its WHERE clause.\n"
            "Without it, Sheets-sync rows (Status = NULL) cause COALESCE to "
            "return the current wrong value, so the UPDATE silently does nothing.\n\n"
            "Offenders:\n" + '\n'.join(f'  {x}' for x in bad)
        )


# ─────────────────────────────────────────────────────────────────────────────
# 8. FamilyID empty-string guard
# ─────────────────────────────────────────────────────────────────────────────

class TestFamilyIDGuard:
    """
    Checking only `FamilyID IS NOT NULL` matches members where FamilyID = ''
    (empty string), causing cascade UPDATEs to ALL such members.
    Any WHERE clause that compares FamilyID must also guard against ''.
    """

    def test_family_id_check_includes_empty_string_guard(self, migration_files):
        bad = []
        for fname, sql in migration_files:
            for proc_name, body in _proc_bodies(sql).items():
                body_nc = _strip_comments(body)
                # Find any IF/WHERE that checks FamilyID IS NOT NULL
                checks = re.findall(
                    r'(?:IF|WHERE)[^;]+FamilyID\s+IS\s+NOT\s+NULL[^;]*;',
                    body_nc, re.IGNORECASE | re.DOTALL
                )
                for check in checks:
                    if "!= ''" not in check and "<> ''" not in check:
                        bad.append(f'{fname}::{proc_name}')
                        break
        assert not bad, (
            "FamilyID IS NOT NULL guard is missing the empty-string check.\n"
            "Members with FamilyID = '' would be incorrectly included in a cascade.\n"
            "Use: FamilyID IS NOT NULL AND FamilyID != ''\n\n"
            "Offenders:\n" + '\n'.join(f'  {x}' for x in bad)
        )


# ─────────────────────────────────────────────────────────────────────────────
# 9. SPs with audit INSERTs must have a SQLEXCEPTION handler
# ─────────────────────────────────────────────────────────────────────────────

class TestSQLExceptionHandler:
    """
    Any SP that does a final audit INSERT into admin_member_overrides must have
    a DECLARE CONTINUE HANDLER FOR SQLEXCEPTION.

    Without it: if the INSERT fails (FK, constraint, etc.), the SP aborts before
    returning its SELECT result. The calling code sees an error, idempotency
    never activates, and Sheets sync can overwrite the partially-applied changes.
    """

    def test_procs_with_audit_insert_have_exception_handler(self, migration_files):
        bad = []
        for fname, sql in migration_files:
            if fname in LEGACY_MIGRATIONS:
                continue
            for proc_name, body in _proc_bodies(sql).items():
                body_nc = _strip_comments(body)
                has_audit_insert = bool(re.search(
                    r'INSERT\s+INTO\s+admin_member_overrides', body_nc, re.IGNORECASE
                ))
                has_handler = 'CONTINUE HANDLER FOR SQLEXCEPTION' in body_nc.upper()
                if has_audit_insert and not has_handler:
                    bad.append(f'{fname}::{proc_name}')
        assert not bad, (
            "These procedures INSERT into admin_member_overrides but have no "
            "DECLARE CONTINUE HANDLER FOR SQLEXCEPTION.\n"
            "If the audit INSERT fails (FK, constraint, etc.), the SP aborts "
            "before its SELECT result is returned — idempotency breaks and "
            "Sheets sync can overwrite the members table changes.\n\n"
            "Offenders:\n" + '\n'.join(f'  {x}' for x in bad)
        )


# ─────────────────────────────────────────────────────────────────────────────
# 10. LEAVE must use a declared block label, not the procedure name
# ─────────────────────────────────────────────────────────────────────────────

class TestLeaveLabels:
    """
    MySQL LEAVE <label> exits a labeled block (BEGIN...END or loop).
    Using the procedure name as the label (LEAVE sp_my_proc) raises:
    '1308 LEAVE with no matching label'.
    Procedures must declare their outer BEGIN with a label:
      proc_body: BEGIN ... LEAVE proc_body; ... END
    """

    def test_leave_references_declared_label_not_proc_name(self, migration_files):
        bad = []
        for fname, sql in migration_files:
            body_nc = _strip_comments(sql)
            for proc_name, body in _proc_bodies(sql).items():
                body_nc2 = _strip_comments(body)
                leave_refs = re.findall(r'\bLEAVE\s+(\w+)\b', body_nc2, re.IGNORECASE)
                for label in leave_refs:
                    if label.lower() == proc_name.lower():
                        # Proc name used as LEAVE target — check if it's also a block label
                        if f'{label}:' not in body_nc2:
                            bad.append(f'{fname}::{proc_name} — LEAVE {label} (no matching label)')
        assert not bad, (
            "LEAVE <proc_name> is not valid MySQL — the procedure name is not a "
            "block label. Declare the outer BEGIN with a label:\n"
            "  proc_name: BEGIN\n"
            "    ...\n"
            "    LEAVE proc_name;\n"
            "    ...\n"
            "  END\n\n"
            "Offenders:\n" + '\n'.join(f'  {x}' for x in bad)
        )
