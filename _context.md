# Trailhead Project Context

Last updated: 2026-04-02 22:12 UTC
Last commit: 3480bee (feat: add unmatch button, membership filter, improved UI colors)

## Session log

### 2026-04-02 22:31 UTC — Fix GitHub Actions auth: X-Cron-Token validation before session fallback
Changed: `api_sheets_sync.py` — Updated `_cron_auth_or_session()` decorator to check X-Cron-Token FIRST and return 401 (abort) if token is provided but doesn't match expected value. Removed fallback to `login_required` when token is invalid. Status: ✅ Import test passes; decorator logic fixed (no more redirects to /login in GitHub Actions). Next: Re-run GitHub Actions workflow with verbose flag to verify sync phases complete successfully.

### 2026-04-02 22:12 UTC — Verbose logging for sync operations via GitHub Actions
Changed: `api_sheets_sync.py` — added `verbose=` query parameter to 3 POST endpoints; updated `_sync_members_to_sheets()`, `_sync_events_to_sheets()`, `_sync_payments_to_sheets()` to accept and use `verbose` kwarg from `launch_job()`. `sync_engine.py` — added `verbose` parameter to `compare_sync_rows()`; added `_log_result()` helper to log every decision; wrapped all returns with verbose output (input rows, diffs, timestamps, write dicts). `.github/workflows/bidirectional-sync.yml` — added `workflow_dispatch.inputs.verbose` dropdown; set `env.VERBOSE`; updated all 8 phases to pass verbose flag. `.github/scripts/run_sync_phase.sh` — appends `?verbose=true` if `--verbose` arg set. Status: ✅ All files compile; imports pass; YAML valid. Next: Test via GitHub UI (set verbose=true manually).

### 2026-04-02 21:58 UTC — Sync refactor: unified compare_sync_rows() function
Changed: `sync_engine.py` — added `SyncRowResult` class and `compare_sync_rows()` function (290 lines) to unify row comparison logic across all sync endpoints. `api_sheets_sync.py` — refactored `_sync_members_to_sheets()` to use `compare_sync_rows()` with direction='mysql_to_sheets'. Status: ✅ sync_engine imports cleanly; api_sheets_sync syntax OK. Next: Deploy to staging, run smoke test, backfill CreatedUnix, enable bidirectional sync.

### 2026-04-02 21:48 UTC — Payment matching UX: direct approval without modal
Changed: `mmr-admin/static/payments.js` line 1073 — "Approve Selected" button now calls `handleApproveSelected()` instead of opening the manual match modal. Disabled when `selectedMatchedCount === 0`. Status: Matched events now approve directly (no popup). Pending events use "Manual Match" button or "Approve Pending (Batch)" modal. Next: Test workflow—link event in modal, select matched event, click "Approve Selected" → should approve without showing modal.

### 2026-04-02 21:30 UTC — Admin portal: date fix, email search, resizable columns
Changed: `api_payments.py` — added Email field to member-quick endpoints. `payments.js` — fixed fmtDate() for YYYY-MM-DD timezone issue (now shows 2027-03-31 correctly, not 2026-03-30); added Email/WeChatID to member tooltip; email matching in fuzzy search; resizable Sender & Memo columns with drag handles. Status: Email search working ("zhaoxun" matches liuzhaoxun@gmail.com); date display fixed; columns draggable. Next: Link pending webapp events to gmail_transactions (awaiting MemberID clarification).

### 2026-04-02 20:50 UTC — Dedup sync_engine.py: CI copies basecamp/ → mmr-admin/
Changed: `.github/workflows/deploy-mmr-admin.yml` — added `cp basecamp/python/sync_engine.py mmr-admin/sync_engine.py` to build step. `.gitignore` — added `mmr-admin/sync_engine.py`. Untracked `mmr-admin/sync_engine.py` from git (file exists locally, CI regenerates on build). Created `scripts/sync-shared-modules.sh` and `SHARED_MODULES.md`. Status: CI copies pattern established for both nyrr_api and sync_engine. Imports clean (10/10 pass). Next: Commit changes.

### 2026-04-02 20:45 UTC — Fix Azure sync log warnings: Status enum vs datetime parsing
Changed: `sync_engine.py` (both mmr-admin and basecamp/python) — added `silent: bool = False` parameter to `parse_datetime()` to suppress warnings when called from `datetimes_equal()`. Status enum values like "expired", "inactive", "not active" no longer flood Azure logs. Status: Tested — all imports clean (7/7 pass). Next: Run sync again to confirm clean logs.

