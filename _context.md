# Trailhead Project Context

Last updated: 2026-04-02 01:40 UTC
Last commit: 3480bee (feat: add unmatch button, membership filter, improved UI colors)

## Session log

### 2026-04-02 08:40 ET — AuditPanel: Not Traced filter, dark theme fix, member search
Changed: `AuditPanel.js` — ⚠ Not Traced Only filter checkbox; all hardcoded light colors → CSS vars (`--bg`, `--surface`, `--text`, etc.); Member Lookup card with debounced `/api/members/search` + expiration color badges. Status: Done. Next: Test in admin portal.

### 2026-04-01 20:44 UTC — Fix member search endpoint conflict and security issue
Changed: `api_runners.py` — Renamed `/api/members/search` → `/api/runners/search` for NYRR runner candidate matching (fuzzy search for manual runner-member matching); kept parameterized query approach. `api_members.py` — Fixed `/api/members/search` to use parameterized queries with LIKE matching instead of unsafe string formatting; prioritizes exact MemberID match first, then fuzzy name/email matching; returns up to 50 results sorted by relevance. Status: Route naming is now explicit (members vs runners search), SQL injection vulnerability eliminated, Members tab search ready to test. Next: Verify member search works in Members tab for family/district ops.

### 2026-04-02 04:42 UTC — Fix Audit: config amounts ($30 Ind, $50 Fam) + UI improvements
Changed: `api_audit.py` — Updated config fee defaults: MembershipFeeIndividual $50→$30, MembershipFeeFamily $80→$50. Now audit searches for actual transaction amounts. `AuditPanel.js` — Changed row background to #f0f7ff (light blue). Status: Backend now searches for $30/$50 (matches 66 transactions), frontend infers types correctly, Individual filter now shows results. Ready to re-run audit. Next: Verify all $30 Individual and $50 Family transactions appear.

