# GitHub Workflow Audit
**Date:** 2026-03-26
**Scope:** All 11 workflows in `.github/workflows/`
**Audited by:** Claude (Cowork)

---

## Workflows Inventoried

| File | Purpose | Schedule |
|------|---------|----------|
| `azure-static-web-apps-orange-tree-0d70d110f.yml` | Azure SWA CI/CD deploy | push/PR to main |
| `sync-members-recurring.yml` | Members sync (Google Sheets → MySQL) | every 6h (00, 06, 12, 18 UTC) |
| `sync-payments-recurring.yml` | Payments sync | every 6h (01, 07, 13, 19 UTC) |
| `sync-gmail-transactions-recurring.yml` | Gmail transactions sync | every 6h (03, 09, 15, 21 UTC) |
| `sync-webapp-events-recurring.yml` | WebApp events sync | every 6h (02, 08, 14, 20 UTC) |
| `sync-all-sheets-ordered.yml` | Sequential ordered sync of all 4 sheets | every 6h (00, 06, 12, 18 UTC) + daily 00 UTC |
| `sync-sheets-to-mysql.yml` | Nightly membership sync (legacy) | daily 02 UTC |
| `sync-nyrr-recurring.yml` | NYRR daily sync (batch of 10) | daily 04 UTC |
| `sync-nyrr-weekly.yml` | NYRR full sync (no limit) | every Sunday 02 UTC |
| `update-member-status.yml` | Recalculate member Status field | daily 01 UTC |
| `db-schema-drift.yml` | Compare live DB schema to snapshot | every Monday 09 UTC |

---

## 🔴 Critical Issues

### 1. Mass schedule collision — syncs run twice on every cycle

`sync-all-sheets-ordered.yml` and the four individual recurring sync workflows cover **identical data on overlapping schedules**.

`sync-all-sheets-ordered.yml` runs at `0 0,6,12,18 * * *` — the same times as `sync-members-recurring.yml` (`0 0,6,12,18 * * *`). At every midnight/6/12/18 UTC:
- `sync-all-sheets-ordered` fires and syncs all four tables sequentially
- `sync-members-recurring` fires and syncs members again at the same moment

The payments, webapp-events, and gmail-transactions recurring workflows fire 1–3 hours later, so those tables are also synced a second time each cycle. This means **every table is synced at minimum twice per 6-hour window**.

**Recommendation:** Decide which pattern to keep — the ordered sequential orchestration (`sync-all-sheets-ordered`) or the individual per-table workflows. The ordered one is better because it has retry logic, a consolidated notification, and enforces ordering. The individual workflows can be disabled or deleted.

---

### 2. `GOOGLE_APPLICATION_CREDENTIALS` set to raw JSON instead of a file path in `sync-all-sheets-ordered.yml`

Line 19 of `sync-all-sheets-ordered.yml`:
```yaml
GOOGLE_APPLICATION_CREDENTIALS: ${{ secrets.GOOGLE_SERVICE_ACCOUNT }}
```
This sets the env var to the raw **JSON content** of the service account key, but the Google client libraries expect this variable to be a **file path**. The correct pattern (used in all individual recurring workflows) is:
```bash
echo "$GOOGLE_SERVICE_ACCOUNT" > /tmp/google-creds.json
# then set: GOOGLE_APPLICATION_CREDENTIALS=/tmp/google-creds.json
```
`sync-all-sheets-ordered.yml` never writes the JSON to a file, so Google auth likely fails silently for all 4 of its sync jobs. This could explain why the individual recurring workflows were kept running — `sync-all-sheets-ordered` may never have worked correctly.

**Fix:** Add a `Write service account credentials` step to each job in `sync-all-sheets-ordered.yml`, identical to the pattern in the individual recurring workflows.

---

### 3. Wrong spreadsheet ID for Payment-History and WebApp-Events in `sync-all-sheets-ordered.yml`

In the `sync-payments` job (line 114) and `sync-events` job (line 158):
```yaml
--spreadsheet-id "$SPREADSHEET_ID"
```
But `SPREADSHEET_ID` is defined at the top of the file as `secrets.GOOGLE_SHEETS_MEMBERSHIP_ID` (the membership spreadsheet). The correct IDs should be `$GOOGLE_SHEETS_PAYMENTS_ID` and `$GOOGLE_SHEETS_WEBAPP_EVENTS_ID` respectively — which are already defined as env vars in the same file but not used here.

