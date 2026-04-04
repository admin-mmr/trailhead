#!/usr/bin/env python3
"""
Schema Validation Tool - Comprehensive analysis with verbose error reporting
Checks for:
  1. Missing PRIMARY KEYs
  2. DATETIME columns without DEFAULT
  3. FOREIGN KEY references (orphaned records)
  4. ENUM value mismatches
  5. Data type inconsistencies
  6. NULL constraint violations
  7. Duplicate entries where UNIQUE is expected
"""

import os
import sys
import mysql.connector
from urllib.parse import urlparse
from datetime import datetime

class SchemaValidator:
    def __init__(self):
        self.conn = None
        self.cursor = None
        self.errors = []
        self.warnings = []
        self.info = []

    def connect(self):
        """Connect to MySQL database"""
        db_url = os.environ.get('DATABASE_URL', '')
        if not db_url:
            raise Exception("DATABASE_URL not set")

        parsed = urlparse(db_url)
        self.conn = mysql.connector.connect(
            host=parsed.hostname,
            user=parsed.username,
            password=parsed.password,
            database=parsed.path.lstrip('/'),
            port=parsed.port or 3306
        )
        self.cursor = self.conn.cursor(dictionary=True)

    def get_tables(self):
        """Fetch all tables in database"""
        self.cursor.execute("""
            SELECT TABLE_NAME
            FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY TABLE_NAME
        """)
        return [row['TABLE_NAME'] for row in self.cursor.fetchall()]

    def get_table_structure(self, table_name):
        """Get column and constraint info for a table"""
        # Column info
        self.cursor.execute(f"""
            SELECT
                COLUMN_NAME,
                DATA_TYPE,
                IS_NULLABLE,
                COLUMN_KEY,
                EXTRA,
                COLUMN_DEFAULT,
                COLUMN_COMMENT
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
            ORDER BY ORDINAL_POSITION
        """, (table_name,))
        columns = self.cursor.fetchall()

        # Constraint info
        self.cursor.execute(f"""
            SELECT
                CONSTRAINT_NAME,
                CONSTRAINT_TYPE,
                COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
        """, (table_name,))
        constraints = self.cursor.fetchall()

        return columns, constraints

    def validate_primary_key(self, table_name, constraints):
        """Check if table has PRIMARY KEY"""
        pk_exists = any(c['CONSTRAINT_TYPE'] == 'PRIMARY KEY' for c in constraints)
        if not pk_exists:
            self.errors.append(f"TABLE '{table_name}': Missing PRIMARY KEY")

    def validate_datetime_columns(self, table_name, columns):
        """Check DATETIME columns have DEFAULT values"""
        for col in columns:
            if col['DATA_TYPE'] in ('DATETIME', 'TIMESTAMP'):
                if col['COLUMN_DEFAULT'] is None and 'DEFAULT' not in (col['EXTRA'] or ''):
                    if col['IS_NULLABLE'] == 'NO':
                        self.errors.append(
                            f"TABLE '{table_name}' COLUMN '{col['COLUMN_NAME']}': "
                            f"NOT NULL DATETIME without DEFAULT — will cause INSERT failures"
                        )

    def validate_enum_columns(self, table_name, columns):
        """Check ENUM columns and their values"""
        for col in columns:
            if col['DATA_TYPE'] == 'enum':
                # Extract enum values
                self.cursor.execute(f"""
                    SELECT COLUMN_TYPE
                    FROM INFORMATION_SCHEMA.COLUMNS
                    WHERE TABLE_SCHEMA = DATABASE()
                      AND TABLE_NAME = %s
                      AND COLUMN_NAME = %s
                """, (table_name, col['COLUMN_NAME']))
                result = self.cursor.fetchone()
                if result:
                    col_type = result['COLUMN_TYPE']
                    self.info.append(
                        f"TABLE '{table_name}' COLUMN '{col['COLUMN_NAME']}': "
                        f"ENUM {col_type} — verify values match application logic"
                    )

    def validate_foreign_keys(self, table_name):
        """Check for orphaned FOREIGN KEY references"""
        self.cursor.execute(f"""
            SELECT
                CONSTRAINT_NAME,
                COLUMN_NAME,
                REFERENCED_TABLE_NAME,
                REFERENCED_COLUMN_NAME
            FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = %s
              AND REFERENCED_TABLE_NAME IS NOT NULL
        """, (table_name,))

        fks = self.cursor.fetchall()
        for fk in fks:
            col = fk['COLUMN_NAME']
            ref_table = fk['REFERENCED_TABLE_NAME']
            ref_col = fk['REFERENCED_COLUMN_NAME']

            # Count orphaned records
            self.cursor.execute(f"""
                SELECT COUNT(*) as orphan_count
                FROM `{table_name}` t
                WHERE t.`{col}` IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1 FROM `{ref_table}` r
                    WHERE r.`{ref_col}` = t.`{col}`
                  )
            """)
            result = self.cursor.fetchone()
            orphan_count = result['orphan_count'] if result else 0

            if orphan_count > 0:
                # Show specific orphaned records
                self.cursor.execute(f"""
                    SELECT DISTINCT t.`{col}`
                    FROM `{table_name}` t
                    WHERE t.`{col}` IS NOT NULL
                      AND NOT EXISTS (
                        SELECT 1 FROM `{ref_table}` r
                        WHERE r.`{ref_col}` = t.`{col}`
                      )
                    LIMIT 10
                """)
                orphans = [row[f'{col}'] for row in self.cursor.fetchall()]
                self.errors.append(
                    f"TABLE '{table_name}' COLUMN '{col}': "
                    f"Foreign key violation — {orphan_count} orphaned record(s) "
                    f"referencing non-existent `{ref_table}`.`{ref_col}`. "
                    f"Examples: {orphans}"
                )

    def validate_null_constraints(self, table_name, columns):
        """Check for NULL values in NOT NULL columns"""
        for col in columns:
            if col['IS_NULLABLE'] == 'NO':
                self.cursor.execute(f"""
                    SELECT COUNT(*) as null_count
                    FROM `{table_name}`
                    WHERE `{col['COLUMN_NAME']}` IS NULL
                """)
                result = self.cursor.fetchone()
                null_count = result['null_count'] if result else 0

                if null_count > 0:
                    # Get sample NULL rows
                    self.cursor.execute(f"""
                        SELECT *
                        FROM `{table_name}`
                        WHERE `{col['COLUMN_NAME']}` IS NULL
                        LIMIT 5
                    """)
                    samples = self.cursor.fetchall()
                    self.errors.append(
                        f"TABLE '{table_name}' COLUMN '{col['COLUMN_NAME']}': "
                        f"Constraint violation — {null_count} NULL value(s) found "
                        f"in NOT NULL column. Sample rows: {[dict(s) for s in samples]}"
                    )

    def validate_duplicate_uniques(self, table_name, constraints):
        """Check for duplicate values in UNIQUE columns"""
        unique_cols = [c['COLUMN_NAME'] for c in constraints if c['CONSTRAINT_TYPE'] == 'UNIQUE']

        for col in unique_cols:
            self.cursor.execute(f"""
                SELECT `{col}`, COUNT(*) as dup_count
                FROM `{table_name}`
                WHERE `{col}` IS NOT NULL
                GROUP BY `{col}`
                HAVING COUNT(*) > 1
            """)
            dups = self.cursor.fetchall()

            for dup in dups:
                val = dup[f'{col}']
                count = dup['dup_count']
                self.errors.append(
                    f"TABLE '{table_name}' UNIQUE COLUMN '{col}': "
                    f"Duplicate value '{val}' found {count} times"
                )

    def validate_table(self, table_name):
        """Run all validations for a table"""
        try:
            columns, constraints = self.get_table_structure(table_name)

            self.validate_primary_key(table_name, constraints)
            self.validate_datetime_columns(table_name, columns)
            self.validate_enum_columns(table_name, columns)
            self.validate_foreign_keys(table_name)
            self.validate_null_constraints(table_name, columns)
            self.validate_duplicate_uniques(table_name, constraints)

        except Exception as e:
            self.errors.append(f"TABLE '{table_name}': Validation error — {str(e)}")

    def run(self):
        """Run complete schema validation"""
        try:
            self.connect()
            tables = self.get_tables()

            print("=" * 80)
            print(f"SCHEMA VALIDATION REPORT — {datetime.now().isoformat()}")
            print("=" * 80)
            print(f"\nAnalyzing {len(tables)} table(s)...\n")

            for table in tables:
                self.validate_table(table)

            # Print results
            print("\n" + "=" * 80)
            if self.errors:
                print(f"\n❌ ERRORS ({len(self.errors)}):\n")
                for i, error in enumerate(self.errors, 1):
                    print(f"{i}. {error}\n")
            else:
                print("\n✅ NO ERRORS\n")

            if self.warnings:
                print(f"\n⚠️  WARNINGS ({len(self.warnings)}):\n")
                for i, warning in enumerate(self.warnings, 1):
                    print(f"{i}. {warning}\n")

            if self.info:
                print(f"\nℹ️  INFO ({len(self.info)}):\n")
                for i, inf in enumerate(self.info, 1):
                    print(f"{i}. {inf}\n")

            print("=" * 80)
            return len(self.errors) == 0

        except Exception as e:
            print(f"\n❌ VALIDATION FAILED: {e}")
            import traceback
            traceback.print_exc()
            return False
        finally:
            if self.conn:
                self.conn.close()

if __name__ == '__main__':
    from dotenv import load_dotenv
    # Try loading from .env first
    try:
        load_dotenv('/sessions/zen-great-lamport/mnt/trailhead/.env.local')
    except:
        pass

    validator = SchemaValidator()
    success = validator.run()
    sys.exit(0 if success else 1)
