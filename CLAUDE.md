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
**Database:** `db/schema_snapshot.sql` = source of truth. **Migrations MUST use `MIGRATION_V*.sql` format** (GitHub Actions auto-runs on push to main). Rename any `MIGRATION_*.sql` files that don't match pattern. Use `mysql-mmr` alias. Schema export via `/api/export-schema` endpoint. **CRITICAL:** Each migration MUST END with self-registration in schema_migrations table: `INSERT INTO schema_migrations (version, description, executed_at) VALUES ('V###', 'description', NOW()) ON DUPLICATE KEY UPDATE executed_at=NOW();` (ensures audit trail + prevents re-runs). **MIGRATION NUMBERING HARD RULE:** Migration files are deleted after deploy, so the filesystem is NOT reliable. Before creating any migration file, query the DB: `mysql-mmr -e "SELECT version FROM schema_migrations ORDER BY id DESC LIMIT 5;"` — this is the only source of truth. New file MUST be `max + 1`. Never rely on CLAUDE.md action-plan numbers or `ls db/MIGRATION_*.sql` — both go stale.
**Web App:** `web-apps/mmr-webapp/` (Next.js) → review TS types, API routes, UI, NextAuth, i18n.

## DATABASE SCHEMA & VALIDATION
**Schema Validation Tools:**
- `validate_schema.py`: Automated validator detects NULL violations, FK orphans, ENUM mismatches, missing PKs, duplicate uniques. Run: `python3 db/validate_schema.py`

**Error Messaging System:** V007 + V008 deployed. `error_context` table, 3 validation triggers, 10 CHECK constraints, `v_unresolved_errors` view, `sp_error_summary_report(days)` procedure.

**Monitoring & Debugging:**
```sql
SELECT * FROM v_unresolved_errors;  -- Unresolved errors (priority-sorted)
CALL sp_error_summary_report(7);    -- Error trends (last 7 days)
SELECT Severity, COUNT(*) FROM error_context WHERE DetectedAt > NOW() - INTERVAL 24 HOUR GROUP BY Severity;
```

## MMR ADMIN UI — ARCHITECTURE
**Tabs:** 1. Payments | 2. Members (Members, Members by District, 🔍 Renewal Audit) | 3. Sync with Google | 4. Admins (Admins, Sync Log, Python Exec, Data Query) | 5. Data Browser | 6. NYRR Todos

**Components** (`mmr-admin/templates/`): `dashboard-panel.html`, `python-code-editor.html`, `python-exec-panel.html`, `table-browser.html`, `match-modal.html`, `admin-panel.html`, `settings-panel.html`, `sync-panel.html`, `processing-log.html` + `styles.css` (static/).

**File pattern:** Components use `initComponent('Name', () => { ... })` via `/static/component-loader.js`. React hooks exported globally — no redeclaration needed. CSS: `<link rel="stylesheet" href="/static/styles.css">`. Components rendered via `window.Component && React.createElement(window.Component, props)`.

## NYRR SYNC — KEY FILES (all bugs resolved 2026-05-25)
- `sync_worker.py` (344 LOC) + `sync_worker_fetch.py` (FinisherFetcher, pace bisection with `pace_min`/`pace_max`) + `sync_worker_backfill.py` (TeamBackfiller) + `sync_worker_reconcile.py` (slug→canonical + `event_url` fix)
- `basecamp/ops/sync_nyrr_reconcile.py` — `reconcile_slug_event_codes()`, also wired as `POST /api/discover/reconcile-slugs` and daily/weekly pipeline steps
- `api_events.py` (398 LOC) — 3-tier matcher; gender normalized M/W/X→Male/Female/Other; Tier 3 requires birth year; `_backfill_member_name_and_year()` helper
- `fuzzy_worker.py` + `api_events_fuzzy.py` — Tier 4 background thread (`POST /api/events/<id>/fuzzy-match`, `GET /status`)
- `api_events_discovery.py` — scans current + prior year via `year=` kwarg

