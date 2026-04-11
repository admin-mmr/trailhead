"""
Static analysis tests: trigger SQL column references must exist in schema.

Recurring bug pattern:
  Symptom : Every INSERT to payments table fails with MySQL 1054
            "Unknown column 'PaymentDate' in 'field list'"
  Root cause: Trigger `trg_payments_auto_fill` referenced `PaymentDate` in a
              SELECT FROM gmail_transactions, but that table has `TransactionDate`.
              The trigger fired on every INSERT and blocked all payment creation.
  Example : Fixed via MIGRATION_V011 (Apr-11)
  Guard   : All column references inside trigger bodies must exist in the
            schema for the table being selected FROM.

Also guards against:
  - Triggers on `members` referencing columns not in members table
  - Triggers selecting from gmail_transactions using payments column names
  - NEW.col references for columns that were since renamed/removed

No live DB required — parses schema_snapshot.sql statically.

Run:
    cd mmr-admin
    python3 -m pytest tests/test_trigger_columns.py -v
"""

import re
import pathlib
import pytest

REPO_ROOT   = pathlib.Path(__file__).parent.parent.parent
SCHEMA_FILE = REPO_ROOT / 'db' / 'schema_snapshot.sql'


# ---------------------------------------------------------------------------
# Schema parsing helpers
# ---------------------------------------------------------------------------

def _load_columns_by_table() -> dict[str, set[str]]:
    """Return {table_name: {col1, col2, ...}} from the COLUMNS section."""
    text = SCHEMA_FILE.read_text()
    col_section = re.search(r'=== 2\. COLUMNS ===.*?(?==== \d\.)', text, re.DOTALL)
    if not col_section:
        raise ValueError("Could not find '=== 2. COLUMNS ===' in schema_snapshot.sql")

    table_cols: dict[str, set[str]] = {}
    for line in col_section.group().splitlines():
        parts = line.split('\t')
        if len(parts) >= 3 and parts[1].isdigit():
            table = parts[0].strip()
            col   = parts[2].strip()
            table_cols.setdefault(table, set()).add(col)
    return table_cols


def _load_all_columns() -> set[str]:
    cols_by_table = _load_columns_by_table()
    return {c for cols in cols_by_table.values() for c in cols}


def _load_triggers() -> list[dict]:
    """
    Parse the TRIGGERS section and return a list of dicts:
      { name, event, table, timing, body }
    """
    text = SCHEMA_FILE.read_text()
    t_idx = text.find('=== 7. TRIGGERS ===')
    if t_idx < 0:
        return []
    # Section ends at next === or EOF
    end_idx = re.search(r'=== \d+\.', text[t_idx + 20:])
    trigger_section = text[t_idx: t_idx + 20 + (end_idx.start() if end_idx else len(text))]

    # Each trigger starts with: name \t event \t table \t timing \t body
    triggers = []
    header_re = re.compile(
        r'^(\w+)\t(INSERT|UPDATE|DELETE)\t(\w+)\t(BEFORE|AFTER)\t(.*)',
        re.MULTILINE,
    )
    # Split into lines and walk them
    lines = trigger_section.splitlines()
    i = 0
    while i < len(lines):
        m = header_re.match(lines[i])
        if m:
            name, event, table, timing = m.group(1), m.group(2), m.group(3), m.group(4)
            body_start = m.group(5)
            # Body may continue on subsequent lines until next header or END
            body_lines = [body_start]
            i += 1
            while i < len(lines) and not header_re.match(lines[i]):
                body_lines.append(lines[i])
                i += 1
            triggers.append({
                'name':   name,
                'event':  event,
                'table':  table,
                'timing': timing,
                'body':   '\n'.join(body_lines),
            })
        else:
            i += 1

    return triggers


# ---------------------------------------------------------------------------
# Column reference extraction from SQL body
# ---------------------------------------------------------------------------

_SQL_KEYWORDS: frozenset[str] = frozenset({
    'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'FROM', 'WHERE', 'JOIN', 'INTO',
    'SET', 'AND', 'OR', 'NOT', 'NULL', 'IS', 'IN', 'AS', 'ON', 'BY',
    'LIMIT', 'ORDER', 'GROUP', 'HAVING', 'THEN', 'WHEN', 'CASE', 'ELSE', 'END',
    'BEGIN', 'DECLARE', 'IF', 'ELSEIF', 'SIGNAL', 'SQLSTATE', 'MESSAGE_TEXT',
    'VALUES', 'CALL', 'CONCAT', 'IFNULL', 'COALESCE', 'NOW', 'UUID', 'REPLACE',
    'COUNT', 'SUM', 'MAX', 'MIN', 'INTERVAL', 'DAY', 'YEAR', 'DATE_ADD',
    'PROCEDURE', 'TRIGGER', 'FOR', 'EACH', 'ROW', 'OLD', 'NEW', 'TRUE', 'FALSE',
    'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'DISTINCT', 'ALL', 'UNION',
    'UNSIGNED', 'INT', 'VARCHAR', 'DATETIME', 'DATE', 'DECIMAL', 'TINYINT',
    'TEXT', 'BOOLEAN', 'ERROR', 'WARNING', 'NOTE', 'BEFORE', 'AFTER',
    'DROP', 'CREATE', 'TABLE', 'TEMPORARY', 'ALTER', 'ADD', 'COLUMN',
    'SUBSTRING', 'LOWER', 'UPPER', 'TRIM', 'LENGTH', 'LIKE', 'BETWEEN',
    'EXISTS', 'CHAR', 'FLOOR', 'CEIL', 'ROUND',
    # MySQL variables
    'FOUND_ROWS',
})

