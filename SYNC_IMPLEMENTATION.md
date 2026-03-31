# MMR Admin Sync Tab Implementation

**Status:** Framework complete, placeholder logic ready for integration

---

## What's Built

### 1. Backend: `api_sheets_sync.py` (410 lines)

Five new REST endpoints for syncing data between MySQL and Google Sheets:

- **POST `/api/sync/mysql-to-google/members`** — Sync members table
- **POST `/api/sync/mysql-to-google/events`** — Sync webapp_events table
- **POST `/api/sync/mysql-to-google/payments`** — Sync payments table (last 500 rows)
- **POST `/api/sync/import-transactions`** — Import gmail_transactions from Google Sheets
- **POST `/api/sync/dry-run`** — Google→MySQL comparison (display diffs, no changes)
- **GET `/api/sync/status/<job_id>`** — Poll job status

**Features:**
- Async job processing (daemon threads, returns immediately with `job_id`)
- Real-time status updates (status, message, progress %)
- Detailed sync logs (operations performed, inserted/updated counts)
- Email reports sent to `admin@mmrunners.org` after completion
- Error handling and detailed error logging

### 2. Frontend: `SyncPanel` component in `index.html`

Three-tab interface accessible via **Sync** tab (admin-only):

#### Tab 1: MySQL → Google
- Three buttons: Sync Members, Sync Events, Sync Payments
- Displays real-time job progress (status badge, progress bar, logs)
- Shows last 5 sync jobs with collapsible logs

#### Tab 2: Import Transactions
- Single button: Import Now
- Fetches gmail_transactions from Google Sheets
- Shows job status and recent imports

#### Tab 3: Google → MySQL (Dry Run)
- Single button: Start Dry-Run
- Compares Sheets ↔ MySQL
- **No changes made** — for review only
- Shows differences detected

### 3. Bug Fixes in `payment_actions.py`

**Corrected 3 locations where gmail_transactions was incorrectly updated:**

| Line | Old (Wrong) | New (Correct) |
|------|-----------|---------------|
| 201 | `Source = 'AutoMatch'` | `Notes = 'AutoMatch'` |
| 406 | `Source = 'Manual'` | `Notes = 'Manual'` |
| 500 | `Source = 'Admin-Created'` | `Notes = 'Admin-Created'` |

---

## Implementation Status by Feature

### ✅ Completed

- [x] REST API endpoints (all 6 endpoints wired, async job handling)
- [x] SyncPanel UI with 3 subtabs and real-time polling
- [x] Blueprint registration in `app.py`
- [x] Job status tracking with progress bars
- [x] Email report sending infrastructure
- [x] gmail_transactions bug fixes (Source→Notes)
- [x] Placeholder sync logic with detailed comments

### ⏳ Next Steps (GAS Integration)

The following functions have **placeholder logic** and are ready for GAS webhook integration:

1. **`_sync_members_to_sheets()`** — needs GAS call to:
   - Get all members from Google Sheets (keyed by MemberID)
   - For new MemberID: append to Sheets
   - For existing: check `LastUpdated` (column P) in Sheets vs MySQL
     - If MySQL newer: copy all fields to Sheets
     - Else: skip

2. **`_sync_events_to_sheets()`** — needs GAS call to:
   - Get all events from Sheets (keyed by EventID)
   - Similar versioning logic as members

3. **`_sync_payments_to_sheets()`** — needs GAS call to:
   - Get recent payments from Sheets
   - Append new PaymentIds or update if changed

4. **`_import_transactions()`** — needs GAS call to:
   - Get gmail_transactions from Sheets
   - For each row:
     - If MessageId not in MySQL → INSERT new row
     - If exists: check if Memo differs from Notes in MySQL
       - If different: UPDATE Notes in MySQL with Memo value

5. **`_dry_run_google_to_mysql()`** — needs GAS call to:
   - Fetch all Sheets data
   - Compare with MySQL by primary key
   - Collect differences (no changes)

---

## GAS Webhook Integration Pattern

Each `_sync_*()` function needs to call GAS like this:

```python
def _call_gas_webhook(payload: Dict) -> Dict:
    """Call the Google Apps Script webhook."""
    webhook_url = _get_config_value('SheetsWebhookUrl', '')
    if not webhook_url:
        raise ValueError("SheetsWebhookUrl not configured")

    import requests
    resp = requests.post(webhook_url, json=payload, timeout=30)
    if resp.status_code != 200:
        raise Exception(f"GAS webhook failed: {resp.status_code} {resp.text}")

    body = resp.json()
    if not body.get('ok'):
        raise Exception(f"GAS error: {body.get('error', body)}")

    return body.get('data', {})
```

**Webhook actions to implement in GAS:**
- `get_members` → list all members from Sheets with MemberID, LastUpdated
- `get_events` → list all events from Sheets
- `get_payments` → list recent payments from Sheets
- `get_transactions` → list gmail_transactions from Sheets
- `append_members` → add new member rows to Sheets
- `update_members` → update existing member rows in Sheets
- etc.

---

## Database Schema Notes

### Tables involved:
- `members` — MemberID (PK), FirstName, LastName, ..., LastUpdated
- `webapp_events` — EventID (PK), EventName, ..., EventStatus
- `payments` — PaymentID (PK), EventID, MemberID, Amount, ...
- `gmail_transactions` — MessageId (PK), Memo, ProcessedTime, Notes, WebAppID

### Key columns:
- `LastUpdated` (members) — used for versioning: if MySQL newer than Sheets, copy all
- `MessageId` (gmail_transactions) — primary key for matching
- `Notes` (gmail_transactions) — store processing context (AutoMatch, Manual, Admin-Created)

---

## Testing Checklist

When GAS integration is complete, verify:

- [ ] Members sync: new members appended, existing updated if MySQL newer
- [ ] Events sync: status/name changes reflected in Sheets
- [ ] Payments sync: recent payments visible in Sheets
- [ ] Import: new gmail_transactions inserted, Memo→Notes updates work
- [ ] Dry-run: differences detected and displayed (no DB changes)
- [ ] Email reports: sent successfully with correct summary + details
- [ ] Job polling: UI shows real-time progress with correct status transitions
- [ ] Error handling: network errors, missing config values handled gracefully

---

## Files Modified

1. **mmr-admin/api_sheets_sync.py** (NEW, 410 lines)
   - 5 endpoints + helpers + placeholder sync logic

2. **mmr-admin/app.py** (MODIFIED, +2 lines)
   - Added blueprint import and registration

3. **mmr-admin/payment_actions.py** (MODIFIED, 3 lines)
   - Fixed Source→Notes bug in 3 locations

4. **mmr-admin/templates/index.html** (MODIFIED, +150 lines)
   - Added SyncPanel component
   - Added Sync tab to tab bar
   - Added sync view rendering in App

---

## Deployment Notes

- No new dependencies required (uses existing `requests`, `threading`, Flask)
- `SheetsWebhookUrl` must be set in MySQL `config` table for email reports
- GAS webhook implementation should return `{ok: true, data: {...}}` format
- Sync jobs run async and don't block the request

---

**Last updated:** 2026-03-31 02:23 UTC
**Commit:** 984b0aa
