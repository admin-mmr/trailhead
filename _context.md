# Trailhead Project Context

Last updated: 2026-03-27
Last commit: 3acc92a

---

## Current state

- Repo cleaned up: .gitignore, markdown conversion, review-app committed
- Web app: Next.js 14, NextAuth, Tailwind, i18n — deployable
- Photo manager: process_photos.py + bib_analyzer.py functional, review-app Flask running
- Database: Azure MySQL, schemas in db/schemas/
- NYRR viewer: Flask app, stable

## Open items

- [ ] (add open tasks here)

## Session log

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
- Bug 2: Sync-all-runners for large events (NYC Half 2026, 30K finishers) got 500 errors. Root causes:
  - DB connection held open during long NYRR API pagination (~593 pages × 51 items) → timeout
  - 30K row-by-row INSERT statements in single transaction → slow, memory-heavy
  - Solution: Close DB connection during API fetch, batch inserts (500 rows/batch) with commit after each batch
- Bug 3: "Admins" tab only visible to super_admin; regular admins couldn't see the admin list. Changed tab visibility to show for both admin & super_admin roles. API already enforces permissions (only super_admin can add/delete).
- Commit: 3acc92a

### 2026-03-27 16:37 ET — refactor: moved nyrr-viewer to mmr-admin, restructured as admin ops hub
- **Architectural decision:** Consolidate admin functions (NYRR data mgmt, member admin, reporting) into nyrr-viewer. Rename to `mmr-admin` to reflect broader scope. Move from `tools/nyrr-viewer/` to `mmr-admin/` at repo root (first-class service).
- **Changes:**
  - Moved `tools/nyrr-viewer/` → `mmr-admin/` (directory rename)
  - Removed empty `tools/` directory
  - Updated `.githooks/pre-commit` — paths now reference `mmr-admin/` instead of `tools/nyrr-viewer/`
  - Updated `.github/workflows/` — created `deploy-mmr-admin.yml`, deleted `deploy-nyrr-viewer.yml`
  - Updated `.gitignore`, `CLAUDE.md`, `MONOREPO.md`, `SETUP_SUMMARY.md`, `DEVELOPMENT.md` — all references updated
  - Updated all Python docstrings and README
  - Azure resource remains named `mmr-nyrr-viewer` (can be renamed later; custom domain hides internal name)
- **Next: Payment approval system**
  - Need to implement payment approval/rejection in mmr-admin
  - Will add `api_payments.py` module with endpoints for approving/rejecting payment proofs
  - Approval updates `members.Status` → `active`, `members.Expiration` → 1yr, etc.
  - Will add Payments UI tab in admin dashboard
- **Files changed:** 13 modified, 1 new workflow, 1 deleted workflow, directory structure refactored
- **Status:** Milestone complete, ready for testing. Next thread: implement payment approval system.

### 2026-03-27 01:00 ET — NYRR Viewer: server-side filters, default columns, per-user settings
- **Fixed:** Data Browser column filters now run server-side (SQL WHERE LIKE) — filtering works across all pages, not just the displayed page
- **Added:** Default hidden columns for `members` table (password_hash, *_sub, timestamps, payment fields, Notes, etc.)
- **Added:** `viewer_user_settings` MySQL table + REST API (`GET/PUT /api/user-settings/<table>`) for per-user column visibility, persisted in DB
- **Frontend:** Debounced filter input (400ms), "Clear filters" button, "All/None" column selector buttons, total count reflects filtered results
- Files changed: `tools/nyrr-viewer/app.py`, `tools/nyrr-viewer/templates/index.html`

### 2026-03-27 01:20 ET — NYRR Viewer: Tier-2 auto-match by first+last name
- **Fixed:** Auto-match only used `NYRRRunnerName` field (Tier 1). Added Tier 2: matches by `first_name`+`last_name` against `members.FirstName`+`members.LastName` when exactly one member has that name combo (avoids ambiguous matches).
- New match_method value: `auto_firstlast` (vs existing `auto_name` for Tier 1)
- Applied to both: load flow (Phase 4) and re-run auto-match endpoint (`/api/events/<id>/automatch`)
- File changed: `tools/nyrr-viewer/app.py`