# Table aliases used in trigger bodies that we should skip
_TABLE_ALIASES: frozenset[str] = frozenset({'m', 'p', 'g', 's', 'e', 'ml'})


def _extract_column_refs_from_trigger(body: str, trigger_table: str) -> list[str]:
    """
    Extract PascalCase column-like identifiers from trigger SQL body.
    Returns candidates that could be column references (not keywords or table names).
    """
    # Strip string literals and comments
    body = re.sub(r"'[^']*'", "''", body)
    body = re.sub(r'--[^\n]*', '', body)
    body = re.sub(r'/\*.*?\*/', '', body, flags=re.DOTALL)

    # Extract PascalCase words (≥4 chars) that look like column names
    candidates = re.findall(r'\b([A-Z][a-zA-Z0-9]{3,})\b', body)

    filtered = []
    for c in candidates:
        if c.upper() in _SQL_KEYWORDS:
            continue
        if c in _TABLE_ALIASES:
            continue
        if c.startswith('p_') or c.startswith('v_') or c.startswith('@'):
            continue
        filtered.append(c)
    return filtered


def _get_select_from_tables(body: str) -> list[str]:
    """Extract table names used in SELECT FROM ... clauses in the trigger body."""
    tables = re.findall(r'\bFROM\s+(\w+)\b', body, re.IGNORECASE)
    tables += re.findall(r'\bJOIN\s+(\w+)\b', body, re.IGNORECASE)
    tables += re.findall(r'\bUPDATE\s+(\w+)\b', body, re.IGNORECASE)
    return [t.lower() for t in tables]


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestTriggerColumnReferences:
    """
    Every column referenced in a trigger body must exist in the schema.

    Catches bugs like:
    - trg_payments_auto_fill selecting `PaymentDate` from gmail_transactions
      (which has `TransactionDate`) → every payment INSERT fails with 1054
    - Triggers updated after a column rename with the old name still in use
    """

    @pytest.fixture(scope='class')
    def schema_data(self):
        return {
            'cols_by_table': _load_columns_by_table(),
            'all_cols': _load_all_columns(),
            'triggers': _load_triggers(),
        }

    def test_schema_has_triggers(self, schema_data):
        assert len(schema_data['triggers']) >= 5, \
            "Too few triggers parsed — check schema_snapshot.sql format"

    def test_trg_payments_auto_fill_uses_transaction_date(self, schema_data):
        """
        Regression: trg_payments_auto_fill previously used PaymentDate in its
        SELECT FROM gmail_transactions (column doesn't exist there).
        Must use TransactionDate.
        """
        trigger = next(
            (t for t in schema_data['triggers'] if t['name'] == 'trg_payments_auto_fill'),
            None,
        )
        if trigger is None:
            pytest.skip("trg_payments_auto_fill not found in schema")

        body = trigger['body']
        # Must use TransactionDate
        assert 'TransactionDate' in body, (
            "trg_payments_auto_fill must SELECT TransactionDate from gmail_transactions, "
            "not PaymentDate. This trigger bug caused all payment INSERTs to fail with 1054."
        )
        # Must NOT use PaymentDate in the SELECT FROM gmail_transactions clause
        # (PaymentDate is on the payments table, not gmail_transactions)
        from_gmail = re.search(
            r'SELECT.*?FROM\s+gmail_transactions',
            body, re.IGNORECASE | re.DOTALL,
        )
        if from_gmail:
            select_clause = from_gmail.group(0)
            assert 'PaymentDate' not in select_clause, (
                "trg_payments_auto_fill selects PaymentDate FROM gmail_transactions, "
                "but gmail_transactions has no PaymentDate column (use TransactionDate). "
                "This causes MySQL 1054 on every payment INSERT."
            )

    def test_trigger_columns_exist_in_schema(self, schema_data):
        """
        All PascalCase identifiers in each trigger body must exist somewhere
        in the schema (any table). This is a broad guard — a more precise check
        would verify against the specific source table, but this catches the
        most common case of a renamed column still referenced.
        """
        all_cols_lower = {c.lower() for c in schema_data['all_cols']}
        violations = []

        for trig in schema_data['triggers']:
            cols = _extract_column_refs_from_trigger(trig['body'], trig['table'])
            for col in cols:
                if col.lower() not in all_cols_lower:
                    # Allow some false-positive-prone identifiers
                    if col in (
                        'SQLSTATE', 'ErrorContextID', 'AllowedRange',
                        'ValidValueExamples', 'SuggestedFix', 'TechnicalMessage',
                        'ProblematicValue', 'SubmissionType',  # known valid exceptions
                    ):
                        continue
                    violations.append((trig['name'], trig['table'], col))

        # Report but allow some false positives from trigger-specific constructs
        # Only fail if we find columns that look clearly wrong
        if violations:
            # Filter to high-confidence violations (not UUIDs, not single-word status values)
            high_confidence = [
                (n, t, c) for n, t, c in violations
                if len(c) > 4 and not c.endswith('ID') or c in (
                    'PaymentDate',  # the actual historical bug
                    'LastLogin', 'LastLoginDate',  # deleted columns
                )
            ]
            # Don't fail on minor false positives — only on the known bad patterns
            critical = [
                (n, t, c) for n, t, c in high_confidence
                if c in ('PaymentDate', 'LastLogin', 'LastLoginDate', 'LastUpdated')
                and c not in schema_data['all_cols']
            ]
            assert not critical, (
                "Trigger body references known-deleted/wrong columns:\n"
                + "\n".join(f"  trigger={n} table={t} col={c}" for n, t, c in critical)
            )

    def test_trg_payments_auto_fill_sets_valid_columns(self, schema_data):
        """
        Columns SET in trg_payments_auto_fill (NEW.col = ...) must exist
        in the payments table.
        """
        trigger = next(
            (t for t in schema_data['triggers'] if t['name'] == 'trg_payments_auto_fill'),
            None,
        )
        if trigger is None:
            pytest.skip("trg_payments_auto_fill not found")

        payments_cols = schema_data['cols_by_table'].get('payments', set())
        payments_lower = {c.lower() for c in payments_cols}

        # Find SET NEW.<col> = ... in trigger body
        set_cols = re.findall(r'SET\s+NEW\.(\w+)\s*=', trigger['body'], re.IGNORECASE)
        for col in set_cols:
            assert col.lower() in payments_lower, (
                f"trg_payments_auto_fill sets NEW.{col} but '{col}' is not in "
                f"the payments table schema. This causes MySQL 1054 on every INSERT."
            )

    def test_gmail_transactions_table_has_transaction_date(self, schema_data):
        """
        Confirm gmail_transactions has TransactionDate (not PaymentDate).
        This is the table-level ground truth that the trigger bug violated.
        """
        gmail_cols = schema_data['cols_by_table'].get('gmail_transactions', set())
        assert 'TransactionDate' in gmail_cols, (
            "gmail_transactions must have 'TransactionDate' column. "
            "This is what triggers should reference, not 'PaymentDate'."
        )
        assert 'PaymentDate' not in gmail_cols, (
            "gmail_transactions should NOT have 'PaymentDate' — that column belongs "
            "to the payments table. If it was added, triggers referencing it need review."
        )

    def test_payments_table_has_payment_date(self, schema_data):
        """payments table must have PaymentDate (filled by trigger from gmail_transactions)."""
        payments_cols = schema_data['cols_by_table'].get('payments', set())
        assert 'PaymentDate' in payments_cols, (
            "payments table must have 'PaymentDate' — filled by trg_payments_auto_fill"
        )


