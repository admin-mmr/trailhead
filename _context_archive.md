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
