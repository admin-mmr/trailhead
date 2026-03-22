# type: ignore
#!/usr/bin/env python3
"""
MMR Database Schema Inspector & Reconciliation Tool

Connects to MySQL and provides:
- Complete schema inspection (tables, columns, constraints)
- Row count analysis
- Foreign key relationship validation
- Data integrity checks
- Schema comparison against expected structure
"""

import os
import sys
import json
from urllib.parse import urlparse
from typing import Dict, List, Tuple, Optional
import mysql.connector
from mysql.connector import Error

class MySQLInspector:
    def __init__(self):
        """Initialize connection to MySQL from DATABASE_URL environment variable"""
        self.connection = None
        self.cursor = None
        self.db_url = os.environ.get('DATABASE_URL')

        if not self.db_url:
            raise ValueError("DATABASE_URL environment variable not set")

        self.config = self._parse_database_url()

    def _parse_database_url(self) -> Dict:
        """Parse DATABASE_URL into mysql.connector config"""
        parsed = urlparse(self.db_url)

        return {
            'host': parsed.hostname,
            'user': parsed.username,
            'password': parsed.password,
            'database': parsed.path.lstrip('/').split('?')[0],
            'ssl_disabled': False,
            'raise_on_warnings': False
        }

    def connect(self) -> bool:
        """Establish MySQL connection"""
        try:
            self.connection = mysql.connector.connect(**self.config)
            self.cursor = self.connection.cursor()
            print(f"✅ Connected to MySQL")
            print(f"   Host: {self.config['host']}")
            print(f"   Database: {self.config['database']}\n")
            return True
        except Error as e:
            print(f"❌ Connection failed: {e}")
            return False

    def close(self):
        """Close MySQL connection"""
        if self.cursor:
            self.cursor.close()
        if self.connection:
            self.connection.close()

    # ========== SCHEMA INSPECTION ==========

    def get_tables(self) -> List[str]:
        """Get all table names in database"""
        self.cursor.execute("SHOW TABLES;")
        return [row[0] for row in self.cursor.fetchall()]

    def get_table_schema(self, table_name: str) -> List[Tuple]:
        """Get column definitions for a table (Field, Type, Null, Key, Default, Extra)"""
        self.cursor.execute(f"DESCRIBE {table_name};")
        return self.cursor.fetchall()

    def get_table_row_count(self, table_name: str) -> int:
        """Get number of rows in a table"""
        try:
            self.cursor.execute(f"SELECT COUNT(*) FROM {table_name};")
            return self.cursor.fetchone()[0]
        except Error:
            return -1  # Error reading table

    def get_primary_key(self, table_name: str) -> Optional[str]:
        """Get primary key column(s) for a table"""
        self.cursor.execute(f"""
            SELECT COLUMN_NAME
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s AND COLUMN_KEY = 'PRI'
        """, (self.config['database'], table_name))
        results = self.cursor.fetchall()
        return ', '.join([row[0] for row in results]) if results else None

    def get_foreign_keys(self, table_name: str) -> List[Dict]:
        """Get foreign key constraints for a table"""
        self.cursor.execute(f"""
            SELECT
                CONSTRAINT_NAME,
                COLUMN_NAME,
                REFERENCED_TABLE_NAME,
                REFERENCED_COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = %s
              AND TABLE_NAME = %s
              AND REFERENCED_TABLE_NAME IS NOT NULL
        """, (self.config['database'], table_name))

        return [
            {
                'constraint': row[0],
                'column': row[1],
                'references': f"{row[2]}.{row[3]}"
            }
            for row in self.cursor.fetchall()
        ]

    def get_indexes(self, table_name: str) -> List[Dict]:
        """Get all indexes for a table"""
        self.cursor.execute(f"""
            SELECT
                INDEX_NAME,
                COLUMN_NAME,
                SEQ_IN_INDEX,
                NON_UNIQUE
            FROM INFORMATION_SCHEMA.STATISTICS
            WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
            ORDER BY INDEX_NAME, SEQ_IN_INDEX
        """, (self.config['database'], table_name))

        indexes = {}
        for row in self.cursor.fetchall():
            idx_name, col, seq, non_unique = row
            if idx_name not in indexes:
                indexes[idx_name] = {
                    'columns': [],
                    'unique': not bool(non_unique)
                }
            indexes[idx_name]['columns'].append(col)

        return indexes

    # ========== DATA INTEGRITY CHECKS ==========

    def check_foreign_key_integrity(self, table_name: str, fk_col: str,
                                   ref_table: str, ref_col: str) -> Tuple[bool, str]:
        """Verify foreign key references exist in parent table"""
        self.cursor.execute(f"""
            SELECT COUNT(*)
            FROM {table_name} t
            LEFT JOIN {ref_table} r ON t.{fk_col} = r.{ref_col}
            WHERE t.{fk_col} IS NOT NULL AND r.{ref_col} IS NULL
        """)
        orphaned = self.cursor.fetchone()[0]

        if orphaned == 0:
            return True, f"✅ All FK references valid (0 orphaned rows)"
        else:
            return False, f"⚠️  {orphaned} orphaned foreign key references found!"

    def check_null_violations(self, table_name: str) -> List[str]:
        """Check for unexpected NULL values in NOT NULL columns"""
        schema = self.get_table_schema(table_name)
        violations = []

        for col_info in schema:
            col_name, col_type, nullable, key, default, extra = col_info

            if nullable == 'NO' and key != 'PRI':  # NOT NULL and not primary key
                self.cursor.execute(f"""
                    SELECT COUNT(*) FROM {table_name}
                    WHERE {col_name} IS NULL
                """)
                null_count = self.cursor.fetchone()[0]

                if null_count > 0:
                    violations.append(f"  ⚠️  {col_name}: {null_count} NULL values (NOT NULL constraint)")

        return violations if violations else ["✅ No NULL constraint violations"]

    def check_duplicate_keys(self, table_name: str) -> Dict[str, int]:
        """Check for duplicate values in UNIQUE columns"""
        schema = self.get_table_schema(table_name)
        duplicates = {}

        for col_info in schema:
            col_name, col_type, nullable, key, default, extra = col_info

            if key == 'UNI':  # UNIQUE constraint
                self.cursor.execute(f"""
                    SELECT {col_name}, COUNT(*)
                    FROM {table_name}
                    WHERE {col_name} IS NOT NULL
                    GROUP BY {col_name} HAVING COUNT(*) > 1
                """)

                dup_rows = self.cursor.fetchall()
                if dup_rows:
                    duplicates[col_name] = len(dup_rows)

        return duplicates

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


