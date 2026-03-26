-- ============================================================
-- Migration 0007: NYRR events, event runners, and processing log
-- Purpose: Core tables for the NYRR race data pipeline (replaces
--          Google Sheets NYRR-Events, NYRR-Results, NYRR-ProcessingLog)
-- Date: 2026-03-26
-- Depends on: 0006 (nyrr_runner_info)
--
-- HOW TO RUN:
--   mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p mmrdb < 0007_nyrr_tables.sql
--
-- SAFE TO RE-RUN: Uses CREATE TABLE IF NOT EXISTS
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- ============================================================
-- 1. NYRR_EVENTS
--    One row per NYRR race/event. Stores metadata from the
--    events/search and events/details API endpoints plus
--    pipeline processing state and dashboard counters.
-- ============================================================
CREATE TABLE IF NOT EXISTS nyrr_events (
    id                  INT             AUTO_INCREMENT PRIMARY KEY,
    event_code          VARCHAR(30)     NOT NULL,           -- NYRR code, e.g. "26WASH", "M2024"
    event_name          VARCHAR(255)    NOT NULL,
    event_url           VARCHAR(500)    NULL,               -- Link to results.nyrr.org
    location            VARCHAR(255)    NULL,               -- Venue
    distance            VARCHAR(50)     NULL,               -- "5K", "Marathon", etc.
    event_date          DATE            NULL,               -- Race date
    event_year          SMALLINT        NULL,               -- For year-based queries

    -- Flags
    is_upcoming         TINYINT(1)      NOT NULL DEFAULT 0, -- Has the event occurred?
    is_virtual          TINYINT(1)      NOT NULL DEFAULT 0, -- Virtual event (from API)

    -- Processing state (for pipeline + dashboard)
    processing_status   ENUM('Pending', 'InProgress', 'Completed', 'Error')
                            NOT NULL DEFAULT 'Pending',
    processed_at        DATETIME        NULL,               -- Last processing time
    processed_by        VARCHAR(100)    NULL,               -- "System" or admin email

    -- Dashboard counters (denormalized for fast reads)
    result_count        INT             NOT NULL DEFAULT 0, -- Total runners ingested
    mmr_runner_count    INT             NOT NULL DEFAULT 0, -- MMR team runners
    mmr_matched_count   INT             NOT NULL DEFAULT 0, -- Runners matched to members

    notes               TEXT            NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_event_code (event_code),
    INDEX idx_event_date (event_date),
    INDEX idx_event_year (event_year),
    INDEX idx_processing_status (processing_status),
    INDEX idx_is_upcoming (is_upcoming)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 2. NYRR_EVENT_RUNNERS
--    One row per runner per event. Stores ALL runners (not just
--    MMR) so we can expand to other clubs in the future.
--
--    CRITICAL: nyrr_runner_id is event-specific — NYRR assigns
--    a different RunnerID to the same person in different events.
--    The stable identity is runner_name, not nyrr_runner_id.
-- ============================================================
CREATE TABLE IF NOT EXISTS nyrr_event_runners (
    id                  INT             AUTO_INCREMENT PRIMARY KEY,
    nyrr_event_id       INT             NOT NULL,           -- FK → nyrr_events.id
    nyrr_runner_id      VARCHAR(20)     NOT NULL,           -- Event-specific NYRR ID (NOT stable)
    runner_name         VARCHAR(200)    NOT NULL,           -- Full name (consistent across events)
    first_name          VARCHAR(100)    NULL,
    last_name           VARCHAR(100)    NULL,
    age                 SMALLINT        NULL,               -- Age as of event date
    gender              VARCHAR(10)     NULL,               -- "M", "W", or "X" (non-binary)
    state_province      VARCHAR(50)     NULL,
    bib_number          VARCHAR(20)     NULL,               -- NULL before race day
    finish_time         VARCHAR(20)     NULL,               -- NULL if registered only
    pace                VARCHAR(20)     NULL,               -- Per-mile pace
    overall_place       INT             NULL,               -- Finish position
    gender_place        INT             NULL,               -- Gender position
    team_code           VARCHAR(20)     NULL,               -- "MMR", etc.
    is_registered_only  TINYINT(1)      NOT NULL DEFAULT 0, -- Pre-race, no results yet

    -- Member matching
    mmr_member_id       VARCHAR(10)     NULL,               -- Matched member or NULL
    match_method        ENUM('auto_name', 'auto_lastname', 'manual', 'not_member', 'unmatched')
                            NULL,
    matched_by          VARCHAR(100)    NULL,               -- "System" or admin email
    matched_at          DATETIME        NULL,

    scan_timestamp      DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,  -- Last synced from NYRR
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_event_runner (nyrr_event_id, nyrr_runner_id),
    INDEX idx_runner_last_name (last_name),
    INDEX idx_runner_name (runner_name),
    INDEX idx_mmr_member_id (mmr_member_id),
    INDEX idx_match_method (match_method),
    INDEX idx_team_code (team_code),
    INDEX idx_nyrr_runner_id (nyrr_runner_id),

    CONSTRAINT fk_event_runners_event
        FOREIGN KEY (nyrr_event_id) REFERENCES nyrr_events(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 3. NYRR_PROCESSING_LOG
--    Append-only audit log of every sync run. Used by the
--    dashboard "Sync History" panel.
-- ============================================================
CREATE TABLE IF NOT EXISTS nyrr_processing_log (
    id                  INT             AUTO_INCREMENT PRIMARY KEY,
    run_timestamp       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    triggered_by        VARCHAR(100)    NULL,               -- "System" or admin email
    nyrr_event_id       INT             NULL,               -- FK → nyrr_events.id (NULL for batch runs)
    run_status          ENUM('Success', 'PartialSuccess', 'Failed')
                            NOT NULL,
    rows_written        INT             NOT NULL DEFAULT 0,
    error_details       TEXT            NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_log_run_timestamp (run_timestamp),
    INDEX idx_log_run_status (run_status),
    INDEX idx_log_event_id (nyrr_event_id),

    CONSTRAINT fk_processing_log_event
        FOREIGN KEY (nyrr_event_id) REFERENCES nyrr_events(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- Record migration in schema_migrations
-- ============================================================
INSERT INTO schema_migrations (version, description) VALUES
('0007', 'NYRR events, event runners, and processing log tables')
ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;


SET FOREIGN_KEY_CHECKS = 1;

-- End of migration 0007
