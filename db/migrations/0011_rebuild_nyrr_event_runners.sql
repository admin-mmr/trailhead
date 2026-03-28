-- Migration 0011: Rebuild nyrr_event_runners with optimal three-step sync schema
--
-- Workflow:
--   1. POST /runners/finishers-filter → Load all runners (30K for NYC Half in ~2 min)
--   2. POST /teams/search            → Enumerate all teams in event (584 teams for H2026)
--   3. POST /teams/teamRunners (×584) → Backfill team_code by bib (~20 min)
--
-- Key insights:
--   - runnerId is NOT stable across events (same runner = different ID per event)
--   - bib_number IS stable and unique per event (dedup key)
--   - team_code available via teams/teamRunners endpoint (584 API calls vs 30K)
--   - Dedup: (nyrr_event_id, bib_number) is the only reliable key
--
-- Run: mysql-mmr < db/migrations/0011_rebuild_nyrr_event_runners.sql

-- Drop and recreate (safe in early stage)
DROP TABLE IF EXISTS nyrr_event_runners;

CREATE TABLE nyrr_event_runners (
    id                  INT             AUTO_INCREMENT PRIMARY KEY,

    -- Event reference
    nyrr_event_id       INT             NOT NULL,

    -- Event-context runner ID from runners/finishers-filter.
    -- NOT stable across events; only use for display in this event context.
    nyrr_runner_id      VARCHAR(20)     NOT NULL,

    -- Runner identity (from finishers-filter response)
    runner_name         VARCHAR(200)    NOT NULL,
    first_name          VARCHAR(100)    NULL,
    last_name           VARCHAR(100)    NULL,
    age                 SMALLINT        NULL,
    gender              VARCHAR(10)     NULL,               -- "M", "W", "X"
    city                VARCHAR(100)    NULL,
    state_province      VARCHAR(50)     NULL,

    -- Race result (bib is the dedup key per event)
    bib_number          VARCHAR(20)     NOT NULL,
    finish_time         VARCHAR(20)     NULL,
    pace                VARCHAR(20)     NULL,
    overall_place       INT             NULL,
    gender_place        INT             NULL,
    age_grade_time      VARCHAR(20)     NULL,
    age_grade_place     INT             NULL,
    age_grade_percent   FLOAT           NULL,

    -- Team affiliation (backfilled by Step 3: teams/teamRunners)
    team_code           VARCHAR(20)     NULL,

    -- MMR member matching (separate concern, independent of team_code)
    is_registered_only  TINYINT(1)      NOT NULL DEFAULT 0,
    mmr_member_id       VARCHAR(10)     NULL,
    match_method        ENUM('auto_name', 'auto_lastname', 'auto_firstlast', 'manual', 'not_member', 'unmatched') NULL,
    matched_by          VARCHAR(100)    NULL,
    matched_at          DATETIME        NULL,

    -- Timestamps
    scan_timestamp      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    -- Unique key: one row per (event, bib) — bib is truly unique per event
    UNIQUE KEY uq_event_bib (nyrr_event_id, bib_number),

    -- Indexes for common queries
    INDEX idx_runner_id (nyrr_runner_id),
    INDEX idx_team_code (team_code),
    INDEX idx_last_name (last_name),
    INDEX idx_mmr_member (mmr_member_id),
    INDEX idx_match_method (match_method),

    CONSTRAINT fk_event_runners_event
        FOREIGN KEY (nyrr_event_id) REFERENCES nyrr_events(id) ON DELETE CASCADE
);

-- Reset all event processing status so they can be resynced from scratch
UPDATE nyrr_events SET processing_status = 'Pending', notes = 'Schema rebuilt: single finishers sync + team backfill';
