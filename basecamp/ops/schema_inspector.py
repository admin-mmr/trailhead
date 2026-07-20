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

try:
    from schema_inspector_helpers import InspectorReportsMixin
except ImportError:  # when imported as a package module
    from .schema_inspector_helpers import InspectorReportsMixin


class MySQLInspector(InspectorReportsMixin):
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
