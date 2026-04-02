# Trailhead Context Archive

Older session logs moved here when _context.md exceeds 15 sessions.

---

### 2026-03-26 10:00 ET — workflow cleanup
- Deleted `azure-static-web-apps-brave-glacier-00ea1c60f.yml` — was trying to deploy nyrr-viewer (Flask/App Service) to SWA with `output_location: "build"`, causing every push to main to fail
- Remaining SWA workflow (`orange-tree`) deploys mmr-webapp — output_location is `""`, correct for Next.js

### 2026-03-26 15:00 ET — repo cleanup
- Converted docs to markdown
- Fixed .gitignore (excludes secrets, binaries, .docx)
- Committed review-app
- Status: clean build, main branch

### 2026-03-26 23:15 ET — Azure nyrr-viewer DB connection fix
- Bug: MySQL "Access denied using password: NO" — DATABASE_URL was missing from Azure App Service env vars; gunicorn startup command had been accidentally pasted into that field instead
- Fix: Corrected DATABASE_URL value to `mysql://mmradmin:...@mmr-mysql-v4....:3306/mmrdb`; gunicorn command belongs in Configuration → General settings → Startup Command
- Note: load_env.sh referenced in CLAUDE.md doesn't exist at scripts/load_env.sh — actual file is load-env.sh at repo root; webapp uses web-apps/mmr-webapp/start-dev.sh
- Status: resolved, connection working

### 2026-03-26 23:28 ET — nyrr-viewer: permissions, auto-match, club code fixes
- Bug 1: `require_role` read stale session role set at login; admin@mmrunners.org got 403 "Insufficient permissions" if session predated their DB entry. Fix: re-query `get_user_role(email)` on every role-protected request and refresh session.
- Bug 2: No way to re-run auto-match on an already-loaded event. Added `POST /api/events/<id>/automatch` endpoint + "Auto-match" button in runner table toolbar.
- Bug 3: `unmatched_only` filter hardcoded `AND er.team_code = 'MMR'`, hiding all non-MMR unmatched runners even after "All runners" load. Removed constraint; renamed checkbox label "Unmatched MMR" → "Unmatched". Team scoping now handled by the existing team dropdown.
- Files changed: tools/nyrr-viewer/app.py, tools/nyrr-viewer/templates/index.html

### 2026-03-27 00:34 ET — nyrr-viewer: performance & UX fixes
- Bug 1: Auto-match endpoint called `get_db_connection()` but function is named `get_conn()` → NameError. Fixed.
- Bug 2: Sync-all-runners for large events (NYC Half 2026, 30K finishers) got 500 errors. Root causes: DB connection held open during long NYRR API pagination (~593 pages × 51 items) → timeout; 30K row-by-row INSERT statements in single transaction → slow, memory-heavy. Solution: Close DB connection during API fetch, batch inserts (500 rows/batch) with commit after each batch.
- Bug 3: "Admins" tab only visible to super_admin; regular admins couldn't see the admin list. Changed tab visibility to show for both admin & super_admin roles. API already enforces permissions (only super_admin can add/delete).
- Commit: 3acc92a

### 2026-03-27 01:00 ET — NYRR Viewer: server-side filters, default columns, per-user settings
- Fixed: Data Browser column filters now run server-side (SQL WHERE LIKE) — filtering works across all pages, not just the displayed page
- Added: Default hidden columns for `members` table (password_hash, *_sub, timestamps, payment fields, Notes, etc.)
- Added: `viewer_user_settings` MySQL table + REST API (`GET/PUT /api/user-settings/<table>`) for per-user column visibility, persisted in DB
- Frontend: Debounced filter input (400ms), "Clear filters" button, "All/None" column selector buttons, total count reflects filtered results
- Files changed: `tools/nyrr-viewer/app.py`, `tools/nyrr-viewer/templates/index.html`

### 2026-03-27 01:20 ET — NYRR Viewer: Tier-2 auto-match by first+last name
- Fixed: Auto-match only used `NYRRRunnerName` field (Tier 1). Added Tier 2: matches by `first_name`+`last_name` against `members.FirstName`+`members.LastName` when exactly one member has that name combo.
- New match_method value: `auto_firstlast` (vs existing `auto_name` for Tier 1)
- Applied to both: load flow (Phase 4) and re-run auto-match endpoint (`/api/events/<id>/automatch`)
- File changed: `tools/nyrr-viewer/app.py`

### 2026-03-27 01:40 ET — NYRR Viewer: auto version display
- Added: Version display in header showing git commit SHA + deploy date (e.g. `v3acc92a · Mar 27`)
- CI workflow writes `VERSION` JSON file at deploy time; `app.py` reads it (or falls back to live `git` for local dev)
- `/api/version` endpoint (no auth required) returns commit + deployed_at
- `VERSION` added to `.gitignore` (generated artifact)
- Files changed: `app.py`, `index.html`, `deploy-nyrr-viewer.yml`, `.gitignore`

### 2026-03-27 — NYRR Viewer: modular split of app.py into Flask Blueprints
- Refactored: Split monolithic `app.py` (1,863 lines) into 9 modules using Flask Blueprints: `db.py`, `helpers.py`, `auth.py`, `api_admin.py`, `api_events.py`, `api_runners.py`, `api_data.py`, `api_sync.py`, `app.py` (108 lines thin orchestrator)
- Added: `test_imports.py` — circular import detection test (subprocess-isolated, pytest-compatible)
- Import test passes clean: 7/9 modules verified, 2 skipped (nyrr_api not on sandbox path)
- Files changed: `tools/nyrr-viewer/app.py`, `tools/nyrr-viewer/templates/index.html` + 8 new files

### 2026-03-27 — Repo-wide pre-commit hook setup in .githooks/
- Added: `.githooks/pre-commit` — shared hook that runs `test_imports.py` when nyrr-viewer `.py` files are staged
- Configured: `git config core.hooksPath .githooks` for portable hooks across clones
- Documented in: `README.md`, `MONOREPO.md`, `tools/nyrr-viewer/README.md`, `web-apps/mmr-webapp/DEVELOPMENT.md`
- Files changed: `README.md`, `MONOREPO.md`, `tools/nyrr-viewer/README.md`, `web-apps/mmr-webapp/DEVELOPMENT.md`, `.githooks/pre-commit` (new)

### 2026-03-27 — CLAUDE.md overhaul: timestamps, file health, hooks, shell shortcuts
- Timestamp rule: Strengthened to MANDATORY — "No exceptions. Non-negotiable."
- Code health section (new): Hard limits on file size (400 lines Python, 300 TS, 500 HTML). Claude must proactively flag and offer to split oversized files.
- Pre-commit hooks section (new): Guidance for expanding `.githooks/pre-commit` as new tests become available.
- Shell shortcuts section (new): Documents user's .zshrc aliases.
- File changed: `CLAUDE.md`

