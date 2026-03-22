#!/bin/bash

# Comprehensive debugging script for sync setup
# Run this to diagnose issues with your sync configuration

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "================================"
echo "SYNC SETUP DIAGNOSTIC REPORT"
echo "================================"
echo ""

# Load environment using load-env.sh (which handles Keychain)
echo "[1/6] Loading environment variables..."
if [ -f load-env.sh ]; then
    source load-env.sh
    echo ""
else
    echo "✗ load-env.sh not found"
    exit 1
fi

echo ""
echo "[2/6] Checking environment variables..."
echo "---"

# Check each variable
check_var() {
    local var_name=$1
    eval "var_value=\$$var_name"

    if [ -z "$var_value" ]; then
        echo "✗ $var_name: NOT SET"
    else
        local length=${#var_value}
        if [ "$var_name" = "AZURE_STORAGE_CONNECTION_STRING" ] || [ "$var_name" = "DATABASE_URL" ]; then
            echo "✓ $var_name: SET (${length} chars)"
        else
            echo "✓ $var_name: SET"
        fi
    fi
}

check_var "SPREADSHEET_ID"
check_var "GOOGLE_APPLICATION_CREDENTIALS"
check_var "DATABASE_URL"
check_var "AZURE_STORAGE_CONNECTION_STRING"
check_var "SMTP_USERNAME"
check_var "SMTP_PASSWORD"

# Detailed checks for critical variables
echo ""
echo "[3/6] Validating critical variables..."
echo "---"

if [ ! -z "$AZURE_STORAGE_CONNECTION_STRING" ]; then
    len=${#AZURE_STORAGE_CONNECTION_STRING}
    if [ $len -lt 100 ]; then
        echo "⚠ AZURE_STORAGE_CONNECTION_STRING seems too short ($len chars, expected 150+)"
    else
        echo "✓ AZURE_STORAGE_CONNECTION_STRING length OK ($len chars)"
    fi

    # Check for required parts
    if [[ "$AZURE_STORAGE_CONNECTION_STRING" == *"DefaultEndpointsProtocol"* ]]; then
        echo "✓ Azure string contains DefaultEndpointsProtocol"
    else
        echo "✗ Azure string missing DefaultEndpointsProtocol"
    fi

    if [[ "$AZURE_STORAGE_CONNECTION_STRING" == *"AccountName"* ]]; then
        echo "✓ Azure string contains AccountName"
    else
        echo "✗ Azure string missing AccountName"
    fi

    if [[ "$AZURE_STORAGE_CONNECTION_STRING" == *"AccountKey"* ]]; then
        echo "✓ Azure string contains AccountKey"
    else
        echo "✗ Azure string missing AccountKey"
    fi
fi

if [ ! -z "$DATABASE_URL" ]; then
    if [[ "$DATABASE_URL" == mysql://* ]]; then
        echo "✓ DATABASE_URL format looks correct"
    else
        echo "⚠ DATABASE_URL doesn't start with mysql://"
    fi
fi

echo ""
echo "[4/6] Checking files and dependencies..."
echo "---"

# Check Python files exist
if [ -f ops/sync_sheets_to_mysql.py ]; then
    echo "✓ ops/sync_sheets_to_mysql.py found"
else
    echo "✗ ops/sync_sheets_to_mysql.py NOT FOUND"
fi

if [ -f requirements.txt ]; then
    echo "✓ requirements.txt found"
else
    echo "✗ requirements.txt NOT FOUND"
fi

# Check if Python packages are installed
echo ""
echo "[5/6] Checking Python dependencies..."
echo "---"

python3 << 'PYEOF'
import sys
packages = ['google.auth', 'google.oauth2', 'google.cloud', 'mysql.connector', 'azure.storage.blob']
missing = []

for pkg in packages:
    try:
        __import__(pkg.split('.')[0])
        print(f"✓ {pkg.split('.')[0]} installed")
    except ImportError:
        print(f"✗ {pkg.split('.')[0]} NOT installed")
        missing.append(pkg)

if missing:
    print("\nRun: pip install -r requirements.txt --break-system-packages")
PYEOF

echo ""
echo "[6/6] Testing Google Sheets access..."
echo "---"

# Try to read Google credentials
if [ ! -z "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
    if [ -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
        echo "✓ Google credentials file exists"
        python3 << 'PYEOF'
import json
try:
    with open(__import__('os').environ['GOOGLE_APPLICATION_CREDENTIALS']) as f:
        creds = json.load(f)
        if 'type' in creds and creds['type'] == 'service_account':
            print(f"✓ Credentials format OK (service account: {creds.get('client_email', 'unknown')})")
        else:
            print("⚠ Credentials don't appear to be service account type")
except Exception as e:
    print(f"✗ Error reading credentials: {e}")
PYEOF
    else
        echo "✗ Google credentials file path doesn't exist: $GOOGLE_APPLICATION_CREDENTIALS"
    fi
else
    echo "✗ GOOGLE_APPLICATION_CREDENTIALS not set"
fi

echo ""
echo "================================"
echo "NEXT STEPS"
echo "================================"
echo ""
echo "1. If any ✗ marks appear above, fix those issues first"
echo "2. Check that Google Sheets column names have NO SPACES:"
echo "   - FirstName (not 'First Name')"
echo "   - LastName (not 'Last Name')"
echo "   - PaymentCheck (not 'Payment Check')"
echo "3. Add test data to your Google Sheets"
echo "4. Run a test sync:"
echo "   python3 ops/sync_sheets_to_mysql.py --sheet-name 'Main' --table-name 'members' --dry-run"
echo "5. Check GitHub Actions workflows are enabled and secrets are set"
echo ""
echo "For more details, see: DEBUG_SYNC_SETUP.md"
echo ""