### 2026-04-01 20:24 UTC — Fix Renewal Audit UX: colors, data visibility, multi-select filter
Changed: `AuditPanel.js` — Enhanced color contrast (green #007d2f→#00b859, red #d73a49→#e63946, orange #b08500→#ff8c00); removed sender/memo truncation (now shows full text with wordBreak); converted membership type filter from single-select dropdown to multi-select checkboxes. Status: All three UX issues resolved. Users can now: (1) see bright, warm status colors with high contrast, (2) view complete SENDER/MEMO for all rows (especially useful for unmatched records), (3) select both Individual and Family simultaneously. Next: User testing on live data.

### 2026-04-02 02:10 UTC — Debug membership filter bug and add sender/memo display to audit
Changed: `api_audit.py` — Added extraction of Sender and Memo fields from gmail_transactions; included these fields in audit entry result dict for frontend display. `AuditPanel.js` — Added debug logging to identify membership_type filter mismatch (logs actual types in console); added useEffect hook to show filter status and filtered count. Status: Sender/Memo now populate in transaction details (shows "From: ..." and "Memo: ..." in rows). Filter logic verified as correct; debug logging deployed to identify root cause of "Both" showing only Family. Next: Run audit with debug console open to identify actual membership_type values from backend.

### 2026-04-02 01:35 UTC — Complete membership renewal audit feature with filters and unmatch capability
Changed: `api_audit.py` — Added POST `/api/audit/unmatch` endpoint to reset gmail_transactions (ProcessedTime=NULL, PaymentID=NULL) for NOT TRACED items; allows admin to re-process failed traces. Enhanced JSON request parsing with 3-level fallback (get_json() → manual json.loads() → request.data). `AuditPanel.js` — Added membership type filter dropdown (Individual/Family/Both); unmatch button appears on NOT TRACED items with confirmation; redesigned UI with light theme (white background, dark text) for readability. Color palette: blacks, grays, greens (#007d2f), reds (#d73a49). Summary cards show white with borders instead of blue. Status: Feature complete and tested on live data. Next: Document audit workflow; consider audit history/log.

### 2026-04-02 01:10 UTC — Fix date type serialization and auto-load MembershipYearEnd config
Changed: `api_audit.py` — Added `_serialize_for_json()` helper to recursively convert date/datetime objects to ISO strings before JSON response; fixed 500 TypeError. Added GET `/api/config/get?key=MembershipYearEnd` endpoint. `AuditPanel.js` — Auto-loads MembershipYearEnd from config on mount (supports both full date YYYY-MM-DD and MM-DD formats); defaults to 12-31 if unavailable. Set default start date to 2025-10-01, end date to today(). Enhanced error logging with console output for debugging. Status: All date issues resolved, config loading works end-to-end.

### 2026-04-01 14:49 UTC — Implement Unix timestamps for timezone-invariant sync (GAS + Python)
Changed: **GAS:** Fixed timestamp comparison across MySQL (EDT) and Google Sheets (UTC). Added `toUnixTimestamp()` helper to `sheets.ts`. Modified `updateMemberRow()` to auto-calculate Unix timestamps whenever ISO datetime is set (LAST_UPDATED → LAST_UPDATED_UNIX, etc.). Added Unix columns to config.ts MM_COL (26-29), WE_COL (24-26), PH_COL (17). Updated all row converters to include Unix fields. Updated 2 direct writes in jobs.ts. **Python:** Added `resolve_conflict_unix()` to sync_engine.py for integer-based comparison (vs datetime parsing). Updated 3 sync endpoints in api_sheets_sync.py to use Unix comparison. Created backfill_unix_timestamps.py helper script. **Database:** Migration 0016 corrected — Unix columns already exist in schema, migration now adds 5 missing indices and backfills any NULL/0 values. All code syntax-checked. Status: Full implementation complete. Next: (1) Apply migration 0016 to Azure MySQL, (2) Deploy GAS code, (3) Deploy Flask to Azure App Service, (4) Test end-to-end sync.

### 2026-04-01 13:35 UTC — Add Members Management tab: family ops + district change
Changed: Created `mmr-admin/api_members.py` (315 lines) with 6 endpoints: `/api/members/search` (search by name/ID), `/api/members/<id>/family` (get family members), `/api/members/family/add-member` (add to family, share payment fields), `/api/members/family/remove-member` (revert to individual), `/api/districts` (list districts), `/api/members/<id>/district` (change district). All ops set LastUpdated and log admin ID via activity_logger. Created `mmr-admin/static/Members.js` (438 lines) React component with two sub-tabs: (1) Update Family: search primary member (Family type), display family table with Remove buttons, search + add members via search modal; (2) Change District: search member, pick new district from dropdown, confirm change. Both sub-tabs include toast notifications, error handling, loading states. Updated `mmr-admin/templates/index.html` to load Members.js, add Members tab after Payments (restricted to admin role), render MembersPanel component. Registered blueprint in `mmr-admin/app.py`. Status: Code written, import check passed. Next: Manual test of family add/remove/district workflows; verify LastUpdated and admin ID logged correctly.

### 2026-04-01 20:48 ET — Create sync_jobs table to fix sync status API 404 errors
Changed: Created `db/schemas/migration_v6_sync_jobs.sql` with `sync_jobs` table schema (9 columns: JobID, Operation, Status, Message, Progress, Result, StartedAt, UpdatedAt, CompletedAt). Root cause: `/api/sync/status/{job_id}` endpoint was querying non-existent table, returning MySQL error 1146. Status: Migration applied via Data Query. Next: Verify sync status checks now return job metadata without 404 errors.

### 2026-04-01 23:XX UTC — Add Members Table sync panel with Membership Fees + LastUpdated sync
Changed: `mmr-admin/api_sync.py` — (1) `/api/sync/membership-fees` endpoint (101–263): syncs payment data to members table for Individual/Family Membership; for each member finds most recent payment, updates MembershipFeePaid/PaymentDate/PaymentTransaction if newer. (2) `/api/sync/members-lastupdated` endpoint (266–404): syncs LastUpdated column from member_log audit trail; for each member, if most recent LoggingTime > current LastUpdated, updates it. Both support optional memberID filter. `mmr-admin/templates/index.html` — renamed "💳 Membership Fees" tab to "👥 Members Table" (line 1948); added nested sub-tabs (Membership Fees, Sync LastUpdated) with state subTab2 (lines 1878, 1998–2065). Each sub-tab has manual sync button + optional memberID prompt. UI integrates with existing toast tracking. Status: Both endpoints complete, UI fully integrated, nested tabs working. Next: Test both syncs with sample data.

### 2026-04-01 18:00 UTC — Implement membership renewal audit feature
Changed: Created `api_audit.py` (234 lines) with 4-path transaction tracing: gmail_transactions → PaymentID/TransactionNumber → payments/members/webapp_events. Queries matching membership fee amounts, verifies expiration dates, checks family member consistency, generates audit report with trace routes and red flags. Created `AuditPanel.js` (437 lines) React component with date range inputs, run button, summary stats grid, expandable results table showing transaction/member info, match status, trace route, and family checks. Integrated blueprint into `app.py`, wired panel into admin dashboard tabs. Status: Ready to test. Next: Run import checks, test audit workflow end-to-end, verify trace routes work correctly.

### 2026-04-01 22:28 UTC — Add column selector and sorting to Members by District tab
Changed: `api_district_members.py` — added sortBy/sortOrder query params with SQL injection safeguards; include all required columns (District, Gender, Type, FamilyID, PaymentDate, MembershipFeePaid, PaymentTransaction). `DistrictMembersPanel.js` — added column selector dropdown with checkboxes, clickable column headers for sorting, localStorage persistence of column/sort prefs, default 12 columns. Export function respects selected columns. Status: Ready. Next: Test sorting, column persistence across page reloads, CSV export with selected columns only.

### 2026-04-01 21:25 UTC — Convert date columns to DATE type: Expiration, PaymentDate
Changed: `db/migrations/0015_convert_dates_to_date_type.sql` — ALTER TABLE to convert 4 columns from datetime to DATE type: members.Expiration, members.PaymentDate, webapp_events.PaymentDate, payments.PaymentDate. Updated schema_snapshot.sql. Benefits: Eliminates time component in storage, API responses show clean ISO date format (YYYY-MM-DD), frontend displays only date. Note: gmail_transactions.TransactionDate is already DATE type. Committed 81f1f46. Status: Migration ready. Next: Run migration on Azure MySQL, verify API responses show date-only format.

### 2026-04-01 21:08 UTC — Fix parse_datetime errors: add field filtering for GAS webhook
Changed: `api_sheets_sync.py` — added `_filter_member_fields()`, `_filter_event_fields()`, `_filter_payment_fields()` helpers to strip non-standard columns before sending to GAS webhook. Root cause: GAS resolve_conflict was trying to parse unexpected fields (e.g., MembershipType="Family Membership") as datetimes, causing "parse_datetime: unrecognised format" warnings. Filters run after serialization, before webhook POST; follow schema definitions. Applied to _sync_members/events/payments_to_sheets() for both append/update batches. Committed 2e5cee7. Status: Ready. Next: Deploy Flask to Azure, rerun syncs to verify parse errors are eliminated.

### 2026-04-01 20:52 UTC — Create _convert_date_fields_to_iso_date() helper for MySQL→Google members sync
Changed: `api_sheets_sync.py` — added `_convert_date_fields_to_iso_date()` helper function (lines 135–183) to convert Expiration and PaymentDate from ISO8601 datetime format (YYYY-MM-DDTHH:MM:SS) to ISO date-only (YYYY-MM-DD). Handles both formats, logs warnings on parse errors. Called in _sync_members_to_sheets() at lines 557, 573 for both append/update batches. Ensures GAS receives clean date-only strings without time component. Syntax verified. Status: Ready. Next: Deploy Flask and test MySQL→Google member sync with proper date formatting.

### 2026-04-01 19:34 UTC — Standardize date-only display across mmr-admin/mmr-webapp
Changed: `DistrictMembersPanel.js` — updated formatDate() to support dateOnly parameter; Expiration now shows date-only (e.g., "Mar 31, 2027" not "Mar 31, 2027 04:00"); `payments.js` already uses date-only fmtDate(). Status: mmr-admin displays dates correctly now; Python backend returns dates as-is from DB (DATE type); GAS/Google Sheets now formats as ISO date-only via toISODateString(). Committed fcfe1a8. Next: Test end-to-end from MySQL → mmr-admin display → Google Sheets.

### 2026-04-01 19:32 UTC — Fix date format: use ISO date-only (YYYY-MM-DD) for 3 columns
Changed: `sheets.ts` rowToEventObject() — changed PaymentDate from toISO8601() to toISODateString(). Now all 3 date-only columns consistently use ISO date format (no time/timezone): Expiration, PaymentDate, TransactionDate. Fixes: Google Sheets showing "2027-03-31 4:00:00" instead of "2027-03-31". Committed 5367b6e. Status: Ready for GAS deploy. Next: Push GAS changes, verify dates sync cleanly to Sheets.

### 2026-04-01 19:30 UTC — Fix sync job status 404 errors: add database fallback
Changed: `api_sheets_sync.py` api_sync_status() — endpoint now checks both in-memory jobs and database fallback. Root cause: sync jobs stored only in memory; when job completed or Flask restarted, status lookup returned 404. Fixes: persists job status across Flask restarts, better error messages. Committed 1f1a1b5. Status: Ready. Next: Redeploy Flask, sync errors should show proper status instead of 404.

### 2026-04-01 19:28 UTC — Fix member-quick/all: include all statuses for payment matching
Changed: `api_payments.py` api_member_quick_all() — removed WHERE Status IN ('active', 'pending') filter. Now returns ALL members regardless of status since payments can renew inactive/expired memberships. Fixes: A0533 was filtered out because it was inactive. Committed e77c19b. Status: Ready. Next: Redeploy Flask, test fuzzy search now shows both Samantha Zheng entries.

### 2026-04-01 19:24 UTC — Fix gmail_transactions sync: wrong GAS action name
Changed: `api_sheets_sync.py` — fixed 3 calls using `get_gmail_transactions` → `get_transactions`. GAS webhook recognizes `get_transactions` action (handles Fetch-Gmail sheet). Error was: "Unknown action: get_gmail_transactions". Committed 2df87cd. Status: Ready. Next: Redeploy Flask, retry gmail_transactions sync.

### 2026-04-01 19:23 UTC — Add missing member-quick/all endpoint for fuzzy search
Changed: `api_payments.py` — added new GET endpoint `/api/payments/member-quick/all` that returns all active/pending members with fields: MemberID, FirstName, LastName, Expiration, District, Type, WeChatID. Fixes 404 error in Quick Approve fuzzy search. Committed 92589d0. Status: Ready. Next: Redeploy Flask, test Quick Approve fuzzy search now works.

### 2026-04-01 19:20 UTC — Fix member sync duplicates: appending instead of updating
Changed: `webhook.ts` handleUpdateMembers() + handleAppendMembers() — added duplicate detection + defensive logic. Root cause: MemberID comparison was failing (whitespace, stale data, or missing fields) causing updates to be skipped and rows appended instead. Fixes: (1) trim whitespace on MemberID compare; (2) data validity checks; (3) log not-found members; (4) detect & warn if appending duplicates. Returns notFound/duplicates counts for debugging. Committed 8c56389. Status: Ready for GAS redeploy. Next: Deploy GAS, run member sync test, verify updates happen in-place without duplicates.

### 2026-04-01 19:18 UTC — Fix logger error + improve event selection highlight
Changed: `api_payments.py` — added missing `import logging` + `logger = logging.getLogger(__name__)` (was undefined in approve-event-match endpoint). `ManualEventMatchModal.js` — improved left panel event highlighting: blue border, glow effect, "✓ For matching" label when selected. Committed 95921bf. Status: Ready. Next: Redeploy Flask to Azure and test manual match flow end-to-end.

### 2026-04-01 19:16 UTC — Fix GAS webhook error: parse_datetime on "payment"
Changed: `api_payments.py` _sync_member_events_to_sheets() — added safeguard to ensure UpdatedAt always present when syncing events. Fallback to Timestamp if missing; convert to ISO format. Root cause: UpdatedAt was missing from some event rows, causing resolve_conflict() to parse EventCategory='payment' as datetime. Error: "parse_datetime: unrecognised format: payment". Committed 5556983. Status: Ready. Next: Test manual match approval now works without webhook error.

### 2026-04-01 19:02 UTC — Add fuzzy search to Quick Approve member selection
Changed: `payments.js` GmailQuickApprovePopover — added fuzzyMatchMember() helper (matches FirstName, LastName, MemberID, WeChatID against search query); added "Find Member" input with real-time filtering; results table shows Name, MemberID, District, Type, Expiration; click-to-select populates Member ID field. Improves UX for manual member lookup in Quick Approve workflow. Committed 410a38c. Status: Ready. Next: Test on live data + consider expanding auto-sync to also update payments + gmail_transactions sheets (currently only events synced).

### 2026-04-01 14:48 ET — Add member preview card to Quick Approve popover
Changed: `payments.js` GmailQuickApprovePopover — added memberData state + useEffect to fetch member details when valid ID entered; displays floating preview card with Name, Expiration, WeChatID. Shows loading state while fetching, updates real-time. Green left border card for visual clarity. Improves UX for validation + quick member reference. Committed b492410. Status: Ready.

### 2026-04-01 14:46 ET — Fix Quick Approve popover cutoff at screen edge
Changed: `payments.js` GmailQuickApprovePopover — added ref + useEffect to measure width after render; if extends beyond right edge (8px margin), switches from left-aligned to right-aligned. Added maxWidth (360px) constraint. Prevents popover cutoff on narrow/mobile screens. Committed 5ce5e92. Status: Ready.

### 2026-04-01 14:44 ET — Fix tooltip positioning at viewport boundaries
Changed: `payments.js` MemberTooltip component — now centers horizontally, constrains left/right edges (8px padding), detects insufficient space below (~160px), auto-repositions above anchor if needed. Prevents tooltips from overlapping screen boundaries. Committed 19b1ec9. Status: Ready.

### 2026-04-01 14:42 ET — Add 'Approve Selected' button for quick single-event approval
Changed: `payments.js` — added green "✓ Approve Selected" button (visible when single event selected). Clicking it opens manual match modal for that event, allowing user to select transaction + approve in one action. Renamed old batch button to "📋 Approve Pending (Batch)" for clarity. Improves UX for single-event manual approval workflows. Committed e13ee9e. Status: Ready. Next: Deploy + test button flow.

### 2026-04-01 14:40 ET — Add 10-second buffer to Sheets timestamps (async propagation delay)
Changed: `sync_engine.py` (both copies) — resolve_conflict() now subtracts 10 seconds from Sheets timestamp before comparing with MySQL. Accounts for GAS→Sheets API delay (~2-10s). Ties within 10s → MySQL wins (fresher data). Applied in ONE place only as single source of truth. Example: Sheets=T18:14:58, MySQL=T18:14:56 → adjusted Sheets=T18:14:48 → MySQL wins. Fixes: incomplete Sheets records blocking MySQL updates. Committed d3f07fc. Status: Import ✅. Next: Test that incomplete payments now get overwritten with complete MySQL records.

### 2026-04-01 14:37 ET — Reduce logging noise: skip tie-timestamp MATCH entries
Changed: `api_sheets_sync.py` MySQL→Sheets sync (members/events/payments): tie-timestamp entries with NO field diffs now silent (no log); only log SKIP when there ARE actual field differences. Shows which fields differ in log message. Removes noise from tie-only entries. Committed 3e11bbb. Status: Import ✅. Next: Expand approve & link to sync all 4 sheets (members, payments, events, gmail_transactions) not just events.

### 2026-04-01 14:35 ET — Auto-sync member events to Sheets after manual match
Changed: `api_payments.py` — added _sync_member_events_to_sheets() helper (fetches member's events, filters sync-eligible columns, posts GAS webhook 'update_events'); integrated into approve_event_match (non-blocking auto-sync after approval); added POST /api/payments/sync-member-to-sheets/{member_id} endpoint for manual sync. Uses filter_sync_columns + requests to match Sheets schema. Committed 042af9a. Status: Import check ✅. Next: Deploy + test manual match approval triggers Sheets update.

### 2026-04-01 14:32 ET — Add manual event-to-transaction matcher popup
Changed: Created ManualEventMatchModal.js (React component) + backend endpoints in api_payments.py. Feature: admin clicks "📋 Approve Pending" button in Payments tab → modal shows pending events (left) + 3-tier match suggestions (right): most likely (amount+memberID), more likely (name match), recently matched (date±2 days). Admin selects transaction row + optional notes → confirms → updates webapp_events (MatchedMessageId, MatchedTransactionNumber, AdminApprover, ApprovalDate, PaymentDate, Notes, Status='approved'). Resolves: pending events left hanging after autoguess. Committed 472a356. Status: Import check ✅ passed. Next: Deploy + test on live pending events.

### 2026-04-01 14:26 ET — Fix tie-timestamp MATCH/SKIP logic
Changed: `api_sheets_sync.py` — Members/Events/Payments SHEETS_WINS handling: when timestamp tie, now check for actual field diffs before logging. If no field differences (identical data) → log `= MATCH (tie: ...)` instead of `⏭️ SKIP`. If field diffs exist → log `⏭️ SKIP` (Sheets will apply on nightly sync). Prevents false SKIP entries. Committed ff7ff19. Status: Import check ✅ passed. Next: Deploy + test sync output on live data.

### 2026-04-01 14:24 ET — Commit date/time refactor; plan GAS deploy + webhook fix
Changed: Committed `a494acb` — all 8 date/time refactor files (GAS sheets.ts/jobs.ts/webhook.ts, Python datetime_utils.py, webapp lib/date.ts/auth/complete/DashboardClient.tsx). Import check ✅ passed. Status: Ready for GAS clasp deploy + webapp build verify. Next: (1) Deploy GAS (clasp push + redeploy); (2) Re-set SheetsWebhookUrl in MySQL config (was stale 404); (3) Run webapp `npm run build`; (4) Re-run import transaction batch to verify end-to-end flow.

### 2026-04-01 13:49 ET — Date/time refactor across all three layers
Changed: (GAS) `sheets.ts` — added canonical `toISODateString()` (local date extraction, no UTC shift); fixed `deriveStatus`, `rowToMember.expiration+paymentDate`, `rowToFetchGmailRow.transactionDate`; removed buggy UTC-shifted version from `jobs.ts`; fixed `rowToMemberObject` + `rowToEventObject` in `webhook.ts` to use `toISO8601`/`toISODateString` correctly. (Python) `datetime_utils.py` — `to_datetime` now strips tzinfo (UTC normalize); `to_date` handles ISO strings directly. (webapp) `lib/date.ts` — added `parseLocalDate`, `isExpiredNY`, `daysUntilExpiryNY`, fixed `formatLocaleDate` for YYYY-MM-DD inputs; `auth/complete/route.ts` + `DashboardClient.tsx` use NY-aware helpers. Status: import check passes; GAS needs clasp deploy + redeploy; webapp needs `npm run build` verify. Next: deploy GAS, fix stale SheetsWebhookUrl, re-run import.

### 2026-04-01 13:21 ET — Fix Bugs 2/3/4: gmail_transactions import + ProcessedTime lifecycle
Changed: (Bug 2) `_import_transactions` INSERT now captures all 13 fields (Sender, Amount, TransactionDate, TransactionNumber, Subject, OriginalMemo, Source) + backfill UPDATE for existing NULL rows; `sheets_row_for_engine` now passes Sheets PaymentID/Source for engine use. (Bug 4) Removed `ProcessedTime=NOW()` from `run_auto_match` + `manual_match`; added it to `approve_event` after actual approval (with `AND ProcessedTime IS NULL` guard). (Bug 3) `sync_engine.py:resolve_gmail_row` now syncs ProcessedTime/Source/PaymentID Sheets→MySQL when GAS has processed a row (MySQL NULL). Status: all three fixed; 404 error on import is a stale SheetsWebhookUrl — user must redeploy GAS and update config. Next: redeploy GAS webhook, update SheetsWebhookUrl in MySQL config, re-run import.

### 2026-04-01 12:56 ET — Full mmr-admin refactor: shared utilities + wiring
Changed: Created `core.py` (gen_id, fixes collision bug), `config_cache.py` (thread-safe, replaces 5 get_config impls), `activity_logger.py` (replaces 3 duplicate INSERT blocks), `sync_jobs.py` (replaces _sync_jobs/_sync_jobs_lock/10 thread dispatches in api_sheets_sync.py), `query_builder.py` (add_search/add_date_filter), `datetime_utils.py` (to_datetime/to_date). Added `@handle_api_errors` to `helpers.py`. Wired all into payment_handlers, payment_actions, api_payments, api_sheets_sync, sheets_sync, webhook_client, api_sheets_diags. Created `static/utils.js` (fmt/fmtDate/fmtMoney/STATUS_COLORS/Badge/api). Updated DistrictMembersPanel.js to use mmrUtils.api(). Status: test_imports passes (7 pure-python modules ✅, 29 skipped for missing deps). Next: deploy + smoke test; fix Bug2 (Amount NULL in gmail_transactions import).

### 2026-04-01 11:29 ET — Standardize sync log format + fix SKIPPED→MATCH
Changed: `api_sheets_sync.py` — all 6 sync paths (Sheets→MySQL + MySQL→Sheets × members/events/payments) now emit `✅ INSERT | 🔄 UPDATE | = MATCH | ⏭️ SKIP | ❌ ERROR` per-row lines with key, MemberID, changed fields, and timestamps. SKIPPED (Sheets ts newer, no field changes) now writes MySQL `LastUpdated` to match Sheets and logs as `= MATCH` so next run is clean. Status: syntax verified. Next: deploy + run sync to confirm log output.

### 2026-04-01 09:56 ET — Rebuild gmail_transactions: WebAppID → PaymentID
Changed: Renamed `WebAppID` → `PaymentID` in gmail_transactions (schema_snapshot.sql + 6 Python files: api_sheets_sync.py, payment_actions.py, api_email_diags.py, sync_engine.py x2, auto_guess_payments.py). Status: DROP/CREATE SQL ready (see below); user runs SQL + Sheets→MySQL sync to repopulate clean data. Next: Run SQL, sync, commit all changes.

### 2026-04-01 09:15 ET — Sprint 1: bug fixes, db pooling, test suite
Changed: (1) Fixed G→MySQL Status 1265 bug — added `_coerce_member_status()` + `_MEMBER_STATUS_MAP` mapping GAS 'inactive'→'not active', 'pending_upgrade'→'pending', case variants → lowercase; (2) Fixed G→MySQL MatchedMessageId 1452 bug — empty string `''` now nulled out (was falsy, bypassed FK guard); (3) `db.py` — replaced per-query fresh connections with `MySQLConnectionPool(pool_size=5)`, added `db_cursor()` context manager (auto commit/rollback), added `handle_mysql_error()` mapping errno→HTTP status; (4) Deleted 4 dead files (api_sync_old.py, google_workspace.py, mysql_sync.py, db/schemas/members.sql); (5) Created `tests/` with conftest.py + 62 passing unit tests (test_db.py, test_sync_status.py, test_sync_coerce.py); added pytest to requirements.txt. Status: All 62 tests pass. Next: Add pytest to pre-commit hook; commit + push.

### 2026-04-01 08:10 ET — Full codebase audit report
Changed: Created `CODEBASE_AUDIT.md` (611 lines) — architecture review, MySQL pain point analysis (no pooling + inconsistent error handling + zero tests), 7 exact duplicates mapped, 13 oversized files flagged, 5-sprint reorganization roadmap, testing pyramid proposal, 8 stale docs identified. Status: Report complete. Next: Execute Sprint 1 (connection pooling, db_cursor context manager, pytest setup, delete dead files).

### 2026-04-01 07:48 ET — delete redundant sync-all-sheets-ordered workflow
Changed: Deleted `.github/workflows/sync-all-sheets-ordered.yml` (replaced by bidirectional-sync). Status: Done. Next: Push deletion commit.

### 2026-04-01 07:29 ET — improve sync logging and G→M summary format
Changed: MySQL→Google events log now shows `field: old → new` per diff; G→M summary includes skipped+errors per table; `errors_members` tracked separately. Status: Done. Next: Push all commits to deploy.

### 2026-04-01 01:50 ET — fix 3 Google→MySQL sync errors (decimal, FK events, FK payments)
Changed: `_coerce_value` now handles decimal/float cols (`''`→None); members block fetches decimal cols from schema; events block NULLs orphan `MatchedMessageId` vs `gmail_transactions`; payments block NULLs orphan `EventID` vs `webapp_events`. Status: Done. Next: Deploy and re-run sync to verify.

### 2026-04-01 01:32 ET — add pre-deploy import validation to CI
Changed: Added Python 3.11 setup + `pip install -r requirements.txt && python3 test_imports.py` step to `deploy-mmr-admin.yml` before deploy. Status: Done — next push will validate all imports with full deps before reaching Azure. Next: monitor first CI run.

### 2026-04-01 01:29 ET — fix sync_engine ModuleNotFoundError on Azure
Changed: Copied `basecamp/python/sync_engine.py` → `mmr-admin/sync_engine.py`; removed `sys.path.insert` hack in `api_sheets_sync.py`. Status: Fixed — `test_imports.py` passes. Next: Commit both files; monitor Azure restart.

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

---

## Session log

### 2026-04-01 01:08 ET — Full bidirectional sync + UI symmetry
Changed: Flattened `GoogleToMySQLPanel` to match MySQL→Google style (3 primary buttons, no inner tabs, no dry-run). Added `Full Sync` sub-tab to `SyncPanel` with 8-phase list + button. Added `_run_full_bidirectional_sync()` orchestrator + `_cron_auth_or_session` decorator + `/api/sync/full-bidirectional-sync` route to `api_sheets_sync.py`. Created `.github/workflows/bidirectional-sync.yml` — 8 chained jobs (cron 4×/day), each polls `/api/sync/status/{id}` via `X-Cron-Token` auth, final notify job emails admin@mmrunners.org. Fixed `errors_count` asymmetry in `JobCard`. Status: needs 2 new GH Secrets (`MMR_ADMIN_URL`, `SYNC_CRON_TOKEN`) and `SYNC_CRON_TOKEN` set in Azure app settings. Next: push + set secrets.

### 2026-04-01 00:55 ET — G→MySQL type coercion + UI fixes
Changed: Added `_coerce_value()` to `api_sheets_sync.py` — detects INT/YEAR columns via INFORMATION_SCHEMA and converts `''`→`None`, fixing 1366 errors on `JoinYear` (members, events, payments). Added per-row `log_lines` error output for events + payments. Normalised G→MySQL result shape to add top-level `inserted/updated/skipped/errors_count`. Added `/api/sync/jobs` list endpoint + `SyncPanel` mounts from it (jobs persist across tab switches/page reload). Rewrote `JobCard` to show `result.error` prominently + stat line. Removed duplicate `RecentJobs` from `GoogleToMySQLPanel`; added `filterFn` prop so each sub-tab shows only its own jobs. Updated description copy to reflect bidirectional sync. Status: committed locally, needs push. Next: verify G→MySQL members/events/payments run clean.

### 2026-04-01 00:34 ET — Bidirectional sync engine (shared module)
Changed: Created `basecamp/python/sync_engine.py` (598 lines) — canonical spec-compliant bidirectional logic shared by cron job and admin portal. Fixes: GMT offset discarded instead of applied to UTC, tie-breaker not implemented (Sheets wins), missing-timestamp edge cases skipped instead of resolved. Updated `basecamp/ops/sync_sheets_to_mysql.py` and `mmr-admin/api_sheets_sync.py` to import from engine. Status: all 6 conflict-resolution test cases pass. Next: commit + run `nyrr-test` to verify import chain.

### 2026-04-01 00:03 ET — Remove page_admin from GAS membership app
Changed: Deleted frontend/page_admin.html and dist/page_admin.html; removed 'admin' from allowedPages in ui.ts; removed Admin Panel button + JS from page_dashboard.html; removed admin approval deep-link from page_payment_history.html. Status: done, needs push + clasp deploy. Next: —

### 2026-03-31 23:52 ET — Sync tab follow-up fixes (5 issues)
Changed: Removed per-row skip logs from MySQL→Google Members/Events/Payments (count only in summary). Fixed Events mass-updates: missing UpdatedAt on either side now skips (was forcing update). Fixed Payments: same missing-date trigger, now uses _parse_datetime comparison. Fixed Sync Unprocessed Txns DATETIME error: removed `OR ProcessedTime = ''` from query (MySQL rejects empty string for DATETIME). Fixed Google→MySQL datetime normalization: now uses INFORMATION_SCHEMA to detect actual datetime columns instead of name-guessing (was missing `Created`, etc.). Status: committed, needs push. Next: verify G2M per-table routes work after datetime fixes.

### 2026-03-31 23:33 ET — Sync tab bug fixes (4 issues)
Changed: Unified JobCard component with job name + action type header + View Log toggle across all Sync sub-tabs. Fixed Import Transactions Notes='' on INSERT (now Notes=Memo, preventing double-update on re-run). Fixed `RuntimeError: Working outside of request context` in `_sync_unprocessed_transactions_to_sheets` (removed erroneous `@route`/`@login_required` from thread-target function). Added per-table Google→MySQL routes + sub-tabs (Members/Events/Payments); `_sync_google_to_mysql` and `_dry_run_google_to_mysql` now accept `tables` filter param. Status: deployed to repo, needs Azure push. Next: push to Azure, verify per-table G2M routes work end-to-end.

### 2026-03-31 23:15 ET — Regenerate schema_snapshot.sql from live DB
Changed: Overwrote db/schema_snapshot.sql with live DDL from dump_schema() (18 tables); updated table_groups.json to add admins, viewer_admins, viewer_user_settings. Status: Done. Next: Prune db/schemas/ deprecated reference files.

### 2026-03-31 23:05 ET — SQL consolidation, schema tools, Email Log headers
Changed: Deleted duplicate SQL files (web-apps/mmr-webapp/db/mmr_db_inspector.sql, basecamp/ops/mmr_migration_consolidated.sql); moved v1–v10 archive + check_event_data.sql into db/; added table_groups.json to mmr-admin; added dump_schema() to api_python_exec.py; fixed activity_log query in api_email_diags.py (Details → State/ErrorCode/ErrorMessage); updated db/README.md with schema tools and corrected layout. Status: Done. Next: Run dump_schema() in Python Exec tab to regenerate db/schema_snapshot.sql from live DB, then prune db/schemas/.

### 2026-03-31 22:35 UTC — Repo cleanup: remove orphaned sync scripts & duplicate schemas
Removed 6 orphaned root-level sync scripts (sync_*.sh) and 2 sheets sync duplicates (api_sheets_sync*.py) via `git rm`. Deleted basecamp/schemas/ and basecamp/migrations/ (db/ is canonical). Updated .gitignore to prevent re-commit. Verified mmr-admin/app.py has nyrr_api.py path setup for local dev. Status: Complete — clean single-source-of-truth for schemas, migrations, and sync logic.

### 2026-04-01 00:24 UTC — Deduplication & Technical Debt Planning
- Changed: Updated Pending Tasks with duplicate logic targets (schemas, API clients, mappings, datetimes, webhooks).
- Status: Planned.
- Next: Begin codebase deduplication.
### 2026-03-31 21:25 UTC — Create _to_iso_datetime() wrapper for datetime normalization
Root cause of "Incorrect datetime value" error: GAS webhook returns JavaScript Date.toString() format ('Tue Mar 31 2026 15:51:18 GMT-0400 (...)') but MySQL expects ISO 8601 ('2026-03-31 15:51:18'). Created `_to_iso_datetime()` wrapper function as single source of truth for all datetime normalization. Handles JavaScript Date.toString(), ISO 8601, datetime objects, and date strings. Applied to transaction import: normalize timestamp_raw and processed_time_raw before INSERT. Enhanced logging shows both raw and normalized values. Reusable across all four tables. Committed cd50f80. Status: Complete.

### 2026-03-31 21:18 UTC — Add missing TimeStamp field to gmail_transactions INSERT
Schema requires `TimeStamp DATETIME NOT NULL` with no default value. GAS webhook provides timestamp in 'timestamp' field (normalized to 'Timestamp'). Updated INSERT to: (1) extract timestamp from row; (2) validate it's not missing; (3) include TimeStamp in 6-column INSERT (was 5). Fixes "Field 'TimeStamp' doesn't have a default value" errors. Committed d82d75b. Status: Complete.