### 2026-03-27 16:37 ET — refactor: moved nyrr-viewer to mmr-admin, restructured as admin ops hub
- Architectural decision: Consolidate admin functions into nyrr-viewer; rename to `mmr-admin`; move from `tools/nyrr-viewer/` to `mmr-admin/` at repo root.
- Changes: Moved `tools/nyrr-viewer/` → `mmr-admin/`; updated `.githooks/pre-commit`, `.github/workflows/`, `.gitignore`, `CLAUDE.md`, `MONOREPO.md`, `SETUP_SUMMARY.md`, `DEVELOPMENT.md`; created `deploy-mmr-admin.yml`, deleted `deploy-nyrr-viewer.yml`
- Files changed: 13 modified, 1 new workflow, 1 deleted workflow, directory structure refactored

### 2026-03-27 22:14 ET — Payment reconciliation module for mmr-admin
- New: `payment_actions.py`, `api_payments.py`, `static/payments.js`, `PAYMENTS_DESIGN.md`, `db/schemas/migration_v5_payment_statuses.sql`
- Modified: `mmr-admin/app.py` (registered payments_bp), `mmr-admin/templates/index.html` (Payments tab)
- Design: 2-step async workflow (submit → match → approve → fulfill). `webapp_events.Status` expanded to: pending, matched, approved, rejected, expired, error.
- Not yet done: Run migration on Azure DB, Sheets webhook endpoint, email notifications

### 2026-03-27 23:08 ET — Sheets sync on every member update + module split
- New: `sheets_sync.py` (162 lines), `payment_handlers.py` (405 lines)
- Refactored: `payment_actions.py` → thin orchestrator; `webhook.ts` rewritten (278 lines, handles 3 actions)
- Key change: Every `UPDATE members` in mmr-admin now auto-syncs to Google Sheets via fire-and-forget webhook POST
- Needs redeploy: `npm run build && npm run push` in web-apps/gas/membership, then Manage deployments → New version

### 2026-03-28 00:21 ET — Fix mmr-admin 503 + payments.js crash
- Root cause (503): Azure startup command still had `cd tools/nyrr-viewer &&` from before refactor. Fix: update via `az webapp config set` (manual step).
- Root cause (JS crash): `payments.js` re-declared `const { useState, ... } = React` already declared in `index.html`. Fix: removed duplicate destructuring.
- Updated: `DEPLOY_AZURE.md` — removed all stale `cd tools/nyrr-viewer` references.

### 2026-03-28 01:09 ET — Fix 8 bugs in mmr-admin (batch)
- Bug 6 (root cause): `match_method` ENUM missing `'auto_firstlast'` — Tier 2 auto-match silently failing. Added to schema + migration `0009_match_method_enum.sql`. Must run on Azure DB.
- Bug 1: favicon.ico 500 → added `/favicon.ico` route returning 204.
- Bug 5: Runner table pagination added (50/100/200/500/1000 per page).
- Bug 7: `/api/admin/refresh-sheets` endpoint + "Refresh from Sheets" button. Requires `GITHUB_TOKEN` env var on Azure.
- Bugs 3, 2, 8, 9: Error detail display, discover-upcoming timeout/logging, text color fix, scrollable table.
- Files changed: `db/schemas/nyrr.sql`, `db/schema_snapshot.sql`, `db/migrations/0009_match_method_enum.sql` (new), `mmr-admin/app.py`, `api_events.py`, `api_admin.py`, `templates/index.html`

### 2026-03-28 01:18 ET — Auto-Guess Payment Matching (Python + GitHub Action)
- New: `basecamp/ops/auto_guess_payments.py` (~280 lines) — Python port of GAS autoMatchUnmatchedPayments. Dry-run by default, `--commit` to write.
- New: `.github/workflows/auto-guess-payments.yml` — triggers after Sheets sync; manual dispatch with dry_run/date inputs.
- New: `/api/admin/auto-guess` endpoint + UI buttons in admin panel.
- Config needed: Set GitHub repo variables: `MEMBERSHIP_COLLECTION_START`, `MEMBERSHIP_COLLECTION_END`, `MEMBERSHIP_YEAR_END`, `INDIVIDUAL_PRICE`, `FAMILY_PRICE`

### 2026-03-28 09:52 ET — Fix /membership/inactive 401 from refresh-session
- Root cause 1: `JWT_SECRET` missing from GitHub Actions workflow `env:` block → API routes couldn't verify mmr_session in production. Action required: add `JWT_SECRET` as a GitHub Actions secret.
- Root cause 2: Page showed error on 401 instead of redirecting → `/login?from=...`. Fixed both auto-check and manual button paths.
- Files changed: `.github/workflows/azure-static-web-apps-*.yml`, `app/membership/inactive/page.tsx`

### 2026-03-28 10:28 ET — auto-guess: DATABASE_URL fallback + staleness checks
- `get_db_connection()` falls back to parsing `DATABASE_URL` when `MYSQL_*` vars absent
- Added fail-fast validation: missing dates, inverted window, stale (>60d past end), far-future typo (>366d ahead)
- GitHub Actions vars now set: `MEMBERSHIP_COLLECTION_START=2026-03-01`, `MEMBERSHIP_COLLECTION_END=2026-04-30`, `MEMBERSHIP_YEAR_END=2027-03-31`
- File changed: `basecamp/ops/auto_guess_payments.py`

### 2026-03-28 11:53 ET — Join flow refactor + hero text + Google Sheets sync
- Done: Hero badge EN/ZH. New `POST /api/members/enroll` (Step 2) saves member to MySQL, assigns MemberID, syncs to Sheets. Step 3 shows MemberID banner. `lib/sheets/sync.ts` supports local dev (file) and Azure SWA (env var JSON).
- Files changed: `app/(public)/page.tsx`, `app/(public)/join/page.tsx`, `app/api/members/enroll/route.ts` (new), `app/api/payments/submit/route.ts`, `lib/db/members.ts`, `lib/sheets/sync.ts` (new), `load-env.sh`, `package.json`
- Azure setup: Set `GOOGLE_SERVICE_ACCOUNT_JSON` and `GOOGLE_SHEETS_MEMBERSHIP_ID` as SWA Application Settings.

### 2026-03-28 12:02 ET — mmr-admin: fix env.local warning + match_method truncation
- Patched `mmr-admin/app.py` to skip `.env.local` load on Azure (checks `WEBSITE_SITE_NAME`).
- Migration 0009 not yet applied — must run `mysql-mmr < db/migrations/0009_match_method_enum.sql`.