Compare to the individual workflows that correctly use:
- `sync-payments-recurring.yml`: `${{ secrets.GOOGLE_SHEETS_PAYMENTS_ID }}`
- `sync-webapp-events-recurring.yml`: `${{ secrets.GOOGLE_SHEETS_WEBAPP_EVENTS_ID }}`

If payments and webapp-events live in different spreadsheets from the membership sheet, these two jobs in `sync-all-sheets-ordered` are querying the wrong spreadsheet entirely.

**Fix:**
```yaml
# sync-payments job
--spreadsheet-id "$GOOGLE_SHEETS_PAYMENTS_ID"

# sync-events job
--spreadsheet-id "$GOOGLE_SHEETS_WEBAPP_EVENTS_ID"
```

---

### 4. `sync-all-sheets-ordered.yml` notify job uses undefined variables

The final `notify` job references `${{ env.SMTP_USERNAME }}` and `${{ env.SMTP_PASSWORD }}`, but those names are not defined anywhere in the file. The workflow-level `env:` block defines `MAIL_USERNAME`, `MAIL_PASSWORD`, and `NOTIFICATION_EMAIL`. As a result, the email notification always sends with blank SMTP credentials and will silently fail or error.

**Fix:** Change the notify job to use `${{ env.MAIL_USERNAME }}` and `${{ env.MAIL_PASSWORD }}` (or switch to `${{ secrets.MAIL_USERNAME }}` etc. to be consistent with other workflows).

---

### 5. Duplicate cron entries in `sync-all-sheets-ordered.yml`

```yaml
schedule:
  - cron: '0 0 * * *'         # daily at midnight
  - cron: '0 0,6,12,18 * * *' # every 6h, which already includes midnight
```
The first entry (midnight daily) is a subset of the second (every 6h). GitHub will deduplicate the actual run, but this is confusing and could cause issues if the behavior changes. The `0 0 * * *` line should be removed — it's redundant.

---

## 🟠 Major Issues

### 6. `sync-sheets-to-mysql.yml` is a legacy workflow that conflicts with newer syncs

This workflow:
- Syncs `"Membership Master"` sheet using `--key-field "Email"`, but the current `sync-members-recurring.yml` syncs `"Main"` sheet with `--key-field "MemberID"`. These may be different sheets or the same sheet renamed — if the same data, this is double syncing to potentially different table rows.
- Uses `actions/checkout@v3` (the only workflow not on v4)
- Has no `timeout-minutes`
- The `Notify on failure` step uses `context.issue.number` — this will throw a runtime error on scheduled triggers because there is no associated issue or pull request. The step will fail, compounding the error.
- The `monitor` job does nothing useful — it just echoes `date` without querying the DB
- Runs at 2 AM UTC, which is one hour after `update-member-status.yml` (01 UTC) expects all syncs to be complete

**Recommendation:** This looks like the original workflow that was superseded by the newer, more complete sync infrastructure. It should be **disabled or deleted** once you confirm `sync-all-sheets-ordered.yml` (after the bugs above are fixed) handles all required data.

---

### 7. `github.event.head_commit.timestamp` is always empty on scheduled runs

Every failure notification email body across all recurring workflows includes:
```yaml
Time: ${{ github.event.head_commit.timestamp }}
```
On scheduled runs, `github.event.head_commit` does not exist — this will always render as an empty string. Use `github.event.repository.updated_at` or just embed a shell date inline.

**Fix (simple):**
```yaml
Time: ${{ github.event.repository.updated_at }}
```
Or in the run step, set an output: `echo "ts=$(date -u)" >> $GITHUB_OUTPUT` and reference it in the notification.

---

### 8. `update-member-status.yml` timing dependency is fragile

The workflow comment says it runs "after sync-all-sheets-ordered (00:00 UTC)" but the dependency is only enforced by timing (runs at 01 UTC). If the ordered sync takes more than an hour (or fails partway through), the status update runs against stale data with no warning.

**Recommendation:** Replace the time-based dependency with a `workflow_run` trigger:
```yaml
on:
  workflow_run:
    workflows: ["Sync All Sheets (Ordered Sequential)"]
    types: [completed]
  workflow_dispatch:
    ...
```
This guarantees `update-member-status` only fires after the sheet sync completes, regardless of how long it takes.

---

### 9. `sync-payments-recurring.yml` missing `--table` argument

