#!/bin/bash

# Load environment variables from .env.local with Keychain support
# Usage: source load-env.sh
#
# This script:
# 1. Loads variables from .env.local
# 2. Fetches sensitive values from macOS Keychain if not set
# 3. Validates all critical variables are loaded

ENV_FILE="$(dirname "${BASH_SOURCE[0]}")/.env.local"

if [ ! -f "$ENV_FILE" ]; then
    echo "✗ Error: $ENV_FILE not found"
    return 1 2>/dev/null || exit 1
fi

# Load variables from .env.local with proper quoting
set -a
source "$ENV_FILE"
set +a

# Function to get password from Keychain
get_keychain_password() {
    local account="$1"
    local service="${2:-}"

    if [ -z "$service" ]; then
        # Try generic password
        security find-generic-password -a "$account" -w 2>/dev/null
    else
        # Try internet password
        security find-internet-password -a "$account" -s "$service" -w 2>/dev/null
    fi
}

# Function to get generic keychain item by service name
get_keychain_item() {
    local service_name="$1"
    security find-generic-password -s "$service_name" -w 2>/dev/null
}

# Try to load DATABASE_URL from Keychain if empty
if [ -z "$DATABASE_URL" ]; then
    echo "  ℹ DATABASE_URL not in .env.local, checking Keychain..."
    DATABASE_URL=$(get_keychain_item "MMR_DATABASE_URL")
    if [ -n "$DATABASE_URL" ]; then
        echo "  ✓ DATABASE_URL loaded from Keychain (MMR_DATABASE_URL)"
    else
        echo "  ⚠ Not found in Keychain"
    fi
fi

# Try to load GOOGLE_APPLICATION_CREDENTIALS from Keychain if empty
if [ -z "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
    echo "  ℹ GOOGLE_APPLICATION_CREDENTIALS not in .env.local, checking Keychain..."
    GOOGLE_CREDS=$(get_keychain_item "MMR_GOOGLE_CREDS_PATH")
    if [ -n "$GOOGLE_CREDS" ]; then
        GOOGLE_APPLICATION_CREDENTIALS="$GOOGLE_CREDS"
        echo "  ✓ GOOGLE_APPLICATION_CREDENTIALS loaded from Keychain (MMR_GOOGLE_CREDS_PATH)"
    else
        echo "  ⚠ Not found in Keychain"
    fi
fi

# Export all variables
export SPREADSHEET_ID DATABASE_URL AZURE_STORAGE_CONNECTION_STRING SMTP_USERNAME SMTP_PASSWORD SMTP_FROM_EMAIL NOTIFICATION_EMAIL GOOGLE_APPLICATION_CREDENTIALS GMAIL_TRANSACTION_SHEET_ID

echo "✅ Environment variables loaded"
echo ""
echo "Loaded variables:"
for var in SPREADSHEET_ID DATABASE_URL AZURE_STORAGE_CONNECTION_STRING SMTP_USERNAME SMTP_PASSWORD GOOGLE_APPLICATION_CREDENTIALS; do
    eval "value=\$$var"
    if [ -z "$value" ]; then
        echo "  ⚠ $var: (NOT SET)"
    else
        if [ "$var" = "AZURE_STORAGE_CONNECTION_STRING" ] || [ "$var" = "DATABASE_URL" ]; then
            char_count=${#value}
            echo "  ✓ $var: ($char_count chars)"
        else
            echo "  ✓ $var: SET"
        fi
    fi
done

# Check for missing critical variables
echo ""
echo "Validation:"
missing=0
CRITICAL_VARS=("SPREADSHEET_ID" "DATABASE_URL" "AZURE_STORAGE_CONNECTION_STRING" "GOOGLE_APPLICATION_CREDENTIALS")
for var in "${CRITICAL_VARS[@]}"; do
    eval "value=\$$var"
    if [ -z "$value" ]; then
        echo "  ✗ $var: MISSING"
        missing=1
    else
        echo "  ✓ $var: OK"
    fi
done

if [ $missing -eq 1 ]; then
    echo ""
    echo "Missing variables. To fix:"
    echo "  1. Add to .env.local, OR"
    echo "  2. Store in Keychain:"
    echo "     security add-generic-password -a keychain_item -s SERVICE -w 'VALUE'"
    return 1 2>/dev/null || exit 1
fi

echo ""
echo "✓ All critical variables loaded successfully!"