### 2026-03-28 12:13 ET — mmr-webapp /join: inline validation + UX improvements
- `/join` info form: gender required + moved up, phone optional, `FieldErrors` state + `validateInfoField`, `onBlur` + submit-time validation, red border/hint on errors.
- `enroll/route.ts`: phone uses `z.preprocess` for empty→undefined, gender `z.enum` required, yearBorn range messages.
- Status: Run `npm run build` locally to verify (sandbox times out).

### 2026-03-28 12:48 ET — mmr-webapp: start-dev.sh pulls Google creds + DB from Keychain
- `start-dev.sh` now exports `GOOGLE_APPLICATION_CREDENTIALS` from `MMR_GOOGLE_CREDS_PATH` Keychain entry.
- `package.json` `dev` script calls `start-dev.sh` directly so `npm run dev` and `mmr-web` both get Keychain secrets.
- `dev:bare` added to bypass for CI/Azure.

### 2026-03-28 13:20 ET — mmr-admin: fix NYRR API + env path + Keychain fallback
- `api_events.py`: NYRR discover-upcoming URL updated to `widget.hakuapp.com`; API key moved to env var `NYRR_HAKU_API_KEY`.
- `app.py`: fixed `.env.local` relative path (`../..` → `..`); added Keychain fallback for `DATABASE_URL` when `.env.local` value is blank.
- Must set `NYRR_HAKU_API_KEY` in `.env.local` and Azure App Settings.

### 2026-03-28 16:30 ET — NYRR widget API fix: Haku endpoint auth & HTML parsing
- Problem: `/api/discover-upcoming` returned 403 from Haku widget API.
- Root causes: Missing `x-api-key` header; missing `Origin`/`Referer` headers; Haku returns HTML widget not JSON.
- Fixes: Added headers; changed `widget_scope` to single value `Endurance`; replaced JSON parser with regex HTML parser.
- Schema change: `nyrr_events.event_code` expanded to `VARCHAR(255)`. Migration: `ALTER TABLE nyrr_events MODIFY event_code VARCHAR(255);`
- Files changed: `mmr-admin/api_events.py`, `db/schemas/nyrr.sql`

### 2026-03-28 16:38 ET — fix sync_sheets_to_mysql clobbering webapp_events Status
- `basecamp/ops/sync_sheets_to_mysql.py`: removed `validate_status()` special-case; now uses `validate_enum_value()` everywhere (reads allowed values from live schema).
- Root cause: `validate_status()` mapped unknown values like `'approved'` → `'pending'`, corrupting 108 rows on every sync.
- Fixed and verified. Post-fix sync restored 108 rows to `approved`.

### 2026-03-31 21:12 UTC — Fix camelCase/PascalCase mismatch in all four GAS webhook tables
Root cause identified: GAS webhook returns TypeScript objects with **camelCase keys** (messageId, memberID, eventID, etc.), but MySQL schema uses **PascalCase** (MessageId, MemberID, EventID, etc.). This caused silent failures: "MessageId=None" in logs because Python code looked for 'MessageId' but received 'messageId'. Created `_normalize_gas_keys()` function with comprehensive CASE_MAP covering all four tables (Members, Events, Payments, Transactions). Applied normalization to all four webhook fetch operations. Next sync run will show correct PascalCase keys in logs, fixing "missing MessageId" skips. Committed 9160044. Status: Complete.

### 2026-03-31 21:05 UTC — Fix GAS email webhook scope + enhance transaction logging
Fixed two issues: (1) Removed invalid `email_type='sync_notification'` parameter from `send_generic_email()` call in `_send_sync_report()` (TypeError). Function doesn't accept this param; `email_type` is only for `send_email_webhook()`. (2) Enhanced `_import_transactions()` verbose logging to print first 3 example rows from Google Sheets with all field values in JSON format (helps debug why fields are coming back as None). Updated appsscript.json with gmail.send scope. Committed 2233226. Status: Complete — sync reports now send without error, logging shows actual transaction data.

### 2026-03-31 20:45 UTC — Add Google Sheets diagnostic module (api_sheets_diags.py)
Created new api_sheets_diags.py module (436 lines) with 8 diagnostic functions: (1) get_sheets_members()/payments/events/transactions() — read data from Google Sheets; (2) update_sheets_members/payments/events() — write updates to Sheets; (3) compare_sheets_vs_db() — sync health check comparing Sheets row counts vs MySQL. All functions use GAS webhook with rich debug output (row counts, sample columns, timestamps). Registered 8 functions in api_python_exec.py FUNCTIONS dict. Created SHEETS_DIAGS_GUIDE.md with detailed function docs, examples, and data flow. Verified: Python syntax OK, test_imports recognizes module. Status: Complete — ready for use in diagnosing sheet/DB sync issues.

### 2026-03-31 20:40 UTC — Split api_python_exec.py into modular components
Refactored code health: split api_python_exec.py (875→663 lines) by extracting 4 email diagnostic functions into new api_email_diags.py module (230 lines). Functions migrated: get_gmail_transactions_recent(), get_gas_webhook_config(), get_email_send_status(), analyze_email_flow(). Updated imports: api_python_exec.py now imports email diags from api_email_diags.py. FUNCTIONS registry updated to use imported functions. Verified: Python syntax OK, test_imports.py recognizes both modules. Status: Complete — modular architecture improves maintainability.

### 2026-03-31 20:37 UTC — Add GAS email pipeline diagnostic functions
Added 4 comprehensive diagnostic functions to trace email flow from webhook POST through GAS to database logging: (1) analyze_email_flow() — 4-point pipeline health check; (2) get_gas_webhook_config() — verify Config table has SheetsWebhookUrl; (3) get_gmail_transactions_recent() — query received emails from Gmail; (4) get_email_send_status() — check activity_log + Config table for send records. All registered in FUNCTIONS dict. Created GAS_EMAIL_DIAGNOSTICS.md (detailed guide: logging locations, data flow diagram, testing steps, troubleshooting). Changed: mmr-admin/api_python_exec.py (875 lines now, +222 lines). ⚠️ File now exceeds 400-line threshold — recommend splitting into api_email_diags.py module. Status: Complete — functions tested and deployable.

### 2026-03-31 20:29 UTC — Fix Python Exec table metadata + webhook_client import
Fixed two critical errors: (1) KeyError in api_python_exec.py line 418 — Azure MySQL returns `TABLE_NAME` in uppercase, not `table_name`. Changed list comprehension to `.get('table_name') or .get('TABLE_NAME')` for case compatibility. (2) ImportError in webhook_client.py line 39 — replaced non-existent `get_db_connection` with actual function `get_conn` from db.py. Both fixes tested. Status: Complete.

