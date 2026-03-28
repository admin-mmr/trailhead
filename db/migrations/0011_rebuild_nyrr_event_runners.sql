-- Migration 0011: Rebuild nyrr_event_runners with correct schema
--
-- What we learned:
--   - runners/finishers-filter  → canonical nyrr_runner_id, no teamCode
--   - teams/teamRunners         → same nyrr_runner_id (per GAS types), has implicit teamCode
--   - Two-API duplication was caused by uq_event_runner on (event_id, runner_id)
--     when runner_id differed between API calls (stale data, re-runs, etc.)
--   - Correct dedup key is (nyrr_event_id, bib_number): bib is unique per event
--   - team_code must be set in a second pass after finishers-filter load
--
-- Run: mysql-mmr < db/migrations/0011_rebuild_nyrr_event_runners.sql

-- Drop and recreate (safe because we're in early stage)
DROP TABLE IF EXISTS nyrr_event_runners;

CREATE TABLE nyrr_event_runners (
    id                  INT             AUTO_INCREMENT PRIMARY KEY,

    -- Event reference
    nyrr_event_id       INT             NOT NULL,

    -- Canonical NYRR runner ID from runners/finishers-filter.
    -- Used for results.nyrr.org/runner/{id}/races links.
    -- NULL if row was loaded from teams/teamRunners before finishers-filter ran.
    nyrr_runner_id      VARCHAR(20)     NULL,

    -- Runner identity
    runner_name         VARCHAR(200)    NOT NULL,
    first_name          VARCHAR(100)    NULL,
    last_name           VARCHAR(100)    NULL,
    age                 SMALLINT        NULL,
    gender              VARCHAR(10)     NULL,               -- "M", "W", "X"
    state_province      VARCHAR(50)     NULL,
    city                VARCHAR(100)    NULL,

    -- Race result (bib is the unique key per event)
    bib_number          VARCHAR(20)     NOT NULL,
    finish_time         VARCHAR(20)     NULL,
    pace                VARCHAR(20)     NULL,
    overall_place       INT             NULL,
    gender_place        INT             NULL,

    -- Club affiliation
    -- Set when loaded via teams/teamRunners (scope='mmr').
    -- For scope='all', backfilled by a second MMR-team pass.
    team_code           VARCHAR(20)     NULL,

    -- Sync tracking
    -- 'finishers' = from runners/finishers-filter (canonical runner_id, no team_code)
    -- 'mmr_team'  = from teams/teamRunners (has team_code, runner_id may differ)
    -- 'both'      = both passes ran for this row
    sync_source         ENUM('finishers', 'mmr_team', 'both') NULL,

    -- MMR member matching
    is_registered_only  TINYINT(1)      NOT NULL DEFAULT 0,
    mmr_member_id       VARCHAR(10)     NULL,
    match_method        ENUM('auto_name', 'auto_lastname', 'auto_firstlast', 'manual', 'not_member', 'unmatched')
                            NULL,
    matched_by          VARCHAR(100)    NULL,
    matched_at          DATETIME        NULL,

    -- Timestamps
    scan_timestamp      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Dedup key: one row per bib per event
    UNIQUE KEY uq_event_bib (nyrr_event_id, bib_number),

    -- Secondary index on runner_id for URL lookups
    INDEX idx_runner_id (nyrr_runner_id),
    INDEX idx_last_name (last_name),
    INDEX idx_runner_name (runner_name),
    INDEX idx_mmr_member (mmr_member_id),
    INDEX idx_match_method (match_method),
    INDEX idx_team_code (team_code),

    CONSTRAINT fk_event_runners_event
        FOREIGN KEY (nyrr_event_id) REFERENCES nyrr_events(id) ON DELETE CASCADE
);

-- Reset all event processing status so they can be resynced
UPDATE nyrr_events SET processing_status = 'Pending', notes = NULL;
