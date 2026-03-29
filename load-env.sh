#!/bin/bash
# Load environment variables from .env.local and macOS Keychain

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/basecamp/.env.local"

# Load from .env.local
if [ -f "$ENV_FILE" ]; then
    set -a  # Mark all new variables for export
    source "$ENV_FILE"
    set +a  # Turn off export flag
    echo "✓ Loaded from .env.local"
else
    echo "⚠️  WARNING: .env.local not found at $ENV_FILE"
fi

# Load from macOS Keychain
echo "✓ Loading from macOS Keychain..."

GOOGLE_CREDS_PATH=$(security find-generic-password -a "$USER" -s "MMR_GOOGLE_CREDS_PATH" -w)
export GOOGLE_APPLICATION_CREDENTIALS="$GOOGLE_CREDS_PATH"
echo "  ✓ GOOGLE_APPLICATION_CREDENTIALS set"

DATABASE_URL=$(security find-generic-password -a "$USER" -s "MMR_DATABASE_URL" -w)
export DATABASE_URL
echo "  ✓ DATABASE_URL set"

GOOGLE_SHEETS_MEMBERSHIP_ID=$(security find-generic-password -a "$USER" -s "MMR_GOOGLE_SHEETS_MEMBERSHIP_ID" -w 2>/dev/null || echo "")
if [ -n "$GOOGLE_SHEETS_MEMBERSHIP_ID" ]; then
    export GOOGLE_SHEETS_MEMBERSHIP_ID
    echo "  ✓ GOOGLE_SHEETS_MEMBERSHIP_ID set"
else
    echo "  ⚠️  GOOGLE_SHEETS_MEMBERSHIP_ID not set (Sheets sync will not work)"
fi

GITHUB_TOKEN=$(security find-generic-password -a "$USER" -s "MMR_GITHUB_TOKEN" -w 2>/dev/null || echo "")
if [ -n "$GITHUB_TOKEN" ]; then
    export GITHUB_TOKEN
    echo "  ✓ GITHUB_TOKEN set"
else
    echo "  ⚠️  GITHUB_TOKEN not set (GitHub workflow triggers will not work)"
fi

echo "✅ All environment variables loaded!"