### 2026-03-31 16:35 UTC — Fix schema mismatch in Python Exec diagnostic functions
Fixed 5 diagnostic functions referencing non-existent tables: (1) `transactions` → `gmail_transactions` (get_sheet_vs_db_counts, check_transaction_dups, check_transaction_nulls, get_sample_transactions); (2) `sync_log` → `sync_metadata` + `sync_snapshots` (get_sync_status). Updated all column references (bib_id → TransactionNumber, deleted_at → IsArchived, etc.) to match current schema. All functions import cleanly (test_imports.py ✅). Changed: mmr-admin/api_python_exec.py. Status: Complete — diagnostic endpoints now query correct tables.

### 2026-03-31 23:45 UTC — Email webhook consolidation: Azure → GAS + Gmail
Consolidated all email sending from Azure SDK to GAS webhook + Gmail. Created: (1) email_hook.ts in GAS — handles `email_send` action, sends via Gmail, logs all emails to Email Log sheet (1G0dr2vjW-vMN0UbpxvzdBajmFSQLsiRbLd1A-36xk0I); (2) webhook_client.py in mmr-admin — replaces email_client.py, POSTs to GAS webhook instead of Azure SDK; (3) Updated payment_actions.py, api_sheets_sync.py, api_python_exec.py to use webhook_client. Removed Azure SDK dependency entirely. GAS builds cleanly. Python test_imports.py passes (webhook_client ✅). Status: Complete — ready to deploy GAS and configure webhook URL. See EMAIL_WEBHOOK_CONSOLIDATION.md for full migration guide.

### 2026-03-31 16:20 UTC — Fix Python Exec Engine + add comprehensive debug info
Fixed critical bug: replaced all `dbmod.get_db_connection()` with `dbmod.get_conn()` in 7 functions (AttributeError fix). Added extensive debug info to all functions: connection_status, queries_executed, row_counts, error_type, execution_time_ms. Enhanced logging with [PY_EXEC]/[CODE_EXEC] prefixes. Created PYTHON_EXEC_DEBUG_GUIDE.md (11 endpoints documented with curl commands), PYTHON_EXEC_CHANGES.md (technical summary), test_py_exec.sh (automated test script). All functions now return rich debug context for tracing. Committed 7b2491e. Status: Complete — ready for comprehensive testing.

### 2026-03-31 17:52 UTC — Fix Python Exec + add send_test_email() diagnostic function
Fixed Python Exec function list loading (was checking non-existent r.ok flag). Added send_test_email() function: sends branded HTML test email via Azure Communication Services to admin@mmrunners.org, matching production email template style. Helps verify email pipeline is working. Committed 9179702.

### 2026-03-31 12:50 UTC — Add email sending logging to debug why sync reports aren't received
Added comprehensive email logging to track send attempts and failures. Changed: (1) Enhanced send_email() to return detailed result dict (success, status, error, timestamp); (2) Updated _send_sync_report() to capture email results and log to sync log; (3) All sync operations now log email success/failure with reason; (4) Created EMAIL_DEBUG.md with troubleshooting workflows (test emails from Python Code, check Azure config, query logs). Status: Complete — ready to test. Next: Test sync operations and verify emails are sent and logged.

### 2026-03-31 12:45 UTC — Add verbose debug logging & debug helpers for all sync operations
Added comprehensive debugging capabilities for all sync operations (members, events, payments, transactions). Changed: (1) Enhanced all sync functions with verbose logging showing raw Google Sheets + MySQL data (first 3 rows, column names); (2) Created sync_debug_helpers.py module with callable functions (get_google_*_for_debug, compare_*, show_*_diff) accessible from Python Code Editor; (3) Enhanced result tracking (separate skipped counts, return IDs); (4) Improved datetime comparison with proper parsing. Status: Complete — ready to deploy. Next: Test verbose logs in Azure, use helpers from Python Code Editor for debugging.

### 2026-03-31 12:40 UTC — Add Python Code Editor to admin portal
Added dynamic code execution tab: Users can now write & run arbitrary Python code against MySQL with output capture. Changed: (1) New /api/py-exec/code endpoint — executes Python code with access to query(), execute(), datetime, json, traceback; (2) "Python Code" tab in admin portal with textarea editor, 5 example templates (count, sync log, dups, nulls, pretty-print), output viewer, error traceback, download results; (3) Code runs in sandboxed environment with full DB read-write access. Status: Complete — ready to test. Next: Deploy and validate code execution.

### 2026-03-31 12:35 UTC — Add Python Execution Engine to admin portal
Created Python diagnostic engine to debug import issues without localhost. Changed: (1) New api_python_exec.py blueprint with 6 safe, read-only diagnostic functions (get_sheet_vs_db_counts, get_sync_status, check_transaction_dups, check_transaction_nulls, get_sample_transactions, test_db_connection); (2) Added UI tab "Python Exec" in index.html with function selector, result viewer, JSON download; (3) Registered blueprint in app.py. Status: Complete — ready to debug why imports show 0 inserted/updated. Next: Run diagnostics to identify why Google Sheets rows aren't syncing to MySQL.

### 2026-03-30 05:10 UTC — Fix GAS webhook & email service
Fixed two production errors: (1) Changed `get_gmail_transactions` → `get_transactions` in api_sheets_sync.py line 820 to match GAS webhook handler. (2) Removed SendGrid, switched to Azure Communication Services for email (no account needed, integrated with Azure stack). Sender: DoNotReply@mmr-comm.notification.azure.com (auto-verified). Committed b966b9f.

## Current state

- Repo: Sync tab with batched webhook calls + retry logic
- mmr-admin: api_sheets_sync.py (1253 lines) with all sync operations + batching + retries
- Batching implemented:
  * All MySQL→Google ops (members, events, payments, gmail_transactions) batch at 200 rows/call
  * Retry logic: 3 attempts with exponential backoff (1s, 2s, 4s)
  * Timeout increased 30s → 60s
  * Partial batch failure doesn't abort entire sync
- Bug fixes:
  * Email parameter: to_address → to, html_body → html_content
  * GAS webhook: timeout + retry logic
  * Gmail transactions: added MySQL→Google sync for Notes & ProcessedTime
- Documentation: SYNC_BATCHING_STRATEGY.md + SYNC_WEBHOOK_BATCHING.md (detailed analysis)
- All systems functional (NYRR sync, payments, query, admin)

## Open items

- Deploy to Azure and test batching with real GAS webhook
- Verify email reports sent to admin@mmrunners.org
- Monitor sync performance: verify 1000+ rows sync without timeout
- Add rate limiting if GAS API is called too frequently

## Session log

### 2026-03-30 10:36 UTC — Fix gmail_transactions import + add unprocessed transactions sync UI
Changed: (1) Fixed import bug: `get_transactions` → `get_gmail_transactions` on line 820 of api_sheets_sync.py (webhook was failing silently, 0 rows imported). (2) Added new function `_sync_unprocessed_transactions_to_sheets()` to sync only unprocessed txns (ProcessedTime IS NULL) from MySQL to Sheets. (3) Added API endpoint `/api/sync/unprocessed-transactions` + UI tab "🔄 Sync Unprocessed Txns" in Sync panel. Status: Backend ready, UI complete. Next: Restart mmr-admin and test the import fix; verify 4 rows now sync.

