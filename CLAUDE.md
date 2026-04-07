# Claude Project Instructions for Trailhead

**Repo:** MMR Trailhead — multi-service monorepo (running club management system).
**Services:** `web-apps/mmr-webapp/` (Next.js+Auth), `photo-manager/` (Python+Flask), `basecamp/` (Sheets sync), `db/` (MySQL), `mmr-admin/` (Flask admin).
**Stack:** Frontend: Next.js 14+, TypeScript, Tailwind, NextAuth | Backend: Python 3.9+, Flask, pandas, cv2, dlib | DB: MySQL 5.7+ (Azure) | APIs: Sheets, Drive, NYRR | Deploy: Azure Static Web Apps, GitHub Actions.

**⚠️ MySQL 5.7+ constraint:** No `IF NOT EXISTS` in ALTER TABLE, CREATE INDEX; no multi-clause ALTERs. Use simple single-operation statements only. Check INFORMATION_SCHEMA before conditional ops.

**_context.md:** Format: `### MM-DD HH:MM UTC — title` + 3 lines max (`Changed: X. Status: Y. Next: Z.`). Insert at top (newest first). Trim to 3 sessions; move excess to `_context_archive.md`.
## ROLE: Code architect for this monorepo
- Review code, debug (GitHub Actions, deployments, configs), design schemas/APIs, optimize Python pipelines, refactor.
- **Do NOT:** `git push`, commit without explicit request, destructive git ops, unvetted architectural suggestions.

## WORKING STYLE
- **Before major work:** Clarify ambiguities → AskUserQuestion + TodoWrite + read SKILL.md files.
- **Code reviews:** Strengths + issues + diffs. **Debugging:** Error message first → git status/log → config → test.
- **File creation:** Save to `/sessions/zen-vibrant-galileo/mnt/trailhead/` (workspace). No standalone .md docs; update CLAUDE.md or _context.md instead. **NEVER create standalone docs automatically—ask first.**

## CODE HEALTH
**Hard rule:** Flag files >400 lines (Python >400, TS/React >300, SQL >200). At task end: `📏 file.py is now N lines — recommend splitting. Want me to do it?` Then split with todo list + test via `test_imports.py`.
**Naming:** `api_<domain>.py` (routes), `helpers.py`/`db.py` (utils). Thin orchestrator (`app.py`).

## SHARED PYTHON MODULES
Edit in `basecamp/python/` FIRST (source of truth): `sync_engine.py`, `nyrr_api.py`. CI auto-copies to `mmr-admin/`. Local: sync via `./scripts/sync-shared-modules.sh`, test via `python3 mmr-admin/test_imports.py`, commit source file.

## ENV & SECRETS
**macOS Keychain only** (not `.env`). Retrieve: `security find-generic-password -s <service> -w`. Run Python: `source load-env.sh && python3 script.py`. Debug: check Keychain entry exists before creating .env files.

## BUILD VERIFICATION
Run: `npm run build 2>&1 | tail -n 50`. Announce attempt → Show raw error (not paraphrased) + diagnosis + fix. Apply → retest. **Max 5 attempts:** Print summary table, then ask "How to proceed?"

## SHEETS SYNC ARCHITECTURE (04-04 cleanup complete)
**Current Implementation:** Batched UPSERT via `sync_config.py` + `sync_engine.py` (source of truth in `basecamp/python/`).
- Routes: `api_sheets_sync_routes.py` (Flask endpoints, `/api/sync/*`)
- Job management: `sync_jobs.py` (in-memory + MySQL fallback for persistence)
- Runners: `sync_runners.py` (6 export/import operations + full_sync orchestration)
- GAS integration: `api_sheets_diags.py` (webhook wrapper with retry logic)

**Deprecated files (removed 04-04):**
1. `basecamp/python/google_sheets_snapshot.py` — Old snapshot/diff logic (replaced by direct GAS webhook)
2. `mmr-admin/sheets_sync.py` — Fire-and-forget single-record POSTs (replaced by batch exports)
3. `basecamp/ops/sync_sheets_to_mysql.py` — Legacy CLI tool with duplicated validation logic (archived; not in GitHub Actions)

**MySQL Procedures (all active):**
- `generate_member_id()` — Auto-generate sequential IDs on member create
- `sp_admin_update_member_status()` — Admin override with audit trail
- `sp_error_summary_report(days_back)` — Error dashboard trends
- `sp_link_transaction(tx, memberID, type, amount, submissionID)` — Creates payment + updates gmail_transactions (5 params, no admin)

