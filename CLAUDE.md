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

## NYRR BUG TRACKER (active — May 2026)
Local sync currently marks events "Completed" with 0 runners. Bugs identified 2026-05-25; fix in P0 order. Resume protocol: scan the table, pick the first row not marked ✅; if file/line numbers shifted, re-grep before patching.

| ID | Severity | File | Issue | Status |
|---|---|---|---|---|
| A | P0 (data loss) | `sync_worker.py:474-486` + `:73-76` | Sets `processing_status='Completed'` even when `rows_written=0`; combined with destructive `force_reload` delete this wipes good data on empty NYRR responses | ✅ fixed 2026-05-25 — preflight probe before DELETE; status gated on rows_written>0; job state surfaces error to UI |
| B | P0 (latent crash) | `sync_worker.py:86-101` | `ON DUPLICATE KEY UPDATE` clause uses stray `)` + `NEW.col` (MySQL 8.0.19+ syntax). Will explode the first time NYRR actually returns finishers (MySQL 5.7 needs `VALUES(col)`) | ✅ fixed 2026-05-25 — rewrote with `VALUES(col)` syntax |
| C | P0 (silent no-op) | `sync_worker.py:426-432` | `_upsert_team_runners` is a stub returning `(0,0)` — Step 3 never actually writes `team_code` | ✅ fixed 2026-05-25 — implemented UPDATE-by-runner_id with INSERT fallback for Step-1 misses |
| D | P1 (root cause) | `nyrr_events.event_code` + `sync_worker.py` | Probe confirmed `rbc-brooklyn-half` slug returns 0. Fixed: `sync_worker._resolve_slug_to_canonical()` detects hyphens, calls `events/search`, word-overlap matches to canonical code, updates DB in-place before sync proceeds | ✅ fixed 2026-05-25 |
| E | P1 (broken UI) | `api_events_discovery.py:33-40` | Calls `search_events(limit=100, status='live')` with invalid kwargs and reads `event.get('code')` on dataclass — "Discover New Events" button can't work | ✅ fixed 2026-05-25 — scan current + prior year via `year=` kwarg; dataclass attr access |
| F | P2 (false positives) | `api_events.py:228, 276` | Tier 3 (first OR last name) skips age guard when member has neither `YearBorn` nor `YearBornGuess`. Tighten: when no birth year, demote to Tier 2 only | ✅ fixed 2026-05-25 — removed `OR (YearBorn IS NULL AND YearBornGuess IS NULL)` escape hatch from Tier 3 |
| G | P2 (silent miss) | `api_events.py:234, 282` | Gender check compares NYRR `M/W/X` to `m/f/o` from members — `W` never matches `Female`. Add normalization map | ✅ fixed 2026-05-25 — CASE WHEN M→Male / W→Female / X→Other in both Tier 2 and Tier 3 SQL |
| H | P2 (DRY) | `api_events.py:185-300` | Three near-identical "after Tier N update members.NYRRRunnerName" blocks — extract one helper | ✅ fixed 2026-05-25 — `_backfill_member_name_and_year(cursor, event_id, match_method)` helper; 3 call sites |
| I | P2 (worker timeout) | `api_events.py:301+` | Tier 4 rapidfuzz runs in-request; on Azure with 25k runners × 1.5k members ≈ 37M comparisons → OOM. Move to background worker | ⬜ pending |
| J | P3 (CLAUDE.md hard rule) | `sync_worker.py` 580 LOC | Exceeds 400 LOC. Split fetch logic into `sync_worker_fetch.py` | ⬜ pending |
| K | P3 (CLAUDE.md hard rule) | `api_events.py` 468 LOC | Exceeds 400 LOC. Split after H | ⬜ pending |

## ACTION PLAN (active — May 2026)
Sequenced backlog. P0=quick wins (this week), P1=features asked for, P2=code health.

**P0 — Operational quick wins (~1 day total)**
1. Re-enable `.github/workflows/sync-nyrr-weekly.yml` cron schedule (currently manual-only); smoke-test one event end-to-end.
2. ✅ DONE (2026-05-05, commit 7a557cf) — Doc cleanup: 13 stray .md files removed (PAYMENTS_*, FUZZY_*, REFACTOR_BLUEPRINT, SCHEMA_ANALYSIS, PROJECT_PLAN, ROUTES_REFERENCE, PAYMENTS_DESIGN, AUDIT_RENEWAL_FEATURE, mmr-admin/REFACTOR_SESSION_2026-04-01.md). Re-audit 2026-05-18 confirmed none present.
3. Verify V023 deployed: `SELECT version FROM schema_migrations ORDER BY id DESC LIMIT 5;`
4. **NEW** — Flagged for review (untracked, violates HARD RULE): `PUBLIC_SITE_PLAN.md` (318 lines, dated 2026-05-19). Either fold into CLAUDE.md or move to a tracked planning location.
5. **NEW** — Flagged for review (root-level, possibly stale): `WeChat_Member_Matching_Agent_Prompt.md` (321 lines) and `MONOREPO.md` (364 lines). Evaluate whether content belongs in CLAUDE.md or should stay as separate docs.

**P1a — Payments staleness gate (~3h, frontend only)**
File: `mmr-admin/static/PaymentsPanel.js` (~30 LOC). Existing `lastSyncTime` from `/api/sync/jobs` already wired (line 48-124). Add: `STALE_HOURS=24`; `isStale = age>24h || lastSyncTime===null`. When stale: yellow banner above sync bar with hours-old + pulsing "Sync Now" button; pass `disabled={isStale}` to autoguess button (line 213) with tooltip. After sync completes, `fetchLastSync()` re-runs (line 102) → banner clears. No backend change.

