#!/bin/bash

# Python Execution Engine Test Script
# Tests all 11 endpoints of the py-exec API
#
# Usage: ./test_py_exec.sh [BASE_URL] [TOKEN]
# Example: ./test_py_exec.sh http://localhost:5000 "eyJhbGc..."

set -e

BASE_URL="${1:-http://localhost:5000}"
TOKEN="${2:-}"

if [ -z "$TOKEN" ]; then
    echo "❌ Error: TOKEN not provided"
    echo "Usage: ./test_py_exec.sh [BASE_URL] [TOKEN]"
    exit 1
fi

HEADER_AUTH="Authorization: Bearer $TOKEN"
HEADER_JSON="Content-Type: application/json"

echo "🧪 Python Execution Engine Test Suite"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "Base URL: $BASE_URL"
echo ""

# Color codes
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

pass_count=0
fail_count=0

# Helper function to test an endpoint
test_endpoint() {
    local name=$1
    local method=$2
    local endpoint=$3
    local data=$4

    echo -n "Testing: $name ... "

    if [ "$method" = "GET" ]; then
        response=$(curl -s -X GET "$BASE_URL$endpoint" \
            -H "$HEADER_AUTH" \
            -w "\n%{http_code}")
    else
        response=$(curl -s -X POST "$BASE_URL$endpoint" \
            -H "$HEADER_AUTH" \
            -H "$HEADER_JSON" \
            -d "$data" \
            -w "\n%{http_code}")
    fi

    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n-1)

    if [ "$http_code" = "200" ] || [ "$http_code" = "500" ]; then
        status=$(echo "$body" | jq -r '.status // "unknown"' 2>/dev/null || echo "error")

        if [ "$status" = "ok" ] || [ "$status" = "healthy" ]; then
            echo -e "${GREEN}✓ PASS${NC} (HTTP $http_code, status: $status)"
            ((pass_count++))

            # Extract debug info if available
            debug_keys=$(echo "$body" | jq -r '.debug | keys[]? // empty' 2>/dev/null | wc -l)
            if [ "$debug_keys" -gt 0 ]; then
                echo "   └─ Debug info: $debug_keys keys"
            fi
        else
            error=$(echo "$body" | jq -r '.error // "Unknown error"' 2>/dev/null || echo "Unknown error")
            echo -e "${RED}✗ FAIL${NC} (HTTP $http_code, status: $status)"
            echo "   └─ Error: $error"
            ((fail_count++))
        fi
    else
        echo -e "${RED}✗ FAIL${NC} (HTTP $http_code)"
        echo "   └─ Response: ${body:0:80}..."
        ((fail_count++))
    fi
    echo ""
}

# 1. Health check
test_endpoint \
    "GET /health" \
    "GET" \
    "/api/py-exec/health" \
    ""

# 2. List functions
test_endpoint \
    "GET /list" \
    "GET" \
    "/api/py-exec/list" \
    ""

# 3. Get sheet vs db counts
test_endpoint \
    "POST /run/get_sheet_vs_db_counts" \
    "POST" \
    "/api/py-exec/run/get_sheet_vs_db_counts" \
    '{}'

# 4. Get sync status
test_endpoint \
    "POST /run/get_sync_status" \
    "POST" \
    "/api/py-exec/run/get_sync_status" \
    '{}'

# 5. Check transaction dups
test_endpoint \
    "POST /run/check_transaction_dups" \
    "POST" \
    "/api/py-exec/run/check_transaction_dups" \
    '{}'

# 6. Check transaction nulls
test_endpoint \
    "POST /run/check_transaction_nulls" \
    "POST" \
    "/api/py-exec/run/check_transaction_nulls" \
    '{}'

# 7. Get sample transactions (with limit)
test_endpoint \
    "POST /run/get_sample_transactions" \
    "POST" \
    "/api/py-exec/run/get_sample_transactions" \
    '{"kwargs": {"limit": 5}}'

# 8. Test DB connection
test_endpoint \
    "POST /run/test_db_connection" \
    "POST" \
    "/api/py-exec/run/test_db_connection" \
    '{}'

# 9. Check Azure email config
test_endpoint \
    "POST /run/check_azure_email_config" \
    "POST" \
    "/api/py-exec/run/check_azure_email_config" \
    '{}'

# 10. Send test email (commented out by default - uncomment to test)
# test_endpoint \
#     "POST /run/send_test_email" \
#     "POST" \
#     "/api/py-exec/run/send_test_email" \
#     '{}'

# 11. Execute code
test_endpoint \
    "POST /code (simple query)" \
    "POST" \
    "/api/py-exec/code" \
    '{"code": "result = query(\"SELECT 1 as test\")\nprint(f\"Query result: {result}\")"}'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "Results: ${GREEN}$pass_count passed${NC}, ${RED}$fail_count failed${NC}"

if [ $fail_count -eq 0 ]; then
    echo -e "${GREEN}✓ All tests passed!${NC}"
    exit 0
else
    echo -e "${RED}✗ Some tests failed${NC}"
    exit 1
fi