The `Run Payments sync` step does not pass `--table`:
```bash
python basecamp/ops/sync_sheets_to_mysql.py \
  --sheet "Payment-History" \
  --spreadsheet-id "..." \
  --sheet-range "Payment-History!A:Z" \
  --key-field "PaymentID"
  # ← no --table argument
```
All other syncs pass `--table` explicitly (`members`, `webapp_events`, `gmail_transactions`). If the script has no fallback default for `--table`, this will error; if it does default, the target table may be wrong. Compare to `sync-all-sheets-ordered.yml` which correctly passes `--table "payments"`.

---

## 🟡 Minor Issues / Improvements

### 10. pip dependencies reinstalled from scratch on every run (no caching)

All 9 Python workflows install `pip` dependencies with no caching. On `setup-python@v4`, pip caching is a single line:
```yaml
- uses: actions/setup-python@v4
  with:
    python-version: '3.11'
    cache: 'pip'
    cache-dependency-path: 'basecamp/requirements.txt'
```
This would reduce each workflow's setup time by 20–40 seconds and lower CI costs.

---

### 11. `azure-static-web-apps` workflow uses `actions/checkout@v3`

All other workflows use `checkout@v4`. Minor inconsistency — `@v4` supports better sparse checkout performance and is the current recommended version.

---

### 12. `NEXTAUTH_URL` hardcoded in Azure SWA workflow

```yaml
NEXTAUTH_URL: https://orange-tree-0d70d110f.4.azurestaticapps.net
```
This is hardcoded rather than stored as a secret. While not a credential, it couples the workflow to a specific deployment URL. Consider moving to `secrets.NEXTAUTH_URL` so the workflow is portable if the deployment slot changes.

---

### 13. Action versions not pinned to SHA

All workflows use floating version tags (`@v3`, `@v4`) for actions rather than pinned SHAs. For a small internal project this is an acceptable tradeoff, but if security posture is a concern, pinning to a commit SHA (e.g. `actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683`) prevents tag-mutable supply chain attacks.

---

## Summary Table

| # | Severity | File | Issue |
|---|----------|------|-------|
| 1 | 🔴 Critical | multiple | All 4 sheet tables synced twice per cycle due to overlapping schedules |
| 2 | 🔴 Critical | `sync-all-sheets-ordered.yml` | `GOOGLE_APPLICATION_CREDENTIALS` set to JSON content, not a file path — auth likely fails |
| 3 | 🔴 Critical | `sync-all-sheets-ordered.yml` | Payments and WebApp-Events jobs use wrong spreadsheet ID (`SPREADSHEET_ID` instead of dedicated IDs) |
| 4 | 🔴 Critical | `sync-all-sheets-ordered.yml` | Notify job uses `SMTP_USERNAME`/`SMTP_PASSWORD` which are undefined — email always fails |
| 5 | 🔴 Critical | `sync-all-sheets-ordered.yml` | Redundant duplicate cron entry at midnight |
| 6 | 🟠 Major | `sync-sheets-to-mysql.yml` | Legacy workflow, likely superseded; `context.issue.number` will error on schedule |
| 7 | 🟠 Major | all recurring syncs | `head_commit.timestamp` always empty on scheduled runs |
| 8 | 🟠 Major | `update-member-status.yml` | Timing-based dependency on sheet sync — fragile, use `workflow_run` instead |
| 9 | 🟠 Major | `sync-payments-recurring.yml` | Missing `--table` argument |
| 10 | 🟡 Minor | all Python workflows | No pip caching — unnecessary install time on every run |
| 11 | 🟡 Minor | `azure-static-web-apps-*.yml` | Still on `checkout@v3` |
| 12 | 🟡 Minor | `azure-static-web-apps-*.yml` | `NEXTAUTH_URL` hardcoded, not a secret |
| 13 | 🟡 Minor | all workflows | Action versions not SHA-pinned |

---

## Recommended Fix Priority

1. **Fix `sync-all-sheets-ordered.yml`** (issues 2, 3, 4, 5) — this workflow is the intended canonical orchestrator but is broken in at least 3 ways.
2. **Disable/delete redundant individual recurring workflows** (issue 1) once `sync-all-sheets-ordered` is confirmed working.
3. **Retire `sync-sheets-to-mysql.yml`** (issue 6) — appears to be a legacy predecessor.
4. **Fix `--table` arg in `sync-payments-recurring.yml`** (issue 9) — in case that workflow is kept in the interim.
5. **Replace timing dependency with `workflow_run` in `update-member-status.yml`** (issue 8).
6. **Add pip caching** across all Python workflows (issue 10) — quick win.
7. **Fix `head_commit.timestamp`** in email notifications (issue 7).