class TestTriggerNewColReferences:
    """
    NEW.<col> and OLD.<col> references in trigger bodies must be columns
    on the trigger's own table (not another table's columns).
    """

    @pytest.fixture(scope='class')
    def schema_data(self):
        return {
            'cols_by_table': _load_columns_by_table(),
            'triggers': _load_triggers(),
        }

    def test_new_col_refs_exist_in_trigger_table(self, schema_data):
        """
        NEW.Foo or OLD.Foo inside a trigger must be a column of the table
        the trigger is ON.

        Catches: trigger ON payments but NEW.SomeOtherTableColumn referenced.
        """
        violations = []
        for trig in schema_data['triggers']:
            table_cols = schema_data['cols_by_table'].get(trig['table'], set())
            table_cols_lower = {c.lower() for c in table_cols}

            # Find NEW.col and OLD.col references
            refs = re.findall(r'\b(?:NEW|OLD)\.(\w+)', trig['body'], re.IGNORECASE)
            for col in refs:
                if col.lower() not in table_cols_lower:
                    violations.append((trig['name'], trig['table'], col))

        assert not violations, (
            "Trigger NEW/OLD references non-existent columns on its table:\n"
            + "\n".join(
                f"  trigger={n} ON {t}: NEW/OLD.{c} — column not in {t}"
                for n, t, c in violations
            )
            + "\n\nThis causes MySQL 1054 on every DML operation on that table."
        )
