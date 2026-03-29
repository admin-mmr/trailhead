-- ============================================================
-- Migration 0014: Add auto_partial_name to match_method ENUM
-- Purpose: Support partial name matching for better coverage
-- ============================================================

-- Extend match_method ENUM to include 'auto_partial_name'
ALTER TABLE nyrr_event_runners
MODIFY COLUMN match_method
ENUM('auto_name', 'auto_lastname', 'auto_firstlast', 'auto_partial_name', 'manual', 'not_member', 'unmatched')
NULL;
