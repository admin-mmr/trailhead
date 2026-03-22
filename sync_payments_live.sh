#!/bin/bash
set -e

cd "$(dirname "$0")"
source load-env.sh

# Extract password from DATABASE_URL
# Format: mysql://user:password@host:port/database?ssl=true
export MYSQL_PASSWORD=$(echo "$DATABASE_URL" | sed 's/.*:\/\/[^:]*:\([^@]*\)@.*/\1/')

if [ -z "$MYSQL_PASSWORD" ]; then
    echo "Error: Could not extract MYSQL_PASSWORD from DATABASE_URL"
    exit 1
fi

echo ""
echo "======================================================================"
echo "    SYNCING PAYMENTS TO MYSQL"
echo "======================================================================"
echo ""

python3 basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Payment-History" \
  --spreadsheet-id "$SPREADSHEET_ID"

echo ""
echo "======================================================================"
echo "    SYNC COMPLETE"
echo "======================================================================"
echo ""
