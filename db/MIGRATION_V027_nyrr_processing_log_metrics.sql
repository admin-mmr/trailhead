-- MIGRATION_V027: Add teams_processed + elapsed_sec to nyrr_processing_log
--
-- Background:
--   sync_worker.py (_db_final_status) writes to columns teams_processed and
--   elapsed_sec when finalising a NYRR sync run, but those columns were never
--   added to the schema. Production hit:
--     1054 (42S22): Unknown column 'teams_processed' in 'field list'
--   on every completed sync, so the run_status / rows_written / error_details
--   were never persisted to nyrr_processing_log.
--
--   The UI also reads status.teams_processed (templates/index.html:201), so the
--   right fix is to add the columns rather than strip them from the INSERT.
--
-- MySQL 5.7+ notes:
--   • One ALTER TABLE per statement (no IF NOT EXISTS on ALTER ADD COLUMN).
--   • If you need to re-run, drop the columns first or guard via
--     INFORMATION_SCHEMA before each ALTER.

-- ── 1. teams_processed ──────────────────────────────────────────────────────
ALTER TABLE nyrr_processing_log
  ADD COLUMN teams_processed INT NOT NULL DEFAULT 0
  AFTER rows_written;

-- ── 2. elapsed_sec ──────────────────────────────────────────────────────────
ALTER TABLE nyrr_processing_log
  ADD COLUMN elapsed_sec INT NOT NULL DEFAULT 0
  AFTER teams_processed;

-- ── Self-registration ───────────────────────────────────────────────────────
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V027', 'Add teams_processed + elapsed_sec to nyrr_processing_log (fixes sync_worker INSERT crash)', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