### 2026-03-30 10:22 UTC — Add webhook batching + email fix + gmail_transactions sync
Changed: (1) Fixed email param mismatch (to_address→to, html_body→html_content); (2) Added retry logic to GAS webhook (3 retries, 1s/2s/4s backoff, 60s timeout); (3) Added _sync_gmail_transactions_to_sheets() for MySQL→Google Notes/ProcessedTime; (4) Refactored all MySQL→Google syncs to batch at 200 rows/call to prevent timeout. Status: Syntax verified, documentation complete. Next: Deploy and test with 1000+ row datasets.

### 2026-03-30 20:31 UTC — Pause all data sync workflows except schema drift check
Changed: Disabled schedules for sync-all-sheets-ordered (every 6h), sync-nyrr-weekly (Tue 2 AM), update-member-status, auto-guess-payments. Deleted 5 legacy disabled workflows (sync-members/payments/gmail/webapp/sheets-to-mysql). Status: Complete — all manual-only, db-schema-drift still runs weekly. Next: Resume workflows when ready.

### 2026-03-30 02:47 UTC — Fix MySQL→Google sync: Decimal serialization & EventStatus column
Changed: (1) Fixed JSON serialization error in payments sync by handling Decimal type in _serialize_row(); (2) Fixed EventStatus → Status column name error in 2 event queries; (3) Enhanced payment debug output to show paymentId: amount, memberID, memberName. Status: Complete — syntax check passed, all fixes applied. Next: Run sync and verify all three operations succeed.

### 2026-03-30 19:24 UTC — Always send email reports from sync operations
Changed: Added email sending to all sync error handlers (members, events, payments, import, dry-run). Previously only sent email on success. Now always sends report with full log, even on error. Ensures admins see failures and can debug. Status: Complete. Next: Test and verify email delivery.

### 2026-03-30 19:15 UTC — Fix datetime serialization in Python sync code
Changed: Added _serialize_row/rows helpers to convert datetime objects to ISO strings before sending to GAS. Applied to all append/update operations (members, events, payments). Removed "skipped (Sheets newer)" log lines. Status: Complete. Next: Test MySQL→Google sync with real data.

### 2026-03-30 19:08 UTC — Add 9 batch sync handlers to GAS webhook
Changed: Implemented get_members, get_events, get_payments, append_members/events/payments, update_members/events/payments. Added helper converters (rowToXxxObject, xxxObjectToRow) to handle array↔object mapping. Status: Complete (418 lines, all compile). Next: Deploy new GAS version and retry MySQL→Google sync operations from mmr-admin.

### 2026-03-30 19:02 UTC — Fix get_transactions response format for Python integration
Changed: Wrapped get_transactions response under 'data' key to match _call_gas_webhook contract. GAS now returns { ok: true, data: [...] } instead of { ok: true, transactions: [...] }. Status: Ready to deploy. Next: Redeploy GAS version and retry Import Now — should now fetch all messageIds from Fetch-Gmail sheet.

### 2026-03-30 18:57 UTC — Add get_transactions GAS webhook handler
Changed: Added `handleGetTransactions()` to webhook.ts (reads all gmail_transactions from Fetch-Gmail sheet). Status: Complete — compiles, ready to deploy. Next: Deploy new GAS version and test Import Now from mmr-admin.

### 2026-03-31 02:30 UTC — Implement full GAS integration for sync operations
Changed: Implemented _call_gas_webhook() helper (30 lines); completed all 5 sync functions with actual GAS calls. Members/Events/Payments: fetch from Sheets, compare by ID with LastUpdated versioning, push append/update actions. Import: insert new MessageIds, update Notes if Memo differs. Dry-run: compare all tables, display diffs. File grew from 410→919 lines (40KB). Status: LIVE and ready for deployment. Next: Test with real GAS webhook in staging/production.

### 2026-03-31 02:23 UTC — Add Sync tab and fix gmail_transactions bug
Changed: Created api_sheets_sync.py with MySQL→Google/Import/dry-run endpoints; added SyncPanel UI with 3 subtabs to index.html; registered blueprint in app.py; fixed bug in payment_actions.py (3 locations) writing Source→Notes. Status: Code complete, tests pass. Next: Integrate GAS webhook calls to fetch/push actual Sheets data.

### 2026-03-31 01:47 ET — Add Data Query tab to mmr-admin
Changed: New `api_query.py` with `/query` route + `query.html` UI. Super-admins get full SQL, regular admins get SELECT-only. Dual table/JSON output, quick ref sidebar. Updated `app.py` blueprint + nav link. Status: Ready for testing. Next: Deploy and verify queries work from admin portal.

### 2026-03-31 01:38 ET — Fix Payments CC email + Sheets sync
Changed: Fixed `send_email()` dict-spread bug causing `TypeError` when CC was set; improved `_post_to_sheets` error logging to surface missing `SheetsWebhookUrl` or GAS HTTP errors. Status: Code fixed; verify `SheetsWebhookUrl` is set in MySQL config table. Next: Check nyrr logs after next approval to confirm Sheets sync fires.

### 2026-03-30 21:14 ET — cancel button + suppress not_found modal
Changed: Added POST /api/load/<event_code>/cancel endpoint; worker checks cancel_requested flag after each page batch and raises InterruptedError → sets status=cancelled. Modal now shows Cancel button while running, 🛑 Cancelled state + Close on done. Suppressed not_found flash between polls. Status: Done. Next: Test cancel on stuck H2026 load; monitor log splitting path via nyrr-logs.

<!-- Newest session first. Format: ### YYYY-MM-DD HH:MM UTC — short title -->

### 2026-03-30 15:03 ET — Gmail quick-approve + layout overhaul
Changed: Gmail table full-width, Pending Events collapsible. Added ⚡ Quick Approve inline popover to Gmail rows — extracts MemberID from memo, pre-fills dropdown + payment type from amount, calls admin-create. Also: GITHUB_REPO fix, checkbox multi-select on events, Approve All Matched / Auto-Guess & Approve All buttons. Status: all in static/payments.js + api_admin.py. Next: Gmail sheet ProcessTime+PaymentID sync (item 8).

### 2026-03-30 23:30 UTC — Restore progress modal + add team size splitting

