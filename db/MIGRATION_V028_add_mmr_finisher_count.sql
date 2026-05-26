-- MIGRATION_V028: Add mmr_finisher_count to nyrr_events
--
-- Background:
--   The NYRR Count Reconciliation panel (api_nyrr_reconcile.py) probes the
--   NYRR API for both the total finisher count and the MMR-only finisher
--   count, but only the total was being persisted (column
--   nyrr_finisher_count). The MMR count was returned to the UI and then
--   thrown away.
--
--   This migration adds a sibling column so probes can persist the live
--   NYRR MMR count and the list endpoint can return it on initial page load
--   without an extra API hit.
--
--   Column purpose summary on nyrr_events:
--     nyrr_finisher_count  — total finishers reported by NYRR API
--     mmr_finisher_count   — MMR-only finishers reported by NYRR API   (NEW)
--     mmr_runner_count     — DB-counted MMR runners (denormalized cache)
--     mmr_matched_count    — MMR runners successfully matched to members
--
--   NULL = "never probed" (matches nyrr_finisher_count convention).
--
-- MySQL 5.7+ notes:
--   • One ALTER per statement, no IF NOT EXISTS on ALTER ADD COLUMN.
--   • If re-running, drop the column first or guard via INFORMATION_SCHEMA.

-- ── 1. mmr_finisher_count ──────────────────────────────────────────────────
ALTER TABLE nyrr_events
  ADD COLUMN mmr_finisher_count INT NULL
  AFTER mmr_matched_count;

-- ── Self-registration ──────────────────────────────────────────────────────
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V028', 'Add mmr_finisher_count to nyrr_events (NYRR-reported MMR count, persisted by Reconciliation panel probe)', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