### 2026-03-27 01:40 ET — NYRR Viewer: auto version display
- **Added:** Version display in header showing git commit SHA + deploy date (e.g. `v3acc92a · Mar 27`)
- CI workflow writes `VERSION` JSON file at deploy time; `app.py` reads it (or falls back to live `git` for local dev)
- `/api/version` endpoint (no auth required) returns commit + deployed_at
- `VERSION` added to `.gitignore` (generated artifact)
- Files changed: `app.py`, `index.html`, `deploy-nyrr-viewer.yml`, `.gitignore`

### 2026-03-27 — NYRR Viewer: modular split of app.py into Flask Blueprints
- **Refactored:** Split monolithic `app.py` (1,863 lines) into 9 modules using Flask Blueprints:
  - `db.py` (181 lines) — DB connection, query/execute helpers, table init
  - `helpers.py` (60 lines) — DateEncoder, json_response, error handlers
  - `auth.py` (415 lines) — OAuth, login/logout routes, login_required/require_role decorators
  - `api_admin.py` (70 lines) — admin CRUD
  - `api_events.py` (369 lines) — events list, discover, discover upcoming, stats
  - `api_runners.py` (182 lines) — match/unmatch, member search, runner history
  - `api_data.py` (306 lines) — table browser, user settings, processing log, DB config, version
  - `api_sync.py` (328 lines) — background NYRR data load worker
  - `app.py` (108 lines) — thin orchestrator: env loading, Flask setup, blueprint registration
- **Added:** `test_imports.py` — circular import detection test (subprocess-isolated, pytest-compatible, distinguishes missing deps from structural errors)
- **Added:** "Discover Upcoming" button to nyrr-viewer toolbar (backend was already added in prior session)
- Import test passes clean: 7/9 modules verified, 2 skipped (nyrr_api not on sandbox path)
- No route changes, no API changes — purely structural refactor
- Files changed: `tools/nyrr-viewer/app.py`, `tools/nyrr-viewer/templates/index.html` + 8 new files

### 2026-03-27 — Repo-wide pre-commit hook setup in .githooks/
- **Added:** `.githooks/pre-commit` — shared hook that runs `test_imports.py` when nyrr-viewer `.py` files are staged
- **Configured:** `git config core.hooksPath .githooks` for portable hooks across clones
- **Documented in:** `README.md` (first-time setup), `MONOREPO.md` (Git Hooks section + directory tree), `tools/nyrr-viewer/README.md` (project structure + hook usage), `web-apps/mmr-webapp/DEVELOPMENT.md` (updated pre-commit hook section)
- Files changed: `README.md`, `MONOREPO.md`, `tools/nyrr-viewer/README.md`, `web-apps/mmr-webapp/DEVELOPMENT.md`, `.githooks/pre-commit` (new)

### 2026-03-27 — CLAUDE.md overhaul: timestamps, file health, hooks, shell shortcuts
- **Timestamp rule:** Strengthened from suggestion to MANDATORY — "No exceptions. Non-negotiable."
- **Code health section (new):** Hard limits on file size (400 lines Python, 300 TS, 500 HTML). Claude must proactively flag and offer to split oversized files.
- **Pre-commit hooks section (new):** Guidance for expanding `.githooks/pre-commit` as new tests become available (typecheck, pytest, lint, schema validation). Must stay <10s.
- **Shell shortcuts section (new):** Documents user's .zshrc aliases (`mmr`, `mmr-env`, `mysql-mmr`, `tail-nyrr`, `restart-nyrr`) and suggests 7 new ones (`nyrr`, `nyrr-test`, `mmr-web`, `mmr-check`, `mmr-log`, `nyrr-logs`, `nyrr-status`).
- **Key files table:** Added nyrr-viewer modules and `.githooks/pre-commit`
- File changed: `CLAUDE.md`

### 2026-03-27 22:14 ET — Payment reconciliation module for mmr-admin
- **New files:**
  - `mmr-admin/payment_actions.py` — Business logic: expiration calc, member+family update, payment record creation, auto-match heuristic, sheets sync stub, category dispatch (membership, family upgrade, event reg, donation)
  - `mmr-admin/api_payments.py` — Flask blueprint with 9 endpoints: dashboard stats, pending events, unmatched gmail, manual match, auto-match, approve, reject, admin-create, payment history, member summary
  - `mmr-admin/static/payments.js` — React frontend for Payments tab (stats cards, two-panel reconcile view, member popup, admin-create modal, payment history)
  - `mmr-admin/PAYMENTS_DESIGN.md` — Architecture doc for the 2-step async payment workflow
  - `db/schemas/migration_v5_payment_statuses.sql` — ALTER webapp_events Status enum to add matched/expired/error; new config entries
