#!/bin/bash
# Test script for GAS email pipeline diagnostic functions
# Usage: ./test_email_diags.sh <api_base_url> <auth_token>

API_URL="${1:-http://localhost:5000}"
TOKEN="${2:-}"

if [ -z "$TOKEN" ]; then
    echo "❌ Usage: ./test_email_diags.sh <api_url> <auth_token>"
    echo "Example: ./test_email_diags.sh http://localhost:5000 your-token"
    exit 1
fi

echo "🔍 Testing GAS Email Pipeline Diagnostics"
echo "API URL: $API_URL"
echo "---"

# Function to call diagnostic endpoint
call_diag() {
    local func_name=$1
    local desc=$2
    echo ""
    echo "▶️  $desc ($func_name)"
    curl -s -X GET "$API_URL/api/py-exec/run/$func_name" \
        -H "Authorization: Bearer $TOKEN" \
        -H "Content-Type: application/json" | python3 -m json.tool | head -50
    echo ""
}

# Run diagnostics
echo "1️⃣  PIPELINE HEALTH CHECK"
call_diag "analyze_email_flow" "Full pipeline analysis"

echo ""
echo "2️⃣  WEBHOOK CONFIGURATION"
call_diag "get_gas_webhook_config" "Verify GAS webhook URL is configured"

echo ""
echo "3️⃣  GMAIL TRANSACTION RECORDS"
call_diag "get_gmail_transactions_recent" "Recent emails received from Gmail"

echo ""
echo "4️⃣  EMAIL SEND STATUS"
call_diag "get_email_send_status" "Activity log + email config records"

echo ""
echo "5️⃣  SEND TEST EMAIL"
echo "▶️  Send a test email to admin@mmrunners.org"
curl -s -X GET "$API_URL/api/py-exec/run/send_test_email" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" | python3 -m json.tool | head -80

echo ""
echo "✅ Diagnostic test complete!"
echo ""
echo "📋 For detailed info, see: GAS_EMAIL_DIAGNOSTICS.md"