- Changed: `mmr-admin/templates/index.html` — added `SimpleProgressModal` component with 1.5-second polling on `/api/load/<event_code>/status`. Shows step, runner count, teams processed. Auto-closes when job done/error. Updated `triggerLoad()` to open modal and refresh events after completion.
- Changed: `mmr-admin/api_sync.py` Step 3 — added `_process_team_runners()` helper to split teams >500 by gender first, then by 5-year age groups if needed. Uses existing `_upsert_team_runners()` batching logic. Handles large clubs that exceed pagination limits.
- Status: Complete. Progress modal restored; large teams now split intelligently to avoid NYRR API pagination issues.
- Next: Test on staging with H2026/M2025 events. Verify no load timeout and team_code backfill completeness.

### 2026-03-30 20:28 UTC — Integrate pace splitting into api_sync.py Step 1

- Changed: `mmr-admin/api_sync.py` — added helpers `_pace_to_seconds()`, `_seconds_to_pace()`, and `_split_by_pace()` for recursive pace-range binary-splitting. Updated `_probe()` and `_upsert_pages()` signatures to accept pace_min/pace_max filters. Modified `_divide_and_conquer()` to call `_split_by_pace()` when age+gender combo still >1000 after all age/gender splits. When triggered, estimates max pace as 00:20:00 and recursively halves pace ranges until each shard ≤500 items.
- Status: Complete. api_sync.py Step 1 now auto-handles >1000 groups via pace-splitting.
- Next: Test on H2026/M2025 staging; validate fetch completeness; monitor queue/API times.

### 2026-03-30 04:56 UTC — Implement complete email system for Azure migration
- Changed: Phase 1 (mmr-webapp) — `lib/email/client.ts` added CC parameter support + updated 3 email functions (welcome, application, renewal) to CC admin@mmrunners.org. `lib/email/templates.ts` added 4 new templates (paymentRejected, paymentExpired, expirationRepaired, autoMatchConfirmation). Phase 2 (mmr-admin) — created `email_client.py` with Azure Communication Services integration + `email_templates.py` with 3 payment templates. Integrated emails into `payment_actions.py` approve/reject functions. Updated 9 GitHub Actions workflows to CC admin@mmrunners.org. Created comprehensive documentation (5 markdown files).
- Status: Complete. 10 email types implemented (7 in webapp, 3 in admin), all beautiful HTML + CC admin@mmrunners.org + plain-text fallback + error handling. Both systems ready for production.
- Next: Set environment variables, test on staging, validate email delivery, deprecate GAS after 2-week transition.