### 2026-04-02 18:02 UTC — Migration V10: Status enum + column cleanup (MySQL & Python)
Changed: Status enum expanded (active/expired/inactive/pending); dropped WebApp/PaymentCheck/oauth_subs from members & member_log; updated MEMBERS_SYNC_COLUMNS in sync_engine.py; fixed api_sheets_sync.py CASE_MAP & VALID_MEMBER_FIELDS; fixed api_data.py unix_timestamp backfill; updated api_district_{export,members}.py LastLogin refs. Status: Python imports clean (7/7 pass). Schema snapshot updated. MIGRATION_V10_COMMANDS.md + IMPLEMENTATION_SUMMARY_V10.md ready for deployment. Next: Run SQL migrations on Azure MySQL, deploy Python/TypeScript changes, test Sync tab.

### 2026-04-02 17:35 UTC — GAS column mapping fix: remove ProfileLastUpdated, rename LastLogin
Changed: `config.ts` MM_COL (cols 22–29 corrected), SHEET_HEADERS[MEMBERSHIP_LOG] completed with all cols; `types.ts` Member interface; `sheets.ts` rowToMember + updateMemberRow; `auth.ts`, `members.ts`, `webhook.ts` callers updated. Status: tsc clean, members.test.ts 15/15 pass. Next: MySQL Migration V10 (rename LastLoginDate→LastLogin, drop ProfileLastUpdated/CreatedAt), then Python file renames.

### 2026-04-02 17:29 UTC — Fix import_transactions: 526 false updates + timestamp display
Changed: `api_sheets_sync.py` — SELECT in `_import_transactions` now fetches all backfill columns (Amount, Sender, TransactionDate, etc.); verbose log shows Unix epoch instead of raw ISO string. Status: Backfill will no longer fire on every existing row (was always NULL because columns weren't fetched). Next: Optional — unified `compare_sync_rows()` in sync_engine to consolidate all three sync comparison paths.

### 2026-04-02 15:42 UTC — Members: fix search parameter mismatch error
Changed: `api_members.py` — Removed duplicate `params.append(exact)` in `_build_member_search` (line 118 was redundant). Status: Fixed "Not all parameters were used in the SQL statement" error in member search. Verified: Single token = 5 params, two tokens = 9 params (counts now match placeholders). Next: Test member search in Members tab.

### 2026-04-02 15:40 UTC — Sync: silence parse_datetime warnings for 0 values
Changed: `sync_engine.py` — Silently treat integer 0 and string "0" (with whitespace) as NULL in datetime columns; no warnings logged. Status: Sync will complete cleanly without parse_datetime noise when Google Sheets has 0 values. Tested: all edge cases (int 0, str "0", " 0 ", etc.) now return None silently. Next: (Optional) Persist completed sync jobs for history.

### 2026-04-02 09:34 ET — member card + partial search utilities (centralised)
Changed: `api_members.py` — `get_member_card()` helper + `GET /api/members/<id>/card` endpoint; search now includes WeChatID, enforces ≥2-char minimum; `utils.js` — `searchMembers(q)` and `getMemberCard(memberID)` as single source of truth for all panels. Status: Done. Next: Wire tooltip card component in Members/Audit panels using `getMemberCard`; swap Members.js search calls to use `searchMembers`.

## ⏭️ Next Session — Pending Tasks

DEDUPLICATION & TECH DEBT TARGETS:
1. Python API Clients: Consolidate basecamp/python/nyrr_api.py vs mmr-admin/nyrr_api.py.
2. DB Schemas/Migrations: Merge basecamp/schemas/ vs db/schemas/ and basecamp/migrations/ vs db/migrations/.
3. Sheets Sync Scripts: Deduplicate api_sheets_sync_batched.py, api_sheets_sync.py, and mmr-admin/api_sheets_sync.py.
4. Docs/Scripts: Clean up duplicate LOCAL_SETUP.md and orphaned .sh scripts at root.
5. Column Mapping: Unify Google Sheets ↔ MySQL column name mapping (camelCase vs PascalCase).
6. Datetime Handling: Standardize timestamp/datetime conversion logic across sync scripts.
7. Triggers & GH Actions: Reconcile Admin portal manual buttons vs GitHub Actions scheduled jobs.
8. Email Webhooks: Consolidate email sending via GAS webhook (including user copies and GH scheduled jobs).

PORTAL LAUNCH PREP (Carryover):
1. GOOGLE OAUTH TEST (local)
2. EMAIL/PASSWORD TEST (local)
3. FIRST-TIME SETUP TEST
4. EXPIRED MEMBER TEST
5. RUN MIGRATION V9 ON PRODUCTION
6. PUSH TO TRIGGER AZURE DEPLOY
