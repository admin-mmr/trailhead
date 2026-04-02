# Convert GitHub Actions Workflows to GAS Webhook

## Overview
Replace SMTP-based `dawidd6/action-send-mail` with GAS webhook calls via `curl`.

## Files to Update
- `.github/workflows/auto-guess-payments.yml`
- `.github/workflows/bidirectional-sync.yml`
- `.github/workflows/db-schema-drift.yml`
- `.github/workflows/update-member-status.yml`

---

## Conversion Template

### BEFORE (SMTP):
```yaml
- name: Send notification
  if: failure()
  uses: dawidd6/action-send-mail@v3
  with:
    server_address: ${{ secrets.MAIL_SERVER }}
    server_port: ${{ secrets.MAIL_PORT }}
    username: ${{ secrets.MAIL_USERNAME }}
    password: ${{ secrets.MAIL_PASSWORD }}
    subject: "❌ Job Failed"
    to: ${{ secrets.NOTIFICATION_EMAIL }}
    cc: 'admin@mmrunners.org'
    from: 'GitHub Actions <noreply@github.com>'
    body: |
      Details here
```

### AFTER (GAS Webhook):
```yaml
- name: Send notification (GAS webhook)
  if: failure()
  env:
    GAS_WEBHOOK_URL: ${{ secrets.GAS_WEBHOOK_URL }}
  run: |
    curl -X POST "$GAS_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d '{
        "action": "email_send",
        "to": "${{ secrets.NOTIFICATION_EMAIL }}",
        "subject": "❌ Job Failed",
        "html_content": "<h2>Job Failed</h2><p>Details here</p><p><a href=\"${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}\">View Run</a></p>",
        "cc": "admin@mmrunners.org",
        "email_type": "github_action_failure"
      }'
  continue-on-error: true
```

---

## Environment Variables to Remove

From `env:` section, **remove**:
```yaml
MAIL_SERVER: ${{ secrets.MAIL_SERVER }}
MAIL_PORT: ${{ secrets.MAIL_PORT }}
MAIL_USERNAME: ${{ secrets.MAIL_USERNAME }}
MAIL_PASSWORD: ${{ secrets.MAIL_PASSWORD }}
```

These SMTP secrets are no longer needed.

---

## Key Points

1. **Replace `uses:`** with **`run:`** and `curl` command
2. **HTML formatting** — convert plain text to `html_content` with `<h2>`, `<p>` tags
3. **Add GitHub context** — include run links and commit info in the HTML
4. **email_type** — use descriptive types like:
   - `github_action_success`
   - `github_action_failure`
   - `github_action_batch_notification`
5. **No SMTP secrets needed** — GAS_WEBHOOK_URL only

---

## Example Conversions by Workflow

### auto-guess-payments.yml
```yaml
- name: Send notification (GAS webhook)
  if: steps.mode.outputs.dry_run != 'true'
  env:
    GAS_WEBHOOK_URL: ${{ secrets.GAS_WEBHOOK_URL }}
  run: |
    STATUS="${{ steps.autoguess.outputs.exit_code == '0' && '✅ Success' || '⚠️ Errors' }}"
    curl -X POST "$GAS_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d "{
        \"action\": \"email_send\",
        \"to\": \"${{ secrets.NOTIFICATION_EMAIL }}\",
        \"subject\": \"🤖 Auto-Guess Payment Matching — $STATUS\",
        \"html_content\": \"<h2>Auto-Guess Payment Matching</h2><p>Trigger: ${{ github.event_name }}</p><p>Status: $STATUS</p><p><a href='${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}'>View Run</a></p>\",
        \"cc\": \"admin@mmrunners.org\",
        \"email_type\": \"github_action_payment_matching\"
      }"
  continue-on-error: true
```

### db-schema-drift.yml
```yaml
- name: Send drift notification (GAS webhook)
  if: failure()
  env:
    GAS_WEBHOOK_URL: ${{ secrets.GAS_WEBHOOK_URL }}
  run: |
    curl -X POST "$GAS_WEBHOOK_URL" \
      -H "Content-Type: application/json" \
      -d '{
        "action": "email_send",
        "to": "${{ secrets.NOTIFICATION_EMAIL }}",
        "subject": "⚠️ Database Schema Drift Detected",
        "html_content": "<h2>Schema Drift Warning</h2><p>The current database schema does not match the canonical schema.</p><p>See logs: <a href=\"${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}\">GitHub Actions Run</a></p><p>Please investigate and sync the snapshot.</p>",
        "cc": "admin@mmrunners.org",
        "email_type": "github_action_schema_drift"
      }'
  continue-on-error: true
```

---

## Testing

1. Manually trigger a workflow:
   ```bash
   gh workflow run auto-guess-payments.yml --ref main
   ```

2. Check the GAS webhook logs for received emails

3. Verify the member receives the notification

4. Once confirmed, delete the SMTP secrets from GitHub

---

## Cleanup

After all workflows are updated and tested:

1. Delete these GitHub Secrets:
   - `MAIL_SERVER`
   - `MAIL_PORT`
   - `MAIL_USERNAME`
   - `MAIL_PASSWORD`

2. Keep only:
   - `GAS_WEBHOOK_URL` ✅

---

*Last updated: 2026-04-02*
