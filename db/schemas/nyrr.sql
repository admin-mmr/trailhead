-- ============================================================
-- NYRR Schema (Source of Truth)
-- Race data pipeline: events, runners, processing log
-- Created by migrations 0007 + 0008
-- ============================================================

-- NYRR events / races
CREATE TABLE IF NOT EXISTS nyrr_events (
    id                  INT             AUTO_INCREMENT PRIMARY KEY,
    event_code          VARCHAR(255)    NOT NULL,
    event_name          VARCHAR(255)    NOT NULL,
    event_url           VARCHAR(500)    NULL,
    location            VARCHAR(255)    NULL,
    distance            VARCHAR(50)     NULL,
    event_date          DATE            NULL,
    event_year          SMALLINT        NULL,
    is_upcoming         TINYINT(1)      NOT NULL DEFAULT 0,
    is_virtual          TINYINT(1)      NOT NULL DEFAULT 0,
    processing_status   ENUM('Pending', 'InProgress', 'Completed', 'Error')
                            NOT NULL DEFAULT 'Pending',
    processed_at        DATETIME        NULL,
    processed_by        VARCHAR(100)    NULL,
    result_count        INT             NOT NULL DEFAULT 0,
    mmr_runner_count    INT             NOT NULL DEFAULT 0,
    mmr_matched_count   INT             NOT NULL DEFAULT 0,
    notes               TEXT            NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_event_code (event_code),
    INDEX (event_date),
    INDEX (event_year),
    INDEX (processing_status),
    INDEX (is_upcoming)
);

-- One row per runner per event (all runners, not just MMR)
-- Dedup key is (nyrr_event_id, bib_number) — bib is unique per event.
-- nyrr_runner_id is the canonical NYRR member ID from runners/finishers-filter,
--   used for results.nyrr.org/runner/{id}/races links.
-- team_code is set by teams/teamRunners pass; blank for non-MMR in a finishers-only load.
-- sync_source tracks which API(s) have populated this row.
CREATE TABLE IF NOT EXISTS nyrr_event_runners (
    id                  INT             AUTO_INCREMENT PRIMARY KEY,
    nyrr_event_id       INT             NOT NULL,
    nyrr_runner_id      VARCHAR(20)     NULL,               -- canonical NYRR member ID (from finishers-filter)
    runner_name         VARCHAR(200)    NOT NULL,
    first_name          VARCHAR(100)    NULL,
    last_name           VARCHAR(100)    NULL,
    age                 SMALLINT        NULL,
    gender              VARCHAR(10)     NULL,               -- "M", "W", "X"
    city                VARCHAR(100)    NULL,
    state_province      VARCHAR(50)     NULL,
    bib_number          VARCHAR(20)     NOT NULL,           -- dedup key, always present
    finish_time         VARCHAR(20)     NULL,
    pace                VARCHAR(20)     NULL,
    overall_place       INT             NULL,
    gender_place        INT             NULL,
    age_grade_time      VARCHAR(20)     NULL,               -- age-graded finish time from NYRR API
    age_grade_place     INT             NULL,               -- age-graded place ranking
    age_grade_percent   DECIMAL(5,2)    NULL,               -- age-graded percentage (0-100)
    team_code           VARCHAR(20)     NULL,               -- NULL for non-MMR in finishers-only load
    sync_source         ENUM('finishers', 'mmr_team', 'both') NULL,
    is_registered_only  TINYINT(1)      NOT NULL DEFAULT 0,
    mmr_member_id       VARCHAR(10)     NULL,
    match_method        ENUM('auto_name', 'auto_lastname', 'auto_firstlast', 'manual', 'not_member', 'unmatched')
                            NULL,
    matched_by          VARCHAR(100)    NULL,
    matched_at          DATETIME        NULL,
    scan_timestamp      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_event_bib (nyrr_event_id, bib_number),
    INDEX idx_runner_id (nyrr_runner_id),
    INDEX idx_last_name (last_name),
    INDEX idx_runner_name (runner_name),
    INDEX idx_mmr_member (mmr_member_id),
    INDEX idx_match_method (match_method),
    INDEX idx_team_code (team_code),
    CONSTRAINT fk_event_runners_event
        FOREIGN KEY (nyrr_event_id) REFERENCES nyrr_events(id) ON DELETE CASCADE
);

-- Append-only sync audit log
CREATE TABLE IF NOT EXISTS nyrr_processing_log (
    id                  INT             AUTO_INCREMENT PRIMARY KEY,
    run_timestamp       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    triggered_by        VARCHAR(100)    NULL,
    nyrr_event_id       INT             NULL,
    run_status          ENUM('Success', 'PartialSuccess', 'Failed')
                            NOT NULL,
    rows_written        INT             NOT NULL DEFAULT 0,
    error_details       TEXT            NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (run_timestamp),
    INDEX (run_status),
    INDEX (nyrr_event_id),
    CONSTRAINT fk_processing_log_event
        FOREIGN KEY (nyrr_event_id) REFERENCES nyrr_events(id) ON DELETE SET NULL
);

-- Members table addition (migration 0008):
--   ALTER TABLE members ADD COLUMN YearBornGuess SMALLINT NULL AFTER YearBorn;
