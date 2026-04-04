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

## COMMON TASKS
**GitHub Actions:** Check `.github/workflows/` + `git status/diff/log` → identify issues → suggest fixes + commit.
**Photo Manager:** Check `process_photos.py`/`bib_analyzer.py` → data flow (Drive → download → process → output.json → Blob) → optimize.
**Database:** `db/schema_snapshot.sql` = source of truth. **Migrations MUST use `MIGRATION_V*.sql` format** (GitHub Actions auto-runs on push to main). Rename any `MIGRATION_*.sql` files that don't match pattern. Use `mysql-mmr` alias. Schema export via `/api/export-schema` endpoint.
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