**P1b — Members duplicate detection (~6h)**
- Migration `db/MIGRATION_V024_member_duplicate_dismissals.sql` (~15 LOC): table `member_duplicate_dismissals (id, dup_type ENUM('name','phone','wechat'), dup_key VARCHAR(255), dismissed_by, dismissed_at)` UNIQUE(dup_type, dup_key); end with self-registration INSERT.
- Backend `mmr-admin/api_members_duplicates.py` (new, ~150 LOC): `GET /api/members/duplicates?type=name|phone|wechat|all`, `POST /api/members/duplicates/dismiss`. Three queries grouping on LOWER(TRIM(FirstName))+LOWER(TRIM(LastName)) (excluding same FamilyID), PhoneNumber, WeChatID. HAVING COUNT(*)>1. LEFT JOIN dismissals to filter out resolved.
- Register blueprint in `mmr-admin/app.py`.
- UI `mmr-admin/static/MembersDuplicates.js` (~200 LOC): 3 collapsible sections, side-by-side member cards, "Mark not a duplicate" + "Open member" actions. **No auto-merge** (FK risk).
- Sub-tab "🔁 Duplicates" in `mmr-admin/templates/index.html` under Members.
- Tests `mmr-admin/tests/test_members_duplicates.py` (~80 LOC): seed 3 same-name rows distinct FamilyID → assert group; dismiss → assert filtered.

**P1c — NYRR matching (extends existing pipeline; weeks 3-4)**
Existing: `basecamp/ops/sync_nyrr_events.py` + 3-tier auto-matcher in `api_events.py:155 api_run_automatch` (NYRRRunnerName / first+last+age±1 / partial+age±1).
- **Week 3 — review queue:** New panel "🏃 Match Queue" under NYRR Todos. `GET /api/nyrr/match-queue` returns unmatched finishers (mmr_member_id IS NULL AND is_registered_only=0) + top-3 candidates per row (same first OR last name, age±2 if YearBorn known). UI uses existing `match-modal.html` and `POST /api/runners/<id>/match`. Bulk "Confirm all single-candidate hits."
- **Week 4 — Tier-4 fuzzy:** Migration V025 adds `confidence_score TINYINT NULL` + extends `match_method` ENUM with `auto_fuzzy`. Add `rapidfuzz` to `mmr-admin/requirements.txt`. Extend `api_run_automatch` with Tier-4 (token_set_ratio≥90 + age±2). Tier-4 hits flagged yellow in queue for re-confirmation.

**P1d — NYRR phases 3-5 (optional, weeks 5-7)**
Member backfill report (members never matched), race-history in member tooltip, annual MMR finishes summary. Defer until P1c shows signal.

**P2 — Code health (background)**
Splits flagged by CLAUDE.md hard rule (use `test_imports.py` for parity):
| File | LOC | Limit | Effort |
|---|---|---|---|
| `static/Members.js` | 1022 | 300 | 4h |
| `api_payments.py` | 1086 | 400 | 4h |
| `nyrr_api.py` (basecamp/python — source of truth) | 823 | 400 | 3h |
| `basecamp/ops/sync_nyrr_events.py` | 1022 | 400 | 3h |
| `static/MembersStatusPanel.js` | 701 | 300 | 3h |

**P3 — Open questions**
NYRR backfill depth (recommend 2024+). Add `validate_schema.py` to CI? Include NYRR registrants in match queue? Member-merge tool (deferred — FK risk; revisit if dupes accumulate).

**Milestones**
- Week 1: P0 done + P1a shipped
- Week 2: P1b in production (V024 + UI)
- Week 4: P1c phases 1-2 (queue + fuzzy)
- Week 7: P1d (stretch)

## QUICK REFS
**Key files:** `db/schema_snapshot.sql`, `load-env.sh`, `mmr-admin/api_*.py`, `mmr-admin/test_imports.py`.
**Azure:** `mmr-mysql-v4` (Sweden Central), use `mysql-mmr` alias.

**Shell shortcuts (defined in `~/.zshrc`):**
| Command | What it does |
|---|---|
| `mmr` | `cd ~/github/mmr/trailhead` + activate `.venv` + `source load-env.sh` — **always run first** |
| `mysql-mmr` | `mysql --login-path=mmr -D mmrdb` — direct DB shell |
| `mmr-web` | Start Next.js webapp dev server (`web-apps/mmr-webapp/start-dev.sh`) |
| `mmr-check` | TypeScript typecheck (`npx tsc --noEmit`), no full build |
| `mmr-log` | `git log --oneline -15` |
| `nyrr` | Start Flask admin **locally** (`mmr-admin/app.py`) at http://localhost:5001 |
| `adm-test` | Run `mmr-admin/test_imports.py` (import parity check) |
| `adm-logs` | Stream **Azure** webapp logs live |
| `adm-restart` | Restart **Azure** webapp (not local) |
| `adm-status` | Check Azure webapp state |
| `adm-debug <code>` | Debug single NYRR event locally (e.g. `adm-debug 26WASH`) |
| `runner-summary <code>` | MySQL summary for one event's runners (e.g. `runner-summary 26WASH`) |

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
mmr && nyrr   # start Flask admin at http://localhost:5001
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

**Last updated:** May 5, 2026
