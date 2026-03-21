#!/bin/bash

###############################################################################
# First-Time Google Sheets → MySQL Member Sync
#
# Usage:
#   ./sync-members.sh --dry-run   # Test without writing to MySQL
#   ./sync-members.sh             # Run actual sync
#   ./sync-members.sh --verify    # Check setup and connection
#
# See: NEXT_SESSION.md and SYNC_SETUP.md for details
###############################################################################

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASECAMP_DIR="$SCRIPT_DIR/basecamp"
ENV_FILE="$BASECAMP_DIR/.env.local"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

###############################################################################
# Helper Functions
###############################################################################

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[✓]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[⚠]${NC} $1"
}

log_error() {
    echo -e "${RED}[✗]${NC} $1"
}

###############################################################################
# Verify Environment Setup
###############################################################################

verify_setup() {
    log_info "Verifying setup..."

    # Check .env.local exists
    if [ ! -f "$ENV_FILE" ]; then
        log_error ".env.local not found at $ENV_FILE"
        echo "Create it with required vars: GOOGLE_APPLICATION_CREDENTIALS, AZURE_STORAGE_CONNECTION_STRING, DATABASE_URL, SPREADSHEET_ID"
        exit 1
    fi
    log_success ".env.local found"

    # Load environment
    export $(grep -v '^#' "$ENV_FILE" | xargs)

    # Check required vars
    required_vars=("GOOGLE_APPLICATION_CREDENTIALS" "AZURE_STORAGE_CONNECTION_STRING" "DATABASE_URL" "SPREADSHEET_ID")
    for var in "${required_vars[@]}"; do
        if [ -z "${!var}" ]; then
            log_error "Missing environment variable: $var"
            exit 1
        fi
    done
    log_success "All required environment variables set"

    # Check Google credentials file exists
    if [ ! -f "$GOOGLE_APPLICATION_CREDENTIALS" ]; then
        log_error "Google credentials file not found: $GOOGLE_APPLICATION_CREDENTIALS"
        exit 1
    fi
    log_success "Google credentials file exists"

    # Check Python packages
    log_info "Checking Python packages..."
    python3 -c "import mysql.connector, azure.storage.blob, google.cloud.drive_v3" 2>/dev/null || {
        log_warning "Missing Python packages. Install with:"
        echo "  pip install -r $BASECAMP_DIR/requirements.txt"
        exit 1
    }
    log_success "Python packages available"
}

###############################################################################
# Test Connections
###############################################################################

test_mysql() {
    log_info "Testing MySQL connection..."

    # Parse DATABASE_URL to extract components
    # Format: mysql://user:pass@host:port/dbname?ssl=true

    python3 << 'EOF'
import os
from urllib.parse import urlparse

db_url = os.environ.get('DATABASE_URL')
parsed = urlparse(db_url)

import mysql.connector
try:
    conn = mysql.connector.connect(
        host=parsed.hostname,
        user=parsed.username,
        password=parsed.password,
        database=parsed.path.lstrip('/').split('?')[0],
        ssl_disabled=False
    )
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM members")
    count = cursor.fetchone()[0]
    print(f"MySQL connected. Members in DB: {count}")
    cursor.close()
    conn.close()
except Exception as e:
    print(f"MySQL connection failed: {e}")
    exit(1)
EOF

    if [ $? -eq 0 ]; then
        log_success "MySQL connection successful"
    else
        log_error "MySQL connection failed"
        exit 1
    fi
}

test_azure() {
    log_info "Testing Azure Blob Storage..."

    python3 << 'EOF'
import os
from azure.storage.blob import BlobServiceClient

try:
    conn_str = os.environ.get('AZURE_STORAGE_CONNECTION_STRING')
    client = BlobServiceClient.from_connection_string(conn_str)
    print("Azure Blob Storage connected")
except Exception as e:
    print(f"Azure Blob Storage failed: {e}")
    exit(1)
EOF

    if [ $? -eq 0 ]; then
        log_success "Azure Blob Storage connection successful"
    else
        log_error "Azure Blob Storage connection failed"
        exit 1
    fi
}

