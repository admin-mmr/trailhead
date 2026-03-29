-- ============================================================
-- Migration 0013: Add nyrr_finisher_count to nyrr_events
-- Purpose: Track total finishers per event from NYRR API
-- for gap analysis and sync prioritization
-- ============================================================

ALTER TABLE nyrr_events
ADD COLUMN nyrr_finisher_count INT NULL DEFAULT NULL
AFTER result_count;

-- Add index for gap analysis queries
ALTER TABLE nyrr_events
ADD INDEX idx_finisher_count (nyrr_finisher_count);

-- Add index to quickly find events with gaps (finisher_count > result_count)
ALTER TABLE nyrr_events
ADD INDEX idx_finisher_gap (event_date, nyrr_finisher_count, result_count);