## ACTION PLAN (active — July 2026)
Sequenced backlog. P0=operational (this week), P1=features remaining, P2=code health.
Shipped since May plan (all on main): P1a staleness gate, P1b duplicate detection, P1c match queue + Tier-4 fuzzy, P1e mmr-only backfill (V029 `load_mode`, `run_backfill_mmr_only`), P1f HOF backend (`api_hof.py`), P1g HOF admin tab (`hof-panel.html`). Also: security audit (auth gaps/SQLi/secrets, `test_auth_matrix.py`), Payments Gmail auto-import on load, in-app NYRR scheduler (`nyrr_scheduler.py` replaces deleted `sync-nyrr-weekly.yml` workflow), pytest suite repaired (1348 pass / 0 fail).

**P0 — Operational**
1. Flip `ENABLE_NYRR_SCHEDULER=1` on Azure webapp `mmr-nyrr-viewer` (scheduler is a no-op until then): `az webapp config appsettings set --name mmr-nyrr-viewer --resource-group mmr-resources --settings ENABLE_NYRR_SCHEDULER=1`. Verify via `adm-logs` → look for `[scheduler] started — discovery ...`.
2. Browser smoke-test Payments tab auto-import (committed 07-13, never browser-tested): load tab → auto-runs import transactions → import members once per page load; staleness banner clears after sync.
3. Recreate repo-root `.venv` (the `mmr` alias expects it): `python3 -m venv .venv && source .venv/bin/activate && pip install -r mmr-admin/requirements.txt -r basecamp/requirements.txt`.
4. Stray root docs still pending decision: `PUBLIC_SITE_PLAN.md`, `MONOREPO.md`, `WeChat_Member_Matching_Agent_Prompt.md` — fold into CLAUDE.md or delete.
5. Confirm `MIGRATION_V031` applied (migration files are deleted post-deploy; only the DB knows): `mysql-mmr -e "SELECT version FROM schema_migrations ORDER BY id DESC LIMIT 5;"`.

**P1h — Hall of Fame public page (~4h) — NOT shipped**
- New `web-apps/mmr-webapp/src/app/hall-of-fame/page.tsx` (App Router, no auth).
- Fetches `/api/hof/series` on load; series card → expand to 8-category HOF table.
- i18n: English + Chinese for all category labels (男子/女子, Open/40+/50+/60+).
- Add to site nav. Mobile-responsive. Backend + CORS already live (`api_hof.py`).

**P1d — NYRR phases 3-5 (optional) — NOT shipped**
Member backfill report (members never matched), race-history in member tooltip, annual MMR finishes summary. Defer until match-queue usage shows signal.

**P2 — Code health (background)**
May-plan offenders were split (Members.js 78, api_payments.py 46). Current worst (hard-rule limits: py 400, JS 300):
| File | LOC | Limit |
|---|---|---|
| `mmr-admin/sync_worker.py` | 506 | 400 |
| `static/PaymentsPanel.js` | 506 | 300 |
| `mmr-admin/api_members_status.py` | 501 | 400 |
| `static/DistrictMemberFilters.js` | 473 | 300 |
| `mmr-admin/api_hof.py` | 473 | 400 |
| `mmr-admin/sync_worker_fetch.py` | 473 | 400 |
| `static/DistrictMembersPanel.js` | 441 | 300 |
| `static/DistrictMemberTable.js` | 433 | 300 |
(+6 more py files 402–459 LOC; rerun `find mmr-admin -name '*.py' -not -path '*/tests/*' -exec wc -l {} +` before picking one.)

**P3 — Open questions**
NYRR backfill depth (recommend 2024+). Add `validate_schema.py` to CI? Include NYRR registrants in match queue? Member-merge tool (deferred — FK risk; revisit if dupes accumulate).

## QUICK REFS
**Key files:** `db/schema_snapshot.sql`, `load-env.sh`, `mmr-admin/api_*.py`, `mmr-admin/test_imports.py`.
**Azure:** `mmr-mysql-v4` (Sweden Central), use `mysql-mmr` alias. App Service `mmr-nyrr-viewer`, resource group `mmr-resources` (see `adm-logs`/`adm-status` aliases).

