#!/bin/bash

# Wrapper to verify Google Sheets structure
# Loads environment from load-env.sh (which handles Keychain)
# Then runs the Python verification script

SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"
cd "$SCRIPT_DIR"

# Load environment (including from Keychain)
echo "Loading environment variables..."
source load-env.sh
echo ""

# Run the verification script
python3 ops/verify_sheets_structure.py
