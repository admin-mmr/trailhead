# type: ignore
#!/usr/bin/env python3
"""
Reporting & reconciliation helpers for the MMR Database Schema Inspector.

Provides ``InspectorReportsMixin`` — the human-readable summary, detail,
and schema-validation methods. These are mixed into ``MySQLInspector``
(see ``schema_inspector.py``) and rely on the inspection primitives
(``get_tables``, ``get_table_schema``, etc.) defined there.
"""

from typing import Dict, List


class InspectorReportsMixin:
    """Summary / detail printing and schema validation for MySQLInspector."""

    # ========== SCHEMA SUMMARY ==========

    def print_table_summary(self):
        """Print summary of all tables with row counts"""
        tables = self.get_tables()

        print("=" * 70)
        print("TABLE SUMMARY")
        print("=" * 70)
        print(f"{'Table Name':<30} {'Rows':>10} {'Status':<20}\n")

        total_rows = 0
        for table in sorted(tables):
            count = self.get_table_row_count(table)
            status = "📊 Has data" if count > 0 else "⭕ Empty"
            total_rows += count if count >= 0 else 0
            print(f"{table:<30} {count:>10} {status:<20}")

        print(f"\n{'TOTAL':<30} {total_rows:>10}")
        print("=" * 70)

    def print_table_details(self, table_name: str):
        """Print detailed schema for a specific table"""
        schema = self.get_table_schema(table_name)
        pk = self.get_primary_key(table_name)
        fks = self.get_foreign_keys(table_name)
        indexes = self.get_indexes(table_name)
        row_count = self.get_table_row_count(table_name)

        print(f"\n{'=' * 70}")
        print(f"TABLE: {table_name.upper()}")
        print(f"{'=' * 70}")
        print(f"Rows: {row_count}\n")

        # Columns
        print("COLUMNS:")
        print(f"{'Field':<20} {'Type':<25} {'Null':<6} {'Key':<5} {'Default':<15}")
        print("-" * 75)
        for field, col_type, nullable, key, default, extra in schema:
            null_str = nullable if nullable in ['YES', 'NO'] else 'NO'
            key_str = key if key else '-'
            default_str = str(default)[:15] if default else '-'
            print(f"{field:<20} {col_type:<25} {null_str:<6} {key_str:<5} {default_str:<15}")

        # Primary Key
        if pk:
            print(f"\nPRIMARY KEY: {pk}")

        # Foreign Keys
        if fks:
            print(f"\nFOREIGN KEYS ({len(fks)}):")
            for fk in fks:
                print(f"  • {fk['constraint']}: {fk['column']} → {fk['references']}")

        # Indexes
        if indexes:
            print(f"\nINDEXES ({len(indexes)}):")
            for idx_name, idx_info in indexes.items():
                unique_str = "UNIQUE" if idx_info['unique'] else ""
                cols = ', '.join(idx_info['columns'])
                print(f"  • {idx_name} {unique_str}: ({cols})")

        print()

    def print_all_schemas(self):
        """Print detailed schema for all tables"""
        tables = self.get_tables()
        for table in sorted(tables):
            self.print_table_details(table)

    # ========== RECONCILIATION ==========

    def validate_schema(self) -> Dict[str, List[str]]:
        """Validate schema against expected structure and report issues"""
        issues = {
            'missing_tables': [],
            'extra_tables': [],
            'null_violations': [],
            'fk_violations': [],
            'duplicate_keys': []
        }

        expected_tables = {
            'families', 'members', 'member_log', 'otp_codes',
            'password_reset_tokens', 'gmail_transactions', 'webapp_events',
            'payments', 'activity_log', 'config', 'schema_migrations'
        }

        actual_tables = set(self.get_tables())

        # Check for missing tables
        issues['missing_tables'] = list(expected_tables - actual_tables)

        # Check for extra tables
        issues['extra_tables'] = list(actual_tables - expected_tables)

        return issues

    def print_validation_report(self):
        """Print validation report with all issues found"""
        print(f"\n{'=' * 70}")
        print("SCHEMA VALIDATION REPORT")
        print(f"{'=' * 70}\n")

        issues = self.validate_schema()

        if issues['missing_tables']:
            print("❌ MISSING TABLES (Expected but not found):")
            for table in sorted(issues['missing_tables']):
                print(f"   • {table}")
            print()

        if issues['extra_tables']:
            print("⚠️  EXTRA TABLES (Not expected):")
            for table in sorted(issues['extra_tables']):
                print(f"   • {table}")
            print()

        # Summary
        all_issues = issues['missing_tables'] + issues['extra_tables']

        if not all_issues:
            print("✅ Schema validation passed - all expected tables found!")
        else:
            print(f"⚠️  Found {len(all_issues)} schema issue(s)")

        print(f"\n{'=' * 70}\n")