**Shell shortcuts (defined in `~/.zshrc`):**
| Command | What it does |
|---|---|
| `mmr` | `cd ~/github/mmr/trailhead` + activate `.venv` + `source load-env.sh` — **always run first** |
| `mysql-mmr` | `mysql --login-path=mmr -D mmrdb` — direct DB shell |
| `mmr-web` | Start Next.js webapp dev server (`web-apps/mmr-webapp/start-dev.sh`) |
| `mmr-check` | TypeScript typecheck (`npx tsc --noEmit`), no full build |
| `mmr-log` | `git log --oneline -15` |
| `nyrr` | Start Flask admin **locally** (`mmr-admin/app.py`) at http://localhost:5050 |
| `adm-test` | Run `mmr-admin/test_imports.py` (import parity check) |
| `adm-logs` | Stream **Azure** webapp logs live |
| `adm-restart` | Restart **Azure** webapp (not local) |
| `adm-status` | Check Azure webapp state |
| `adm-debug <code>` | Debug single NYRR event locally (e.g. `adm-debug 26WASH`) |
| `runner-summary <code>` | MySQL summary for one event's runners (e.g. `runner-summary 26WASH`) |

**Data Query Quick Reference:**

Count MMR vs. other teams for an event:
```sql
SELECT 
  COUNT(*) AS total_loaded, 
  SUM(team_code = 'MMR') AS mmr_runners, 
  SUM(team_code IS NULL OR team_code != 'MMR') AS other_teams 
FROM nyrr_event_runners ner 
JOIN nyrr_events ne ON ne.id = ner.nyrr_event_id 
WHERE ne.event_code = 'B2026';
```

## LOCAL DEV — NYRR RUNNER DATA
**Quick DB state check** (run after `mmr`):
```bash
python3 - <<'EOF'
import sys; sys.path.insert(0, 'mmr-admin')
from db import query
for r in query("SELECT processing_status, COUNT(*) as n FROM nyrr_events GROUP BY processing_status"): print(f"  {r['processing_status']}: {r['n']}")
print(f"Total runners: {query('SELECT COUNT(*) as n FROM nyrr_event_runners')[0]['n']}")
print(f"Matched:       {query('SELECT COUNT(*) as n FROM nyrr_event_runners WHERE mmr_member_id IS NOT NULL')[0]['n']}")
EOF
```

**Populate runner data locally (CLI — no deploy needed):**
```bash
mmr   # loads venv + env

# Test run: process 10 pending events
python3 basecamp/ops/sync_nyrr_events.py --mode daily --batch-size 10

# Full backlog: process all pending (same as weekly GitHub Action)
python3 basecamp/ops/sync_nyrr_events.py --mode weekly

# Reprocess one event by code
python3 basecamp/ops/sync_nyrr_events.py --mode single --event-code 26WASH
```

**Via admin UI locally:**
```bash
mmr && nyrr   # start Flask admin at http://localhost:5050
# → NYRR Todos tab → filter by "Pending" → click ▶ Load per event
# → "Discover New Events" to pull current year from NYRR API first
```

**GitHub Actions (remote, no local setup):**
Go to repo → Actions → "NYRR Weekly Sync & Finisher Audit (Tuesday)" → Run workflow (supports `workflow_dispatch`).

## SELF-CHECKING (before marking any task done)
Run this mental checklist — catches the class of bugs that appeared in the polling saga:

**Cross-boundary vocabulary:** When a string crosses any boundary (backend→frontend, Python→JS, DB→API), write a contract test that reads both sides. Key pairs to check: `status='done'` vs `=== 'done'`, camelCase vs snake_case field names, `operation` field present in every dict that reaches the frontend.

**Every async loop must have:**
- `!r.ok` / non-200 handler → `clearInterval` / stop
- `try/catch` around the fetch → stop on network error
- Max-retry cap (e.g. `maxPolls`) → stop if job hangs
- Cleanup return value or ref → cancel on unmount

**Every dict that crosses Python→JS:** Verify every field the frontend reads is explicitly mapped in the Python dict. Missing fields (`operation`, `completedAt`) silently become `undefined` and break filter/sort logic with no error.

**Polling pattern — use `window.pollUntilDone`** (defined in `index.html`). Never write a raw `setInterval` for job status polling. `pollUntilDone` handles all stop conditions and returns a cleanup function.

**Test file for this pattern:** `mmr-admin/tests/test_sync_jobs_contract.py` — add a test whenever a new status string, field name, or polling consumer is added.

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

**Last updated:** July 18, 2026
