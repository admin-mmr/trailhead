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