## PAYMENT API (api_payments.py) — REBUILT 04-04
**Architecture:** Pure MySQL, no Sheets sync. Three action modes: autoguess, manual approval, admin operations.
- `GET /api/payments/dashboard` — Counts (pending submissions, unmatched gmail, approved/rejected/errors)
- `GET /api/payments/pending-submissions` — List pending submissions (with search)
- `GET /api/payments/unmatched-gmail` — List unmatched Gmail transactions
- `POST /api/payments/autoguess-all` — Scan unmatched → attempt auto-match (membership renewal logic)
- `POST /api/payments/manual-approve` — Admin picks memberID + gmail_tx → create payment
- `GET /api/payments/submissions-for-member/<memberID>` — Pending submissions for member
- `GET /api/payments/gmail-matching-candidates/<memberID>` — Filtered gmail matches by name
- `GET /api/payments/search-members?q=` — Search members by name/email/ID

**Autoguess Logic:**
1. Extract memberID from gmail memo (regex: `\bA\d{4}\b`)
2. If found: Check renewal period (config table) + amount matches ($30 indiv, $50 family) + pending membership submission exists
3. If no memberID: Try partial name match against all pending membership submissions
4. Create payment via `sp_link_transaction(tx, memberID, 'Membership', amount, submissionID|NULL)`
5. Triggers auto-update: members (status→active, expiration+1yr), submissions (status→approved), gmail_transactions (notes synced)

**Manual Approval:** Admin enters memberID + select gmail_tx → create payment with auto-linked submission (if pending membership exists)

**Renewal Period:** Stored in config table (`renewal_start_date`, `renewal_end_date`). Set before running autoguess.

**Batch Sizing:** BATCH_SIZE=300 (MySQL inserts, GAS API calls). Configurable in `sync_config.py` line 26.

## COMMON TASKS
**GitHub Actions:** Check `.github/workflows/` + `git status/diff/log` → identify issues → suggest fixes + commit.
**Photo Manager:** Check `process_photos.py`/`bib_analyzer.py` → data flow (Drive → download → process → output.json → Blob) → optimize.
**Database:** `db/schema_snapshot.sql` = source of truth. **Migrations MUST use `MIGRATION_V*.sql` format** (GitHub Actions auto-runs on push to main). Rename any `MIGRATION_*.sql` files that don't match pattern. Use `mysql-mmr` alias. Schema export via `/api/export-schema` endpoint. **CRITICAL:** Each migration MUST END with self-registration in schema_migrations table: `INSERT INTO schema_migrations (version, description, executed_at) VALUES ('V###', 'description', NOW()) ON DUPLICATE KEY UPDATE executed_at=NOW();` (ensures audit trail + prevents re-runs).
**Web App:** `web-apps/mmr-webapp/` (Next.js) → review TS types, API routes, UI, NextAuth, i18n.

## DATABASE SCHEMA & VALIDATION
**Schema Validation Tools:**
- `validate_schema.py`: Automated validator detects NULL violations, FK orphans, ENUM mismatches, missing PKs, duplicate uniques. Run: `python3 db/validate_schema.py`

**Error Messaging System (V007):**

✅ **DEPLOYED — Known Issue Fixed in V008**
1. **MIGRATION_V007_improve_error_messages.sql** (DEPLOYED)
   - Creates error_context table (19 cols: value, constraint, suggestion, occurrence tracking)
   - Adds 3 validation triggers (submissions/members/payments) — auto-log violations
   - Adds 10 CHECK constraints (Status, Amount, Email, PaymentDate, etc.)
   - Creates v_unresolved_errors view + sp_error_summary_report(days) procedure
   - Enhances activity_log with ErrorContext, ErrorSeverity, StackTrace
   - Known Issue: Reports duplicate column error if columns already exist (non-blocking)

2. **MIGRATION_V008_fix_v007_duplicate_columns.sql** (OPTIONAL — idempotent fix)
   - Checks INFORMATION_SCHEMA before adding columns
   - Safe to re-run; skips columns that already exist
   - Ensures V007 can be re-run without errors
   - Duration: <1 min

**Monitoring & Debugging:**
```sql
SELECT * FROM v_unresolved_errors;  -- Unresolved errors (priority-sorted)
CALL sp_error_summary_report(7);    -- Error trends (last 7 days)
SELECT Severity, COUNT(*) FROM error_context WHERE DetectedAt > NOW() - INTERVAL 24 HOUR GROUP BY Severity;
```

## MMR ADMIN UI — FULL SPLIT + OPTIMIZATION COMPLETE (04-04, PHASES 1-4 + Optimization)
**Refactored:** `mmr-admin/templates/index.html` extracted 9 components + CSS + component loader (2085 lines → external files).
- **Before:** `index.html` 2600 lines, 37K tokens
- **After:** `index.html` 370 lines | 9 external .html components | 1 external .css file | 1 component loader .js | Total: 2628 lines (-3% footprint vs. original, -60% index.html)

**Architecture Changes (04-04):**
1. Payments | 2. Members (sub-tabs: Members, Members by District, 🔍 Renewal Audit) | 3. Sync with Google | 4. Admins (sub-tabs: Admins, Sync Log, Python Exec, Data Query) | 5. Data Browser | 6. NYRR Todos