def main():
    """Main entry point"""
    inspector = MySQLInspector()

    if not inspector.connect():
        sys.exit(1)

    try:
        # Check command-line arguments
        if len(sys.argv) > 1:
            command = sys.argv[1]

            if command == '--summary':
                inspector.print_table_summary()

            elif command == '--all':
                inspector.print_all_schemas()

            elif command == '--table':
                if len(sys.argv) < 3:
                    print("Usage: python3 schema_inspector.py --table <table_name>")
                    sys.exit(1)
                table_name = sys.argv[2]
                inspector.print_table_details(table_name)

            elif command == '--validate':
                inspector.print_validation_report()

            elif command == '--json':
                # Export schema as JSON
                tables = inspector.get_tables()
                schema_export = {}
                for table in tables:
                    schema = inspector.get_table_schema(table)
                    schema_export[table] = {
                        'row_count': inspector.get_table_row_count(table),
                        'columns': [
                            {
                                'name': col[0],
                                'type': col[1],
                                'nullable': col[2],
                                'key': col[3],
                                'default': col[4],
                                'extra': col[5]
                            }
                            for col in schema
                        ],
                        'foreign_keys': inspector.get_foreign_keys(table),
                        'indexes': inspector.get_indexes(table)
                    }

                print(json.dumps(schema_export, indent=2))

            else:
                print(f"Unknown command: {command}")
                print("\nUsage:")
                print("  python3 schema_inspector.py --summary       # Show table summary")
                print("  python3 schema_inspector.py --all           # Show all schemas")
                print("  python3 schema_inspector.py --table <name>  # Show specific table")
                print("  python3 schema_inspector.py --validate      # Validate schema")
                print("  python3 schema_inspector.py --json          # Export as JSON")
                sys.exit(1)

        else:
            # Default: show summary + validation
            inspector.print_table_summary()
            inspector.print_validation_report()

    finally:
        inspector.close()


if __name__ == '__main__':
    main()