### 2026-03-29 23:42 UTC — Add CC: admin@mmrunners.org to all user/system emails
- Changed: `web-apps/gas/membership/src/email.ts` — updated 8 notification functions (notifyPaymentApproved, notifyPaymentRejected, notifyPaymentExpired, notifyAutoGuessMatch, notifyExpirationRepaired, notifyWelcome, notifyIncompleteSignup, notifyRenewalReminder) to CC `admin@mmrunners.org` in addition to primary admin email. Updated 9 GitHub Actions workflows (.github/workflows/*.yml) — added `cc: 'admin@mmrunners.org'` to 18+ email notification steps across sync-nyrr-weekly, sync-all-sheets-ordered, auto-guess-payments, sync-members-recurring, sync-payments-recurring, sync-gmail-transactions-recurring, update-member-status, db-schema-drift, sync-webapp-events-recurring workflows.
- Status: Complete. All user-facing and system emails now CC admin@mmrunners.org for audit/oversight.
- Next: Deploy changes; verify CC recipient receives emails without spam flagging.

### 2026-03-29 22:02 UTC — Add one-click bulk export (all districts as ZIP)
- Changed: `mmr-admin/api_district_members.py` — added POST `/api/district/export-all-districts` endpoint. Fetches all districts, generates one CSV per district with same status/renewal filters, zips them, returns as single ZIP download. `mmr-admin/static/DistrictMembersPanel.js` — added `exportAllDistricts()` function and green "Export All Districts" button (applies current status + renewal filters across all districts).
- Status: Complete. One-click export: generates separate CSV per district, respects selected filters.
- Next: Test on Azure; verify ZIP generation and filter application across districts.

### 2026-03-29 21:18 UTC — Add Members by District view for group leaders
- Changed: Created `mmr-admin/api_district_members.py` — new blueprint with 3 endpoints: `/api/district/list` (fetch members by district with filters), `/api/district/districts` (dropdown list), `/api/district/export-csv` (POST to export selected or all members in district as CSV). Created `mmr-admin/templates/DistrictMembersPanel.js` — React component with district selector, member table (cols: MemberID, Name, WeChat ID, Email, Phone, Status, Last Login, Last Modified, Expires), checkboxes for multi-select, export buttons. `mmr-admin/app.py` — registered district_members_bp. `mmr-admin/templates/index.html` — added script import + new tab "Members by District" with conditional rendering.
- Status: Complete. Feature-ready for group leaders to view/select members and export CSVs.
- Next: Test on localhost with actual district data; verify CSV export formatting + download flow.

### 2026-03-29 17:45 UTC — Match all runners + member status tooltip
- Changed: `mmr-admin/api_events.py` — `/api/events/<id>/runners` endpoint now joins members table to fetch `member_status` (Active/Inactive). `mmr-admin/templates/index.html` — matched column badge now shows member status on mouse hover via `title` attribute.
- Status: Complete. Matching applies to all runners in event (not MMR-only), accounts for members running under other club names.
- Note: Matching scope is intentionally all runners, not filtered by team_code; members table represents MMR roster.

### 2026-03-29 17:35 UTC — Enhanced matching: auto-update members table + age/gender validation
- Changed: `.github/workflows/sync-nyrr-weekly.yml` — changed from Sunday to **Tuesday 2 AM UTC**; removed daily job (sync-nyrr-recurring.yml); added finisher count audit step before main sync. `mmr-admin/api_events.py` — all three match tiers (Tier 1: NYRR name, Tier 2: first+last, Tier 3: partial) now: (1) auto-update members.NYRRRunnerName + members.YearBornGuess when match found, (2) validate age if member has YearBorn or YearBornGuess (±1 year tolerance), (3) validate gender match (case-insensitive first letter). Validation only applies if member has birth year; skips if none.
- Status: Complete. Consolidated NYRR jobs to Tuesday weekly. Finisher audit + full sync in one run.
- Next: Run migrations 0013 + 0014; commit changes; monitor first Tuesday run for match quality improvements.

### 2026-03-29 17:15 UTC — Implement finisher count audit + partial name matching (Tiers 1–3)
- Changed: `db/migrations/0013_add_nyrr_finisher_count.sql` — added `nyrr_finisher_count` column to track NYRR API finisher totals. `db/migrations/0014_add_auto_partial_name_match_method.sql` — extended match_method ENUM to include 'auto_partial_name'. `db/schemas/nyrr.sql` — updated schema to reflect both changes. `mmr-admin/api_sync.py` — store total_finishers from NYRR API (fixed to use _probe() without age limits) and populate nyrr_finisher_count on sync completion. `mmr-admin/api_events.py` — added Tier 3 auto-match: partial name matching (first name OR last name match).
- Status: Complete. Ready to run migrations and deploy.
- Next: Enhanced matching with member table updates + validation.

### 2026-03-29 12:17 ET — Fix 4 open items: title, upcoming events, GITHUB_TOKEN, NYRR links
- Changed: `mmr-admin/templates/index.html` — (1) updated `<title>` to "MMR Admin Portal"; (2) removed upcoming events rendering from Events tab (only show past events now, fix for "Completed" status confusion). `mmr-admin/app.py` — (3) enhanced Keychain loading to include GITHUB_TOKEN from `MMR_GITHUB_TOKEN`. `load-env.sh` — added GITHUB_TOKEN loading. `mmr-admin/api_events.py` + `basecamp/ops/sync_nyrr_events.py` — (4) fixed event URL format: `/events/{code}` → `/event/{code}/finishers`. Created migration `0012_fix_nyrr_event_urls.sql` to correct existing URLs in DB.
- Status: All 4 items complete. Upcoming events hidden, title updated, GITHUB_TOKEN Keychain support added, event links fixed.
- Next: Run migration 0012, test UI to confirm past events only; add GITHUB_TOKEN to Keychain per user's PAT.

### 2026-03-29 15:06 ET — Fix Azure deployment: add _paginate_streaming to basecamp NyrrApiClient
- Changed: `basecamp/python/nyrr_api.py` — added `_paginate_streaming()` generator method (was missing, only in mmr-admin version). Azure deployment failed with `AttributeError: 'NyrrApiClient' object has no attribute '_paginate_streaming'` because import path resolved to basecamp version.
- Status: Fixed. Both nyrr_api.py versions now in sync for streaming pagination.
- Next: Commit and redeploy to Azure.

### 2026-03-29 01:47 ET — Implement divide-and-conquer sync via age/gender split + MMR-first pass
- Changed: `mmr-admin/api_sync.py` STEP 1 — replaced searchString loop with binary-tree divide-and-conquer on age (0–100). New `_probe()` helper tests totalItems for filter combo cheaply (pageSize=1). New `_divide_and_conquer(age_from, age_to, gender)` recursively bisects age range until ≤1000, then: ≤500 → 1 pass, 501–1000 → asc+desc passes, >1000 & age_from==age_to → split by gender (M/W/X) + ungendered. Pass 0 always fetches teamCode=MMR first (MMR members, all ages). Added `probe_finishers.py` tool to test any filter combo against API (supports age range, gender, state, country, team, etc.).
- Status: Syntax verified. Ready to test on large event (target: handle 30K+ via MMR pass + age/gender bisect).
- Next: Test on H2026; monitor logs to verify age splits + gender splits activate as needed.

### 2026-03-28 20:20 ET — Refactor: stream NYRR finishers per-page + batch team updates
- Changed: `nyrr_api.py` — added `_paginate_streaming()` generator that yields pages instead of buffering all items. `api_sync.py` STEP 1 now uses streaming to write each page (~50 runners) immediately to DB; eliminated 500-item buffer. STEP 3 now batches team updates in 100-runner batches instead of individual UPDATEs—less transaction overhead, fewer lock timeouts.
- Status: Refactored. Syntax verified. Streaming reduces memory footprint + catches DB connection issues early + incremental progress saves.
- Next: Test on next sync run; expect faster, more resilient pipeline.

### 2026-03-28 19:56 ET — Clean up: remove ALL admin functionality from mmr-webapp SWA
- Deleted: Entire `web-apps/mmr-webapp/app/admin/` directory including 6 pages (admin dashboard, NYRR events list, event detail, member detail, match review, sync status) + 2 API routes (`/api/admin`, `/api/admin/sync-status`) + orphaned `components/ProgressModal.tsx` component. All admin functionality now lives exclusively in `mmr-admin/` Flask app on Azure WA.
- Status: Complete. TypeScript build passes. No broken imports. mmr-webapp now member-facing only. Admin APIs in webapp removed; member-facing APIs (`/api/nyrr/*` for portal) retained.
- Next: None—mmr-webapp separation is clean. Admin UI fully migrated to mmr-admin.

### 2026-03-28 19:48 ET — Dashboard: query live runner counts instead of stale cached columns
- Changed: `mmr-admin/api_events.py` — replaced all 3 endpoints (`/api/events`, `/api/events/<id>`, `/api/stats`) to query **LIVE counts from `nyrr_event_runners` table** instead of cached `mmr_runner_count` column. Now calculates: total runners, MMR runners (team_code='MMR'), matched runners (mmr_member_id IS NOT NULL). Dashboard will show real "2 MMR runners" instead of stale "100".
- Status: Complete. No cached data—all counts computed per-request from live DB state.
- Next: Reload mmr-admin UI and verify dashboard shows correct live counts.

### 2026-03-29 00:02 ET — Remove 500-runner cap via team enrichment in Step 3
- Changed: `mmr-admin/api_sync.py` — Step 3 now INSERTs missing runners from `teams/teamRunners` calls, not just UPDATEs. Root cause: `runners/finishers-filter` endpoint returns ~500 results (NYRR API limit), but `teams/teamRunners` returns ALL team members (~13K for NYC Half). Step 3 now captures full dataset. If runner missing from DB (Step 1), INSERT with full details + team_code. Added `total_inserted` tracking.
- Status: Ready to test. NYC Half should now load all finishers.
- Next: Trigger re-sync of H2026 to verify all ~13K runners load.

### 2026-03-28 19:35 ET — mmr-admin UI: progress modal displays real backend data
- Changed: `mmr-admin/templates/index.html` — fixed ProgressModal to display **real backend data** from job status: `message` (human-friendly desc), `rows_written` (actual runner count), `teams_processed` (team progress), `step` (current step id). Modal subtitle now shows dynamic message from backend instead of hardcoded "30,000+ runners". Step detail text shows actual counts: "200 runners fetched", "5 teams found", "5 teams processed".
- Status: Complete. Modal now pulls all text from backend via polling `/api/load/{eventCode}/status`. Tested with 200-person event—now shows "200 runners fetched" instead of generic "30,000+".
- Next: Test locally to verify real-time updates display correctly.

### 2026-03-28 23:45 ET — Fix NyrrTeam dataclass bug
- Changed: `mmr-admin/nyrr_api.py` — added missing `@dataclass` decorator to `NyrrTeam` class (line 247). This was causing "object is not subscriptable" error on event detail page.
- Status: Fixed. Error was preventing event details from rendering.
- Next: Test event detail page to confirm fix works.

### 2026-03-28 19:30 ET — mmr-admin UI: progress modal for 30K runner load
- Changed: `mmr-admin/templates/index.html` — added ProgressModal React component with 3-step progress tracking (Fetch finishers → Enumerate teams → Backfill team codes). Added CSS for modal, progress bar, step icons (○ pending, ↻ active, ✓ completed). Enhanced Dashboard state with `progressModal`. Modified `triggerLoad()` to open modal on load start, poll status every 1s (was 2s), display real-time counts (rows_written, teams_processed), auto-close on done/error.
- Status: Complete. Modal shows when data loads, displays step-by-step progress with percentage bar, closes automatically.
- Next: Test locally by triggering a load in mmr-admin UI.

### 2026-03-28 19:19 ET — NYRR admin runners table: added progress modal during load
- Changed: Created `components/ProgressModal.tsx` — modal showing step-by-step progress (pending/active/completed states) with progress bar. Updated `app/admin/nyrr/events/[id]/page.tsx` — added progress state tracking for event + runners loads, integrated ProgressModal. Steps show real-time count during fetch.
- Status: Reverted (moved to mmr-admin instead, which is the correct location).
- Next: Use mmr-admin Flask UI progress modal instead.

### 2026-03-28 18:35 ET — CLI mode for api_sync.py + comprehensive debug logging
- Changed: `mmr-admin/api_sync.py` — added `import time`, set logger.DEBUG, inserted debug logs throughout (Step 1–3, upsert, backfill, errors); added `__main__` block to support standalone CLI with `--event`, `--force`, `--debug` args; outputs final summary with exit code 0/1. Created `CLI_USAGE.md` and `DEBUG_ENHANCEMENTS.md` guides.
- Status: Complete. CLI fully functional; database connection test succeeded. Now supports `python3 api_sync.py --event H2026 --debug` with real-time logging, suitable for cron/monitoring.
- Next: Test end-to-end once Azure MySQL is accessible; consider adding `--dry-run` or progress webhook callback.

### 2026-03-28 14:31 ET — Events UI: Split upcoming vs past events
- Changed: `mmr-admin/templates/index.html` — updated `renderTable()` to accept `isPast` flag. Conditional render "Action" column header + Load/Re-sync button only for past events.
- Status: Complete. Upcoming events show clean info columns (no action buttons). Past events retain runner matching & loading.
- Next: Test UI to confirm layout.

### 2026-03-28 22:16 ET — UI improvements & NYRR API proxy debug
- Changed: `templates/index.html` — split Events table into two sections (Upcoming/Past) by date. `nyrr_api.py` — fixed NameError in error handler (added logging import); added logger.error() for 400+ responses; disabled session.trust_env to bypass system proxy for NYRR API calls.
- Status: Events separation complete. NYRR API 400 error root cause identified: system proxy (allowlist blocks rmsprodapi.nyrr.org). Code fix applied; network policy blocks local testing. Sync works in Azure (different network policy).
- Next: Test with different network or deploy to Azure to verify fix.

### 2026-03-28 17:57 ET — NYRR Viewer: Final Simplified Design (Three-Step Sync)
- Changed: `db/migrations/0011_rebuild_nyrr_event_runners.sql` — simplified schema (removed `sync_source` ENUM, added `age_grade_*`). `mmr-admin/api_sync.py` — complete rewrite for three-step workflow: (1) finishers-filter paginate all runners, (2) teams/search enumerate all teams, (3) teams/teamRunners backfill team_code by bib. Single upsert path. `templates/index.html` — removed MMR/All toggle, now just "Sync all runners + teams" button.
- Status: Ready to test. Run migration 0011, deploy api_sync.py + UI. Test H2026 (30K runners, 584 teams).
- Next: Delete api_sync_old.py, run migration, test sync.

### 2026-03-28 17:18 ET — nyrr_event_runners: full schema rebuild
- Changed: `db/migrations/0011_rebuild_nyrr_event_runners.sql` — DROP + recreate with bib as dedup key, `nyrr_runner_id` NULL-able, added `city`, `sync_source ENUM('finishers','mmr_team','both')`, removed old `uq_event_runner`. `db/schemas/nyrr.sql` updated. `mmr-admin/api_sync.py` — split upsert into two SQL paths; `sync_source` transitions to `'both'` when both have run. 0010 superseded by 0011.
- Status: Must run migration 0011 (`mysql-mmr < db/migrations/0011_rebuild_nyrr_event_runners.sql`). 0010 no longer needed.
- Next: Test sync on a small event then NYC Half. Verify `sync_source='both'` for MMR runners after two-pass load.

### 2026-03-28 17:06 ET — NYRR viewer: filter debounce, dedup, pagination, cleanup
- Changed: `templates/index.html` — DB table filter debounce 400→800ms + fire on Enter/Tab; added "Clear all runners" dropdown item. `api_sync.py` — upsert deduplicates on `(event_id, bib_number)`; only `sync_source='all'` updates `nyrr_runner_id`; new `DELETE /api/events/<id>/runners` endpoint. `nyrr_api.py` — `DEFAULT_PAGE_SIZE` 51→500; added `total`-based stop condition + `progress_cb`. New migration: `db/migrations/0010_nyrr_runner_bib_unique.sql`.
- Status: Migration not yet run. Must run `mysql-mmr < db/migrations/0010_nyrr_runner_bib_unique.sql` before deploying.
- Next: Run migration, test sync on NYC Half, verify no duplicates after MMR+all sync.

### 2026-04-02 09:25 ET — fix family member add crash
Changed: Renamed `family_members`→`members` and `remaining_family_members`→`members` in `api_members.py` add/remove endpoints to match frontend shape. Status: Fixed. Next: Deploy backend.

### 2026-04-02 09:24 ET — Import Transactions: debug logging for GAS webhook + ProcessedTime parse failures
Changed: `api_sheets_sync.py` — added raw pre-normalization webhook payload logging (keys + 3 rows), per-row ⚠️ when `ProcessedTime` is non-empty but unparseable (EV- IDs appearing in wrong column), failure count in final job result. Status: Done. Next: Run import, check job log for raw column names and ⚠️ rows to identify GAS column mapping bug; also investigate multi-instance job-not-found on Azure.

### 2026-04-02 09:14 ET — Payments: debug logging for Auto-Match / Auto-Guess & Approve
Changed: `payment_actions.py` — added `logger` + verbose DEBUG per-row rejection in `find_gmail_match`, INFO stats in `run_auto_match`; `api_payments.py` — caller + full stats logged in `api_auto_match`; `app.py` — `basicConfig` respecting `LOG_LEVEL` env var; `payments.js` — `console.log` throughout both button handlers. Status: Done. Next: Deploy, set `LOG_LEVEL=DEBUG` in App Settings to see per-row detail, then share browser console + Azure log stream output.

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


