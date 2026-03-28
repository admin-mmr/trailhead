-- Migration 0009: Add 'auto_firstlast' to match_method ENUM
-- Bug fix: Tier 2 auto-match writes 'auto_firstlast' but ENUM didn't include it,
-- causing "Data truncated for column 'match_method'" and silently failing matches.

ALTER TABLE nyrr_event_runners
  MODIFY COLUMN match_method
    ENUM('auto_name', 'auto_lastname', 'auto_firstlast', 'manual', 'not_member', 'unmatched')
    NULL;