- **Modified files:**
  - `mmr-admin/app.py` — Registered payments_bp blueprint
  - `mmr-admin/templates/index.html` — Added Payments tab, script include, exposed api() globally
- **Design:** 2-step async workflow (submit → match → approve → fulfill). PaymentIntent dispatches to category handlers. Extensible for event registration and donations.
- **Schema:** webapp_events.Status expanded to: pending, matched, approved, rejected, expired, error
- **Not yet done:** Run migration on Azure DB, Sheets webhook endpoint, email notifications from Python

### 2026-03-27 23:08 ET — Sheets sync on every member update + module split
- **sheets_sync.py** (new, 162 lines) — Extracted all sync functions: `sync_member_to_sheets()`, `sync_event_to_sheets()`, `sync_payment_to_sheets()`, `_post_to_sheets()`. Leaf module (imports only from db).
- **payment_handlers.py** (new, 405 lines) — Extracted category handlers, expiration calc, member/family update, payment record creation. `update_member_expiration()` now auto-calls `sync_member_to_sheets()` after every MySQL write.
- **payment_actions.py** (refactored, 472 lines) — Now thin orchestrator: auto-match, manual-match, approve, reject, admin-create. Re-exports from payment_handlers and sheets_sync for api_payments.py.
- **webhook.ts** (rewritten, 278 lines) — Now handles 3 actions: `member_updated` (arbitrary field sync via FIELD_TO_COL mapping), `event_status_updated`, `payment_created`. Keeps legacy `payment_approved` for backward compat.
- **Key change:** Every `UPDATE members` in mmr-admin now auto-syncs to Google Sheets via fire-and-forget webhook POST. No manual sync needed.
- **appsscript.json:** Changed `executeAs` from `USER_ACCESSING` to `USER_DEPLOYING` (required for server-to-server POST).
- **Needs redeploy:** `npm run build && npm run push` in web-apps/gas/membership, then Manage deployments → New version.

### 2026-03-28 00:21 ET — Fix mmr-admin 503 + payments.js crash
- **Root cause (503):** Azure startup command still had `cd tools/nyrr-viewer &&` from before the refactor to `mmr-admin/`. Fix: update startup command via `az webapp config set` (manual step).
- **Root cause (JS crash):** `payments.js` re-declared `const { useState, ... } = React` which was already declared in `index.html`. Babel compiles both in global scope → duplicate `const` error. Fix: removed duplicate destructuring, use globals from index.html.
- **Updated:** `DEPLOY_AZURE.md` — removed all stale `cd tools/nyrr-viewer` references.
- **Files changed:** `mmr-admin/static/payments.js`, `mmr-admin/DEPLOY_AZURE.md`

### 2026-03-28 01:09 ET — Fix 8 bugs in mmr-admin (batch)
- **Bug 6 (root cause):** `match_method` ENUM missing `'auto_firstlast'` — Tier 2 auto-match was silently failing. Added to schema, snapshot, and created migration `0009_match_method_enum.sql`. **Must run migration on Azure DB.**
- **Bug 1:** favicon.ico returning 500 — added `/favicon.ico` route returning 204 in `app.py`.
- **Bug 5:** Runner table had no pagination — added client-side paging (50/100/200/500/1000 per page) with page controls.
- **Bug 3:** Resync error details not visible — error notes now display with red alert styling when `processing_status='Error'`.
- **Bug 2:** Discover Upcoming 502 — increased timeout to 30s, added traceback logging for debugging.
- **Bug 7:** Admin "Refresh from Sheets" — new `/api/admin/refresh-sheets` endpoint triggers GitHub Actions `sync-all-sheets-ordered.yml` via API. Button added to Admin panel. **Requires `GITHUB_TOKEN` env var on Azure.**
- **Bug 8:** "Show xx per page" dropdown text invisible (black on dark) — added `color: var(--text)` to both Data Browser and runner table selects.
- **Bug 9:** Data Browser wide tables — added `.table-wrap-scrollable` class with `max-height: 70vh`, sticky `thead`, both horizontal and vertical scrollbars always visible.
- **Files changed:** `db/schemas/nyrr.sql`, `db/schema_snapshot.sql`, `db/migrations/0009_match_method_enum.sql` (new), `mmr-admin/app.py`, `mmr-admin/api_events.py`, `mmr-admin/api_admin.py`, `mmr-admin/templates/index.html`
- **Still open:** Run migration 0009 on Azure DB; add `GITHUB_TOKEN` to Azure env; investigate NYRR widget API connectivity from Azure (Bug 2 needs deployed logs)