**Extracted Components (Phases 1, 2, 3 & 4):**
- `dashboard-panel.html` (653 lines) — NYRR Todos: Dashboard + EventDetail views, event discovery, runner matching, column filters, CSV export
- `python-code-editor.html` (256 lines) — Python Code Editor: code input, execution, result display, example templates
- `python-exec-panel.html` (152 lines) — Python Exec: function list, execution, result display
- `table-browser.html` (292 lines) — Data Browser: table explorer, column visibility, sorting, filtering, CSV export
- `match-modal.html` (196 lines) — Event runner matching: search, confirm, duplicate detection
- `admin-panel.html` (199 lines) — Admin management: user list, role assignment, refresh/auto-guess triggers
- `settings-panel.html` (95 lines) — Database settings: connection config, presets, custom connection
- `sync-panel.html` (202 lines) — Sync orchestration: MySQL↔Google exports, Google↔MySQL imports, full sync with job polling + JobCard sub-component
- `processing-log.html` (52 lines) — Sync log viewer: job history table with timestamp, event, status, rows, trigger, error details
- **`styles.css` (180 lines)** — All CSS removed from inline `<style>` tag. Single source of truth for theming.

**Remaining embedded (shared utilities only):**
- StatusBadge, MatchBar, Toast, SimpleProgressModal — UI helpers (70 lines total)
- App shell: auth, version check, tab routing, view state (299 lines)

**File pattern:**
- External components registered with `window.ComponentName`, loaded via `<script type="text/babel" src="/templates/component.html">`
- CSS linked in `<head>`: `<link rel="stylesheet" href="/static/styles.css">`
- Components rendered via `window.Component && React.createElement(window.Component, props)`
- All shared utilities and CSS centralized for maintainability

**Optimization (Component Loader):**
- Created `/static/component-loader.js` (18 lines) — eliminates boilerplate across all components
- Each component refactored: `initComponent('Name', () => { ... })` instead of `const Name = () => { ... }; window.Name = Name;`
- All 9 components refactored (dashboard-panel, python-code-editor, python-exec-panel, table-browser, match-modal, admin-panel, settings-panel, sync-panel, processing-log)
- **Footprint savings:** 4247 → 2628 lines (-1619 lines, -38% reduction)
- **Component loader also exports React hooks globally** — no need to redeclare `useState`, `useEffect`, etc. in each file
- Cleaner, DRY approach — single source of truth for component registration and React API

## QUICK REFS
**Key files:** `db/schema_snapshot.sql`, `load-env.sh`, `mmr-admin/api_*.py`, `mmr-admin/test_imports.py`.
**Azure:** `mmr-mysql-v4` (Sweden Central), use `mysql-mmr` alias.
**Shortcuts:** `mmr` (cd), `mmr-env` (venv+env), `mysql-mmr`, `mmr-web`, `mmr-check` (tsc), `mmr-log`, `nyrr`, `adm-test`, `adm-logs/adm-restart/adm-status`.

## GIT DISCIPLINE
**Main only** (no long-lived branches). Semantic commits (feat:, fix:, chore:, docs:). **Before commit:** `git status`, `git diff`, `git log -1`. **Avoid:** force push, rewrite history, secrets, large binaries. **Ask first:** destructive ops. **Important:** Commit code + `_context.md` together in one commit (avoids race conditions).

## TOKEN DISCIPLINE
**Model routing:** Simple tasks (rename, typo, grep) → Haiku. Complex (refactor, schema, multi-service) → Opus. Suggest disabling extended thinking for non-chain-of-thought tasks.
**Response caps:** Simple ≤10 lines. Code change ≤30 lines. Architecture ≤60 lines (ask before more). Never >80 lines without user asking.
**Tool discipline:** Max 1 file read per cycle (state WHY/WHAT first). Don't re-read unless edited. Chain shell commands: `cd && cat && grep` = 1 call.
**Output discipline:** No preamble/recap/unsolicited suggestions. Show ONLY changed lines. The edit tool shows your changes.
**Docs discipline:** HARD RULE — Do NOT create standalone .md files. All documentation goes into CLAUDE.md (permanent notes) or _context.md (session notes). One-off analyses → inline (no .md). Never create: REFACTOR_SUMMARY.md, INTEGRATION_GUIDE.md, ROUTES_REFERENCE.md, etc. Consolidate instead. Examples: ❌ Create 3 .md docs ✅ Add 1-2 sections to CLAUDE.md + entry in _context.md.
**Context updates:** 3 lines max (`### MM-DD HH:MM UTC — title` + `Changed: X. Status: Y. Next: Z.`). Insert at top. No re-reads; use str_replace. Trim to 3 sessions; move excess to `_context_archive.md`.
**Efficiency:** Don't read files you don't need. Batch edits. Use grep/glob, not bash find. Cache knowledge. Never cat large files; use `head`/`sed`/`grep`. Error message first before source code. Diff-first edits. Chain shell commands. Always `python3`/`pip3`.

**Last updated:** April 4, 2026
