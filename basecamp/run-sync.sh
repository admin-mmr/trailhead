#!/bin/bash

# Wrapper script to run sync_sheets_to_mysql.py with environment variables
# Usage: ./run-sync.sh SHEET_NAME TABLE_NAME [--dry-run] [--verbose]
#
# Examples:
#   ./run-sync.sh Main members --dry-run
#   ./run-sync.sh Main members
#   ./run-sync.sh "Payment-History" payments --dry-run

set -e

SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"
cd "$SCRIPT_DIR"

# Load environment
echo "Loading environment variables..."
source load-env.sh
echo ""

# Parse arguments
SHEET_NAME="${1:-}"
TABLE_NAME="${2:-}"
DRY_RUN=""
VERBOSE=""

# Check if --dry-run is passed
if [[ "$3" == "--dry-run" ]] || [[ "$4" == "--dry-run" ]]; then
    DRY_RUN="--dry-run"
fi

if [[ "$3" == "--verbose" ]] || [[ "$4" == "--verbose" ]]; then
    VERBOSE="--verbose"
fi

# Validate arguments
if [ -z "$SHEET_NAME" ] || [ -z "$TABLE_NAME" ]; then
    echo "Usage: $0 SHEET_NAME TABLE_NAME [--dry-run]"
    echo ""
    echo "Examples:"
    echo "  $0 Main members --dry-run"
    echo "  $0 'Payment-History' payments"
    echo "  $0 WebApp-Events payment_events --dry-run"
    echo "  $0 Active gmail_transactions --dry-run"
    exit 1
fi

# Determine which spreadsheet to use
SYNC_SPREADSHEET_ID=""
if [ "$SHEET_NAME" = "Active" ]; then
    # Active sheet is in the Gmail Transactions spreadsheet
    SYNC_SPREADSHEET_ID="$GMAIL_TRANSACTION_SHEET_ID"
    if [ -z "$SYNC_SPREADSHEET_ID" ]; then
        echo "✗ Error: GMAIL_TRANSACTION_SHEET_ID not set in environment"
        exit 1
    fi
else
    # All other sheets are in the main spreadsheet
    SYNC_SPREADSHEET_ID="$SPREADSHEET_ID"
    if [ -z "$SYNC_SPREADSHEET_ID" ]; then
        echo "✗ Error: SPREADSHEET_ID not set in environment"
        exit 1
    fi
fi

# Determine key field based on table name
KEY_FIELD="Email"  # Default
case "$TABLE_NAME" in
    gmail_transactions)
        KEY_FIELD="TransactionID"
        ;;
    payments)
        KEY_FIELD="PaymentID"
        ;;
    payment_events)
        KEY_FIELD="EventID"
        ;;
    events)
        KEY_FIELD="EventID"
        ;;
    *)
        KEY_FIELD="Email"
        ;;
esac

echo "Running sync: $SHEET_NAME → $TABLE_NAME"
echo "  Sheet: $SHEET_NAME"
echo "  Table: $TABLE_NAME"
echo "  Key Field: $KEY_FIELD"
echo "  Spreadsheet ID: ${SYNC_SPREADSHEET_ID:0:20}..."
if [ -n "$DRY_RUN" ]; then
    echo "  Mode: DRY RUN (no data will be written)"
fi
echo ""

# Run the sync script
python3 ops/sync_sheets_to_mysql.py \
    --sheet "$SHEET_NAME" \
    --table "$TABLE_NAME" \
    --key-field "$KEY_FIELD" \
    --spreadsheet-id "$SYNC_SPREADSHEET_ID" \
    $DRY_RUN

exit $?
