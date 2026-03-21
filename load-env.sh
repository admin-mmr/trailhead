#!/bin/bash
# Load environment variables from .env.local and macOS Keychain

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/basecamp/.env.local"

# Load from .env.local
if [ -f "$ENV_FILE" ]; then
    export $(grep -v '^#' "$ENV_FILE" | xargs)
    echo "✓ Loaded from .env.local"
fi

# Load from macOS Keychain
echo "✓ Loading from macOS Keychain..."

GOOGLE_CREDS_PATH=$(security find-generic-password -a "$USER" -s "MMR_GOOGLE_CREDS_PATH" -w)
export GOOGLE_APPLICATION_CREDENTIALS="$GOOGLE_CREDS_PATH"
echo "  ✓ GOOGLE_APPLICATION_CREDENTIALS set"

DATABASE_URL=$(security find-generic-password -a "$USER" -s "MMR_DATABASE_URL" -w)
export DATABASE_URL
echo "  ✓ DATABASE_URL set"

echo "✅ All environment variables loaded!"