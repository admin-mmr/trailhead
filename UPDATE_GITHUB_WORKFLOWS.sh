#!/bin/bash
# Convert GitHub Actions workflows from SMTP to GAS webhook
# Usage: bash UPDATE_GITHUB_WORKFLOWS.sh

set -e

echo "🔄 Converting GitHub Actions workflows to use GAS webhook..."

WORKFLOWS=(
  ".github/workflows/auto-guess-payments.yml"
  ".github/workflows/bidirectional-sync.yml"
  ".github/workflows/db-schema-drift.yml"
  ".github/workflows/update-member-status.yml"
)

for workflow in "${WORKFLOWS[@]}"; do
  if [ ! -f "$workflow" ]; then
    echo "⚠️  Skipping $workflow (not found)"
    continue
  fi

  echo ""
  echo "📝 Processing: $workflow"

  # Backup original
  cp "$workflow" "$workflow.backup"
  echo "   ✓ Backup created: $workflow.backup"

  # Convert dawidd6/action-send-mail blocks to curl GAS webhook calls
  # This is a template — you may need to manually adjust email_type and body
  sed -i.bak2 \
    -e 's/uses: dawidd6\/action-send-mail@v3/run: |/' \
    "$workflow"

  echo "   ✓ Conversion template applied"
  echo "   ⚠️  MANUAL STEP: Edit $workflow to:"
  echo "      1. Remove old SMTP secret references (MAIL_SERVER, MAIL_PORT, etc.)"
  echo "      2. Update curl command with GAS_WEBHOOK_URL secret"
  echo "      3. Adjust email_type to match your notification type"
  echo ""
done

echo "✅ Conversion template applied to all workflows"
echo ""
echo "📋 Next steps:"
echo "   1. Review each workflow backup (.backup files)"
echo "   2. Manually update curl commands in each workflow"
echo "   3. Test with a manual run of each workflow"
echo "   4. Delete .backup files when confirmed working"
echo ""
echo "Example curl format:"
echo '  curl -X POST "${{ secrets.GAS_WEBHOOK_URL }}" \'
echo '    -H "Content-Type: application/json" \'
echo '    -d '"'"'{
echo '      "action": "email_send",
echo '      "to": "${{ secrets.NOTIFICATION_EMAIL }}",
echo '      "subject": "Workflow Notification",
echo '      "html_content": "<h2>Details</h2>",
echo '      "cc": "admin@mmrunners.org",
echo '      "email_type": "github_action_xxx"
echo '    }'"'"''
