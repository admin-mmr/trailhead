-- ============================================================
-- NYRR Schema (Source of Truth)
-- Race data pipeline: events, runners, processing log
-- Created by migrations 0007 + 0008
-- ============================================================

-- NYRR events / races
CREATE TABLE IF NOT EXISTS nyrr_events (
    id                  INT             AUTO_INCREMENT PRIMARY KEY,
    event_code          VARCHAR(30)     NOT NULL,
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
CREATE TABLE IF NOT EXISTS nyrr_event_runners (
    id                  INT             AUTO_INCREMENT PRIMARY KEY,
    nyrr_event_id       INT             NOT NULL,
    nyrr_runner_id      VARCHAR(20)     NOT NULL,           -- event-specific, NOT stable
    runner_name         VARCHAR(200)    NOT NULL,
    first_name          VARCHAR(100)    NULL,
    last_name           VARCHAR(100)    NULL,
    age                 SMALLINT        NULL,
    gender              VARCHAR(10)     NULL,               -- "M", "W", "X"
    state_province      VARCHAR(50)     NULL,
    bib_number          VARCHAR(20)     NULL,
    finish_time         VARCHAR(20)     NULL,
    pace                VARCHAR(20)     NULL,
    overall_place       INT             NULL,
    gender_place        INT             NULL,
    team_code           VARCHAR(20)     NULL,
    is_registered_only  TINYINT(1)      NOT NULL DEFAULT 0,
    mmr_member_id       VARCHAR(10)     NULL,
    match_method        ENUM('auto_name', 'auto_lastname', 'auto_firstlast', 'manual', 'not_member', 'unmatched')
                            NULL,
    matched_by          VARCHAR(100)    NULL,
    matched_at          DATETIME        NULL,
    scan_timestamp      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_event_runner (nyrr_event_id, nyrr_runner_id),
    INDEX (last_name),
    INDEX (runner_name),
    INDEX (mmr_member_id),
    INDEX (match_method),
    INDEX (team_code),
    INDEX (nyrr_runner_id),
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