### 2026-03-28 01:18 ET — Auto-Guess Payment Matching (Python + GitHub Action)
- **basecamp/ops/auto_guess_payments.py** (new, ~280 lines) — Python port of GAS `autoMatchUnmatchedPayments()`. Scans `gmail_transactions` for unprocessed $30/$50 payments, extracts MemberID from memo, creates `payments` record, updates `members` + family, marks Gmail row processed. Supports `--commit` vs dry-run, `--start`/`--end` overrides.
- **.github/workflows/auto-guess-payments.yml** (new) — Auto-runs after Sheets sync via `workflow_run` trigger. Also manual via `workflow_dispatch` with dry_run/date inputs. Sends email notification.
- **mmr-admin/api_admin.py** — New `/api/admin/auto-guess` endpoint to trigger workflow from admin UI.
- **mmr-admin/templates/index.html** — "Auto-Guess Payment Matching" section in Admin panel with Run / Dry Run buttons.
- **Config needed:** Set GitHub repo variables: `MEMBERSHIP_COLLECTION_START`, `MEMBERSHIP_COLLECTION_END`, `MEMBERSHIP_YEAR_END`, `INDIVIDUAL_PRICE`, `FAMILY_PRICE` in Settings → Variables → Actions.
- **Still open:** Set repo variables for collection window; add `GITHUB_TOKEN` to Azure env

### 2026-03-28 10:28 ET — auto-guess: DATABASE_URL fallback + staleness checks
- `get_db_connection()` falls back to parsing `DATABASE_URL` when `MYSQL_*` vars absent (local dev via Keychain)
- Added fail-fast validation: missing dates, inverted window, stale (>60d past end), far-future typo (>366d ahead)
- GitHub Actions vars now set: `MEMBERSHIP_COLLECTION_START=2026-03-01`, `MEMBERSHIP_COLLECTION_END=2026-04-30`, `MEMBERSHIP_YEAR_END=2027-03-31`
- **File changed**: `basecamp/ops/auto_guess_payments.py`

### 2026-03-28 09:52 ET — Fix /membership/inactive 401 from refresh-session
- **Root cause 1**: `JWT_SECRET` missing from GitHub Actions workflow `env:` block → API routes couldn't verify mmr_session in production. Added `JWT_SECRET: ${{ secrets.JWT_SECRET }}` to workflow. **Action required: add `JWT_SECRET` as a GitHub Actions secret** (value in `.env.local` / Keychain).
- **Root cause 2**: Page showed "Not authenticated." error on 401 instead of redirecting to `/login`. Fixed both auto-check and manual button paths to redirect → `/login?from=...` on 401.
- **Files changed**: `.github/workflows/azure-static-web-apps-*.yml`, `app/membership/inactive/page.tsx`

### 2026-03-28 11:09 ET — Join flow refactor + hero text + Sheets sync
- Changed hero badge: EN "Family · Support · Pursuit · Community", ZH "有家·有爱·一起奔跑". New `/api/members/enroll` saves member after Step 2, assigns MemberID, syncs Sheets. `findOrCreateMember` now updates existing member info. Content-type guard on API calls prevents HTML-parse crash. Added `lib/sheets/sync.ts` + `googleapis` dep.
- **Files**: `page.tsx` (hero), `join/page.tsx`, `payments/submit/route.ts`, `members/enroll/route.ts` (new), `lib/db/members.ts`, `lib/sheets/sync.ts` (new)
- **Next**: Set `GOOGLE_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY`, `SPREADSHEET_ID` env vars. Verify "WebApp Events" sheet tab exists. Run full build locally.
