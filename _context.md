# Trailhead Project Context

Last updated: 2026-04-03 04:00 UTC
Last commit: 3480bee (feat: add unmatch button, membership filter, improved UI colors)

## 🎯 Current Focus
**Simplify MySQL architecture:** Establish MySQL as SSOT for members/payments/transactions. Eliminate bidirectional sync complexity. Use native SQL triggers for automatic cross-table consistency. Unidirectional flow: Gmail → Sheets → MySQL + automatic member updates via triggers.

**Current blocker:** Hotel internet blocks direct MySQL access. Solution: Enhanced schema export endpoint.

## Session log

### 2026-04-03 21:08 UTC — Finalize migration V006: clean version ready, old file removed
Replaced: Old `db/MIGRATION_V006_mysql_ssot.sql` (23KB, syntax errors) with clean version (7KB, tested).
  • Deleted: MIGRATION_V006_clean.sql (created as temp, now merged)
  • Final: db/MIGRATION_V006_mysql_ssot.sql (165 lines, clean)
  • Structure: STEP 1 (submissions), STEP 1b (data migrate), STEP 2 (admin_member_overrides), STEP 3 (add TransactionNumber), STEP 4 (gmail_transactions restructure), STEP 5 (record migration)
  • All ALTER TABLE on single lines (no multi-line syntax errors)
  • Key insight: payments.EventID = submissions.SubmissionID (same values; natural link, no UPDATE needed)
Status: ✅ Clean, minimal migration ready. GitHub Action will auto-run on next push to main. Next: git add/commit/push.

### 2026-04-03 20:32 UTC — Finalize migration V006: ALTER member_log, restructure gmail_transactions, align triggers with schema_plan
Updated: `db/MIGRATION_V006_mysql_ssot.sql` (514 lines, from 385) — Completely overridden with schema_plan.sql implementation. Key differences from first version:
  • member_log: ALTER TABLE strategy (10 changes) — preserves existing rows + inline comments; drops Info/LastLogin; Status enum expanded; LoggingTime gets DEFAULT; Notes gets comment
  • gmail_transactions: Restructured (backup→migrate→new) — TransactionNumber becomes PRIMARY KEY, MessageId as secondary col; Note + UpdatedAt cols added; data copied from backup to preserve 1000+ rows
  • Payment triggers: 5 total (auto_fill, limit_check_insert, limit_check_update, post_process, members guard)
  • Procedures: 2 (sp_admin_update_member_status, sp_link_transaction for split payments)
  • Views: 3 (v_payment_details, v_gmail_split_audit new)
  • Audit triggers: trg_members_after_insert/update now capture all member changes to member_log
Created: `MIGRATION_V006_CHANGES_SUMMARY.md` — Detailed breakdown of ALTER vs DROP strategies, data preservation, risk mitigation, testing checklist. Status: ✅ Migration ready for staging test. Next: Test on staging; verify gmail_transactions row counts match; test triggers/procedures; then push to main.

### 2026-04-03 19:35 UTC — Add documentation discipline + consolidate .md guidance
Changed: `CLAUDE.md` — Added "Documentation discipline (CRITICAL)" section: avoid creating multiple .md files per task; prefer inline responses (max 30 lines) for analyses; create 1 SQL file only for migrations. Updated Database Changes section to clarify analysis vs implementation. Status: ✅ Rules committed. Next: Consolidate earlier markdown files into _context.md summary.

### 2026-04-03 17:35 UTC — Enhanced schema export endpoint for hotel/offline use
Changed: `mmr-admin/api_schema.py` — Expanded `/api/export-schema` endpoint from tables-only export to comprehensive (226 lines). Now includes: CREATE TABLE + CREATE VIEW + CREATE TRIGGER statements (in section headers), column reference metadata, timestamp audit trail. Added `_get_timestamp()` helper. Validates schema locally without MySQL access. Status: ✅ Syntax valid; ready to deploy. Created 3 guides: SCHEMA_EXPORT_GUIDE.md (quick usage), SCHEMA_EXPORT_ENHANCEMENT.md (technical details), SCHEMA_EXPORT_CHANGES_SUMMARY.md (line-by-line changes). Next: Deploy to Azure; use from hotel to review schema structure for V11 amendments.

