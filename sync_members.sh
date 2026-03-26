#!/bin/bash
set -e
cd "$(dirname "$0")"
source load-env.sh
echo ""
echo "======================================================================"
echo "    SYNCING MEMBERS DATA"
echo "======================================================================"
echo ""

if [ "$1" = "--live" ]; then
  echo "LIVE SYNC: Writing changes to MySQL..."
  python3 basecamp/ops/sync_sheets_to_mysql.py \
    --sheet "Main" \
    --table members \
    --key-field MemberID \
    --spreadsheet-id "$SPREADSHEET_ID"
else
  echo "Dry-run: Check what would be synced..."
  python3 basecamp/ops/sync_sheets_to_mysql.py \
    --sheet "Main" \
    --table members \
    --key-field MemberID \
    --spreadsheet-id "$SPREADSHEET_ID" \
    --dry-run
  echo ""
  echo "This was a dry run. To sync for real, run:"
  echo "  bash sync_members.sh --live"
fi
