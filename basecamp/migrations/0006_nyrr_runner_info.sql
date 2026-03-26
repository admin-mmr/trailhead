-- Migration: 0006_nyrr_runner_info
-- Description: Create nyrr_runner_info table for NYRR race result lookups
-- Date: 2026-03-25
-- Depends on: 0005 (members table must exist)
--
-- This table stores the NYRR-specific identification data needed to
-- look up race results on the NYRR website.  A member might have two
-- possible birth-year values (born late Dec → could appear as either
-- year in NYRR records depending on when the race falls relative to
-- their birthday).
--
-- The local SQLite equivalent lives in:
--   photo-manager/review-app/schema.sql (nyrr_runner_info table)

CREATE TABLE IF NOT EXISTS nyrr_runner_info (
    id              INT AUTO_INCREMENT PRIMARY KEY,
    member_id       VARCHAR(20)  NOT NULL,          -- MMR member ID (e.g. "A0042")
    nyrr_runner_name VARCHAR(100) NOT NULL,         -- name as it appears on NYRR bibs
    year_born_1     INT          NOT NULL,          -- primary birth year
    year_born_2     INT          DEFAULT NULL,      -- secondary birth year (year+1 or year-1)

    -- Status tracking
    verified        TINYINT(1)   NOT NULL DEFAULT 0,  -- 1 = confirmed via NYRR lookup
    last_verified   DATETIME     DEFAULT NULL,         -- timestamp of last successful lookup
    notes           TEXT         DEFAULT NULL,

    created_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    UNIQUE KEY uq_nyrr_member (member_id),

    -- Foreign key to members table (if it exists in your schema)
    -- Uncomment if your members table uses member_id as a key:
    -- CONSTRAINT fk_nyrr_member FOREIGN KEY (member_id) REFERENCES members(member_id)

    INDEX idx_nyrr_runner_name (nyrr_runner_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