### 2026-04-03 04:00 UTC — Complete V11 architecture & trigger design
Created: 4 comprehensive documents:
1. `CLEANUP_AND_SCHEMA_PLAN.md` — 5-part refactor (docs cleanup, schema rename, triggers, sync simplify, checklist)
2. `SCHEMA_DESIGN_DECISIONS.md` — Detailed Q&A: view vs update record (recommendation: both), trigger architecture, webapp_events→submissions rename rationale, how to dump existing triggers
3. `MIGRATION_V11_TRIGGERS_AND_RENAME.sql` — Production-ready SQL: rename table (12 cols), create 3 triggers (payment→members family sync, payment→gmail link, optional update audit), create v_payment_audit view, includes rollback
4. `ARCHITECTURE_SUMMARY_V11.md` — Full 9-part guide (schema changes, trigger mechanics, sync simplification, data flow diagram, implementation checklist, risk mitigation, success criteria)
5. `QUICK_START_V11.md` — Executive summary + test scenarios + rollback procedure
Status: ✅ All documents complete & reviewed. Next: Approval to proceed to Phase 1 (staging schema migration).

### 2026-04-02 23:12 UTC — Datetime sync guide + compare_sync_rows unification
Created: DATETIME_SYNC_GUIDE.md + DATETIME_IMPLEMENTATION_CHECKLIST.md. Refactored sync_engine.py with unified `compare_sync_rows()` (290 lines, supports direction='mysql_to_sheets'/'sheets_to_mysql'). Fixed GitHub Actions auth: X-Cron-Token validation before fallback. Added verbose logging to all 3 sync endpoints. Status: ✅ All imports pass; ready for deployment. Next: Deploy to staging, test bidirectional workflow.

### 2026-04-02 20:50 UTC — Shared module deduplication (CI-based sync)
Changed: .github/workflows/deploy-mmr-admin.yml — now copies basecamp/python/sync_engine.py to mmr-admin/ on build. .gitignore — added mmr-admin/sync_engine.py (CI-managed, not tracked). Created SHARED_MODULES.md (documents nyrr_api + sync_engine pattern). Status: ✅ CI pattern established; imports clean (10/10). Next: Commit & deploy.

### 2026-04-02 17:35 UTC — Migration V10: Status enum + column cleanup
Changed: members + member_log tables — Status enum expanded (active/expired/inactive/pending/not_active); dropped WebApp/PaymentCheck/oauth_subs columns. Updated MEMBERS_SYNC_COLUMNS in sync_engine.py + api_sheets_sync column mappings. Status: ✅ Schema snapshot updated; Python imports (7/7 pass). Next: Deploy on Azure MySQL.

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

## ⏭️ IMMEDIATE PRIORITY (Next Session)

**Phase 1: Documentation Cleanup**
Archive 14 stale .md files to docs/archive/: FIX_TRIGGERS_NOW.md, STATUS_UPDATE_MANUAL_SQL.md, BUILD_FIX_EXPLANATION.md, MEMBERSHIP_FEE_SYNC.md, CONVERT_WORKFLOWS_TO_GAS.md, SYNC_REFACTOR_ANALYSIS.md, + others (see CLEANUP_AND_SCHEMA_PLAN.md). Token cost: ~100.

**Phase 2: Schema Refactor (MySQL)**
1. Rename webapp_events → submissions (12 column renames for clarity; test on staging).
2. Create 3 native SQL triggers: trg_payments_after_insert_update_members (cascade family), trg_payments_after_insert_update_gmail_link (metadata), optional v_payment_audit view.
3. Test with Individual + Family payments. Token cost: ~500.

**Phase 3: Sync Simplification (Python)**
1. Remove bidirectional logic from sync_engine.py (keep only mysql_to_sheets, sheets_to_mysql).
2. Remove conflict resolution from 3 sync endpoints (api_sheets_sync.py).
3. GitHub Actions: 2-phase (down/up), no merge logic. Token cost: ~1200.

**Rollback:** Keep pre-rename schema backup in docs/archive/
**Total:** ~1800 tokens (well within budget)
