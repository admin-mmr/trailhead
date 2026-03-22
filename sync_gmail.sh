#!/bin/bash
set -e
cd "$(dirname "$0")"
source load-env.sh
echo ""
echo "======================================================================"
echo "    SYNCING GMAIL TRANSACTIONS FROM 'Active' SHEET"
echo "======================================================================"
echo ""
echo "Dry-run: Check what would be synced..."
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Active" \
  --spreadsheet-id "$GMAIL_TRANSACTION_SHEET_ID" \
  --dry-run
