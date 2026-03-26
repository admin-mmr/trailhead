-- review-app local SQLite schema
-- This database lives alongside the review app and stores:
--   1. Human annotations on pipeline output (reviews, difficulty tags)
--   2. Member ↔ bib number mappings per race event
--   3. NYRR runner identification info
--
-- This is intentionally a LOCAL SQLite file (not production MySQL) because:
--   - The review app is an admin tool that runs on your machine
--   - Annotations are iterative and exploratory during development
--   - Once stable, approved annotations can be promoted to production MySQL
--     via the sync workflow
--
-- Production MySQL migration for nyrr_runner_info is in:
--   basecamp/migrations/0006_nyrr_runner_info.sql

-- ─────────────────────────────────────────────────────────────────
-- 1. Photo annotations (human review of pipeline detections)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS photo_annotations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    file_path       TEXT NOT NULL,          -- matches output.json file_path
    file_name       TEXT NOT NULL,

    -- Human review status
    review_status   TEXT NOT NULL DEFAULT 'unreviewed',
                    -- 'unreviewed' | 'confirmed' | 'rejected' | 'needs_recheck'
    reviewed_by     TEXT,                   -- admin email or name
    reviewed_at     TEXT,                   -- ISO timestamp

    -- Difficulty assessment (for tuning the pipeline)
    difficulty      TEXT,
                    -- 'easy'   — clear shot, bib visible, face clear
                    -- 'medium' — partial occlusion, hat/sunglasses, moderate crowd
                    -- 'hard'   — distant, heavy crowd, motion blur, back turned
                    -- 'edge'   — ambiguous: could go either way

    -- Annotation details
    notes           TEXT,                   -- free-text admin notes
    bib_correct     INTEGER,               -- 1=pipeline bib is correct, 0=wrong
    bib_override    TEXT,                   -- correct bib if pipeline was wrong
    face_correct    INTEGER,               -- 1=face match is correct, 0=wrong
    member_id_override TEXT,               -- correct member ID if match was wrong

    -- Pipeline data snapshot (denormalized for quick display)
    quality_score   REAL,
    bib_primary     TEXT,                   -- bib number detected by pipeline
    people_count    INTEGER,
    match_tier      INTEGER,               -- 1, 2, or 3 from cascade
    match_conf      REAL,                  -- fused confidence from cascade
    face_score      REAL,
    outfit_score    REAL,

    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(file_path)                       -- one annotation per photo
);

CREATE INDEX IF NOT EXISTS idx_annotations_status
    ON photo_annotations(review_status);
CREATE INDEX IF NOT EXISTS idx_annotations_difficulty
    ON photo_annotations(difficulty);
CREATE INDEX IF NOT EXISTS idx_annotations_bib
    ON photo_annotations(bib_primary);


-- ─────────────────────────────────────────────────────────────────
-- 2. Member ↔ bib number mapping (per race event)
-- ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS member_bib_mapping (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id       TEXT NOT NULL,           -- MMR member ID e.g. "A0042"
    member_name     TEXT,                    -- display name
    bib_number      TEXT NOT NULL,           -- race bib number
    event_date      TEXT NOT NULL,           -- ISO date "2026-03-15"
    event_name      TEXT,                    -- e.g. "NYC Half Marathon"

    -- Confidence: was this from a confirmed bib photo or manual entry?
    source          TEXT NOT NULL DEFAULT 'manual',
                    -- 'manual'   — admin entered it
                    -- 'pipeline' — auto-detected from confirmed Tier 1 match
                    -- 'nyrr'     — imported from NYRR results

    notes           TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(member_id, event_date)           -- one bib per member per event
);

CREATE INDEX IF NOT EXISTS idx_bib_mapping_member
    ON member_bib_mapping(member_id);
CREATE INDEX IF NOT EXISTS idx_bib_mapping_bib
    ON member_bib_mapping(bib_number);
CREATE INDEX IF NOT EXISTS idx_bib_mapping_event
    ON member_bib_mapping(event_date);


-- ─────────────────────────────────────────────────────────────────
-- 3. NYRR runner identification info
-- ─────────────────────────────────────────────────────────────────
-- Used by the NYRR results scraper to look up race results.
-- A member might have multiple possible year-born values (e.g. born
-- late Dec → could appear as either year in NYRR records depending
-- on when the race falls relative to their birthday).

CREATE TABLE IF NOT EXISTS nyrr_runner_info (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id       TEXT NOT NULL,           -- MMR member ID
    nyrr_runner_name TEXT NOT NULL,          -- name as it appears on NYRR bibs
    year_born_1     INTEGER NOT NULL,        -- primary birth year
    year_born_2     INTEGER,                 -- secondary birth year (year+1 or year-1)

    -- Status tracking
    verified        INTEGER NOT NULL DEFAULT 0,  -- 1 = confirmed via NYRR lookup
    last_verified   TEXT,                    -- ISO timestamp of last successful lookup
    notes           TEXT,

    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),

    UNIQUE(member_id)
);
