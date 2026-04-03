# Trailhead Project Context

Last updated: 2026-04-03 21:22 UTC
Last commit: a62461e (fix: migration V006 - ultra-clean version, 99 lines)

## 🎯 Current Focus
**MySQL SSOT Migration (V006):** Migrate webapp_events → submissions, restructure gmail_transactions (TransactionNumber = PK), add TransactionNumber to payments. GitHub Action auto-runs on push to main. Key constraint: MySQL 5.7+ (Azure) doesn't support `IF NOT EXISTS` in ALTER TABLE or CREATE INDEX — use simple, single-operation statements only.

## Session log

### 2026-04-03 21:22 UTC — Migration V006 final: 99-line ultra-clean version committed
Fixed: Removed ALL complex conditionals (PREPARE/EXECUTE, IF NOT EXISTS) that caused syntax errors. Final migration: 99 lines, 5 STEPs (submissions CREATE, webapp_events→submissions INSERT, admin_member_overrides CREATE, payments ALTER TransactionNumber, gmail_transactions RENAME/MIGRATE). All ALTER/CREATE statements on single lines (MySQL 5.7 compatible). Status: ✅ Committed, ready to push. GitHub Action will auto-run on main push.

### 2026-04-03 21:15 UTC — Fixed migration syntax errors: stripped multi-line conditionals
Iterated: Multiple attempts to fix line 121 error (IF NOT EXISTS not supported in MySQL 5.7). Removed INFORMATION_SCHEMA checks, dynamic SQL, CREATE INDEX IF NOT EXISTS. Result: Ultra-simple migration file that works with older MySQL versions. All single-line statements.

### 2026-04-03 20:45 UTC — Data migration strategy: webapp_events → submissions, EventID as link
Added: Step 1b (INSERT...SELECT webapp_events→submissions with Status enum remapping: matched→approved, rejected/error→cancelled). Key insight: payments.EventID naturally links to submissions.SubmissionID (same values after migration; no UPDATE needed). Zero new payment rows created.

## ⏭️ IMMEDIATE NEXT
Push migration V006 to main → GitHub Action auto-runs on Azure MySQL. Monitor Actions log. Verify row counts match, Status enum remapped, schema_migrations entry recorded.
