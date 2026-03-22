#!/bin/bash
set -e
cd "$(dirname "$0")"
source load-env.sh
echo ""
echo "======================================================================"
echo "    SYNCING WEBAPP EVENTS"
echo "======================================================================"
echo ""
echo "Dry-run: Check what would be synced..."
python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "WebApp-Events" \
  --spreadsheet-id "$SPREADSHEET_ID" \
  --dry-run
