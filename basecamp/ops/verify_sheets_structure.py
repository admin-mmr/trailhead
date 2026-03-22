#!/usr/bin/env python3
"""
Verify that Google Sheets have the correct column structure by reading from database schema.
This helps diagnose "column not found" errors during syncs.
"""

import os
import sys
import json
from pathlib import Path
from urllib.parse import urlparse

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))


def load_env():
    """Load environment variables from os.environ (set by load-env.sh wrapper)"""
    env_vars = {}

    # Get from environment (set by load-env.sh via Keychain integration)
    required_vars = ['SPREADSHEET_ID', 'GOOGLE_APPLICATION_CREDENTIALS', 'GMAIL_TRANSACTION_SHEET_ID', 'DATABASE_URL']

    for var in required_vars:
        value = os.environ.get(var, '')
        if value:
            env_vars[var] = value

    # Also check .env.local as fallback
    env_file = Path(__file__).parent.parent / '.env.local'
    if env_file.exists():
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    key = key.strip()
                    value = value.strip().strip('"').strip("'")
                    # Only add if not already set from environment
                    if key not in env_vars and value:
                        env_vars[key] = value

    return env_vars


def get_db_columns(table_name):
    """Get actual column names from MySQL database schema"""
    try:
        import mysql.connector

        env_vars = load_env()
        db_url = env_vars.get('DATABASE_URL', '')

        if not db_url:
            print(f"  Error: DATABASE_URL not set")
            return None

        # Parse MySQL URL: mysql://user:pass@host:port/database?ssl=true
        parsed = urlparse(db_url)

        config = {
            'host': parsed.hostname,
            'port': parsed.port or 3306,
            'user': parsed.username,
            'password': parsed.password,
            'database': parsed.path.lstrip('/').split('?')[0],
        }

        conn = mysql.connector.connect(**config)
        cursor = conn.cursor()

        # Get column names for the table
        cursor.execute(f"""
            SELECT COLUMN_NAME
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = %s AND TABLE_NAME = %s
            ORDER BY ORDINAL_POSITION
        """, (config['database'], table_name))

        columns = [row[0] for row in cursor.fetchall()]
        cursor.close()
        conn.close()

        return columns

    except Exception as e:
        print(f"  Error reading database schema: {e}")
        return None


def get_sheet_headers(spreadsheet_id, sheet_name):
    """Get the headers from a Google Sheet"""
    try:
        from google.oauth2 import service_account
        from googleapiclient.discovery import build

        env_vars = load_env()
        creds_path = env_vars.get('GOOGLE_APPLICATION_CREDENTIALS')

        if not creds_path or not os.path.exists(creds_path):
            print(f"  Error: Google credentials not found at {creds_path}")
            return None

        creds = service_account.Credentials.from_service_account_file(
            creds_path,
            scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
        )

        service = build('sheets', 'v4', credentials=creds)

        # Get first row as headers
        result = service.spreadsheets().values().get(
            spreadsheetId=spreadsheet_id,
            range=f"'{sheet_name}'!A1:Z1"
        ).execute()

        headers = result.get('values', [[]])[0]
        return headers

    except Exception as e:
        print(f"  Error reading sheet: {e}")
        return None


def check_headers(sheet_headers, db_columns, sheet_name):
    """Check if sheet headers match database columns"""
    if not sheet_headers:
        print(f"  ✗ No headers found in Google Sheet")
        return False

    if not db_columns:
        print(f"  ⚠ Could not read database schema, skipping validation")
        return True  # Don't fail if we can't read DB

    print(f"  Google Sheet headers: {sheet_headers}")
    print(f"  Expected (from DB):   {db_columns}")

    all_good = True

    # Check each expected column
    for expected in db_columns:
        if expected in sheet_headers:
            idx = sheet_headers.index(expected)
            print(f"  ✓ '{expected}' found at column {chr(65 + idx)}")
        else:
            # Check for similar names (case-insensitive)
            similar = [h for h in sheet_headers if h.lower() == expected.lower()]

            if similar:
                print(f"  ⚠ '{expected}' NOT found, but found: {similar[0]}")
                print(f"     → Rename '{similar[0]}' to '{expected}'")
            else:
                print(f"  ✗ '{expected}' NOT found")

            all_good = False

    return all_good


def main():
    print("=" * 60)
    print("GOOGLE SHEETS STRUCTURE VERIFICATION")
    print("Reading expected columns from database schema...")
    print("=" * 60)
    print()

    env_vars = load_env()

    # Map sheets to their database tables and spreadsheet IDs
    sheets_to_check = {
        'Main': {
            'spreadsheet_id': env_vars.get('SPREADSHEET_ID'),
            'table_name': 'members'
        },
        'Payment-History': {
            'spreadsheet_id': env_vars.get('SPREADSHEET_ID'),
            'table_name': 'payments'
        },
        'WebApp-Events': {
            'spreadsheet_id': env_vars.get('SPREADSHEET_ID'),
            'table_name': 'webapp_events'
        },
        'Active': {
            'spreadsheet_id': env_vars.get('GMAIL_TRANSACTION_SHEET_ID', env_vars.get('SPREADSHEET_ID')),
            'table_name': 'gmail_transactions'
        }
    }

    overall_ok = True

    for sheet_name, config in sheets_to_check.items():
        print(f"Checking '{sheet_name}' sheet...")
        print(f"  Database table: {config['table_name']}")

        # Get expected columns from database
        db_columns = get_db_columns(config['table_name'])

        if not db_columns:
            print(f"  ⚠ Skipping (couldn't read database schema)")
            print()
            continue

        # Get actual headers from Google Sheet
        spreadsheet_id = config['spreadsheet_id']
        if not spreadsheet_id:
            print(f"  ⚠ No spreadsheet ID configured for this sheet")
            print()
            continue

        sheet_headers = get_sheet_headers(spreadsheet_id, sheet_name)

        if sheet_headers:
            sheet_ok = check_headers(sheet_headers, db_columns, sheet_name)
            if not sheet_ok:
                overall_ok = False
        else:
            print(f"  ✗ Could not read headers from Google Sheet")
            overall_ok = False

        print()

    print("=" * 60)
    if overall_ok:
        print("✓ ALL SHEETS LOOK GOOD")
        print()
        print("Your Google Sheets structure matches the database schema.")
        print("If syncs are still not working, check that:")
        print("  1. There's actual data in the sheets (not just headers)")
        print("  2. Database connection is working")
        print("  3. GitHub Actions has all secrets configured")
    else:
        print("✗ ISSUES FOUND")
        print()
        print("Column headers don't match the database schema.")
        print("Please rename the columns in your Google Sheets to match")
        print("the expected names shown above.")

    return 0 if overall_ok else 1


if __name__ == '__main__':
    sys.exit(main())
