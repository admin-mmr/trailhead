-- Migration 0010: DEPRECATED — Use 0011 instead
--
-- This migration was superseded by 0011_rebuild_nyrr_event_runners.sql, which:
--   1. Completely rebuilds nyrr_event_runners table with correct schema
--   2. Adds nyrr_runner_id=NULL, city, sync_source ENUM('finishers','mmr_team','both')
--   3. Uses dedup key (event_id, bib) instead of (event_id, runner_id)
--   4. Implements proper two-path upsert logic for both API endpoints
--
-- DO NOT RUN THIS. Run migration 0011 instead.
--
-- $ mysql-mmr < db/migrations/0011_rebuild_nyrr_event_runners.sql

-- Remove any duplicate bib rows first (keep the row with the lowest id)
DELETE r1 FROM nyrr_event_runners r1
INNER JOIN nyrr_event_runners r2
  ON r1.nyrr_event_id = r2.nyrr_event_id
 AND r1.bib_number = r2.bib_number
 AND r1.bib_number IS NOT NULL
 AND r1.bib_number != ''
 AND r1.id > r2.id;

-- Add unique index on (event, bib)
ALTER TABLE nyrr_event_runners
  ADD UNIQUE KEY uq_event_bib (nyrr_event_id, bib_number);

-- Add sync_source column
ALTER TABLE nyrr_event_runners
  ADD COLUMN sync_source ENUM('mmr', 'all') NULL DEFAULT NULL
    COMMENT 'Which NYRR API populated this row: mmr=teams/teamRunners, all=runners/finishers-filter';