test_google() {
    log_info "Testing Google API access..."

    python3 << 'EOF'
import os
import json

creds_file = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
try:
    with open(creds_file) as f:
        creds = json.load(f)
    email = creds.get('client_email', 'unknown')
    project = creds.get('project_id', 'unknown')
    print(f"Google Service Account: {email}")
    print(f"Project ID: {project}")
except Exception as e:
    print(f"Google credentials check failed: {e}")
    exit(1)
EOF

    if [ $? -eq 0 ]; then
        log_success "Google credentials verified"
    else
        log_error "Google credentials verification failed"
        exit 1
    fi
}

###############################################################################
# Run Sync
###############################################################################

run_sync() {
    local dry_run=$1

    log_info "Starting sync..."

    if [ "$dry_run" = "true" ]; then
        log_warning "DRY-RUN MODE: No MySQL writes will occur"
        python3 "$BASECAMP_DIR/ops/sync_sheets_to_mysql.py" --dry-run
    else
        log_warning "EXECUTING REAL SYNC: This will write to MySQL"
        echo "Press Enter to continue, or Ctrl+C to cancel..."
        read
        python3 "$BASECAMP_DIR/ops/sync_sheets_to_mysql.py"
    fi

    if [ $? -eq 0 ]; then
        log_success "Sync completed successfully"
    else
        log_error "Sync failed"
        exit 1
    fi
}

###############################################################################
# Verify Results
###############################################################################

verify_results() {
    log_info "Verifying sync results..."

    python3 << 'EOF'
import os
from urllib.parse import urlparse
import mysql.connector

db_url = os.environ.get('DATABASE_URL')
parsed = urlparse(db_url)

conn = mysql.connector.connect(
    host=parsed.hostname,
    user=parsed.username,
    password=parsed.password,
    database=parsed.path.lstrip('/').split('?')[0],
    ssl_disabled=False
)

cursor = conn.cursor()

# Check member count
cursor.execute("SELECT COUNT(*) FROM members")
count = cursor.fetchone()[0]
print(f"\n✓ Total members in MySQL: {count}")

if count > 0:
    # Sample a member
    cursor.execute("""
        SELECT member_id, email, first_name, last_name, nyrr_runner_name, year_born
        FROM members
        LIMIT 1
    """)
    row = cursor.fetchone()
    if row:
        print(f"\n✓ Sample member:")
        print(f"  Member ID: {row[0]}")
        print(f"  Email: {row[1]}")
        print(f"  Name: {row[2]} {row[3]}")
        print(f"  NYRR Runner Name: {row[4]}")
        print(f"  Year Born: {row[5]}")
else:
    print("\n⚠ No members found in MySQL")

cursor.close()
conn.close()
EOF
}

###############################################################################
# Main
###############################################################################

main() {
    local action="sync"

    if [ "$1" = "--dry-run" ]; then
        action="dry-run"
    elif [ "$1" = "--verify" ]; then
        action="verify"
    elif [ "$1" = "-h" ] || [ "$1" = "--help" ]; then
        cat << 'HELP'
Usage: ./sync-members.sh [OPTION]

Options:
  --dry-run     Test sync without writing to MySQL
  --verify      Check setup and connections only
  -h, --help    Show this help message

Examples:
  ./sync-members.sh --verify     # Check everything is set up
  ./sync-members.sh --dry-run    # Test the sync
  ./sync-members.sh              # Run actual sync

See NEXT_SESSION.md and SYNC_SETUP.md for more info.
HELP
        exit 0
    fi

    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}Google Sheets → MySQL Member Sync${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}\n"

    # Always verify setup first
    verify_setup
    echo ""

    case "$action" in
        verify)
            log_info "Testing all connections..."
            test_mysql
            test_azure
            test_google
            echo ""
            log_success "All systems ready for sync!"
            ;;
        dry-run)
            test_mysql
            test_azure
            test_google
            echo ""
            run_sync true
            echo ""
            verify_results
            ;;
        sync)
            test_mysql
            test_azure
            test_google
            echo ""
            run_sync false
            echo ""
            verify_results
            ;;
    esac

    echo ""
    log_success "Done!"
}

main "$@"
