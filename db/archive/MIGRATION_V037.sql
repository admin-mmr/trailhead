-- ── MIGRATION_V037: Member portal — NYRR event RSVPs, roster privacy, gallery URL ─
-- Required by P1L Session 1 (member portal: NYRR calendar + RSVP, photos link,
-- My Results). See CLAUDE.md → ACTION PLAN → P1L.
--
-- Creates:
--   nyrr_event_rsvps          — one row per (event, member): running / volunteering /
--                               interested / not_going, with an optional short note.
--                               UNIQUE(nyrr_event_id, MemberID) makes a change an
--                               UPSERT rather than a duplicate row.
--   members.ShowRsvpPublicly  — per-member opt-out from the shared roster. Default 1
--                               (opt-out, not opt-in) — the roster is a club social
--                               feature and an empty default would make it useless.
--                               Opted-out members are still COUNTED, just unnamed.
--   config.PhotoGalleryUrl    — admin-editable race-photo gallery link.
--
-- No enum change is needed for member-confirmed result linking:
-- nyrr_event_runners.match_method already contains 'manual'.
--
-- MySQL 5.7 constraint (repo-wide rule): no IF NOT EXISTS in ALTER TABLE /
-- CREATE INDEX, no multi-clause ALTERs. Every step is guarded by
-- INFORMATION_SCHEMA, so this file is safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Create nyrr_event_rsvps (guarded)
--    Index notes: UNIQUE (nyrr_event_id, MemberID) has nyrr_event_id as its leftmost
--    prefix, which satisfies InnoDB's FK-index requirement for that column; MemberID
--    gets its own index for the "my RSVPs" lookup and its FK.
SET @tbl = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'nyrr_event_rsvps');
SET @sql = IF(@tbl = 0,
    "CREATE TABLE nyrr_event_rsvps (
        id            INT NOT NULL AUTO_INCREMENT,
        nyrr_event_id INT NOT NULL COMMENT 'FK to nyrr_events.id',
        MemberID      VARCHAR(10) NOT NULL COMMENT 'FK to members.MemberID',
        intent        ENUM('running','volunteering','interested','not_going') NOT NULL
                      COMMENT 'What the member plans to do at this event',
        note          VARCHAR(280) NULL COMMENT 'Optional member note, e.g. pace group or volunteer shift',
        created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_rsvp_event_member (nyrr_event_id, MemberID),
        KEY idx_rsvp_member (MemberID),
        CONSTRAINT fk_rsvp_event  FOREIGN KEY (nyrr_event_id) REFERENCES nyrr_events (id) ON DELETE CASCADE,
        CONSTRAINT fk_rsvp_member FOREIGN KEY (MemberID)      REFERENCES members (MemberID) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      COMMENT='Member RSVPs for NYRR events (P1L member portal calendar)'",
    "SELECT 'nyrr_event_rsvps already exists' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 2. Add members.ShowRsvpPublicly (guarded — single-operation ALTER)
SET @col = (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'members'
            AND COLUMN_NAME = 'ShowRsvpPublicly');
SET @sql = IF(@col = 0,
    "ALTER TABLE members ADD COLUMN ShowRsvpPublicly TINYINT(1) NOT NULL DEFAULT 1
     COMMENT 'Show this member by name on shared event RSVP rosters (0 = counted only)'",
    "SELECT 'members.ShowRsvpPublicly already exists' AS info");
PREPARE stmt FROM @sql; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- 3. Seed config.PhotoGalleryUrl
--    INSERT IGNORE (not ON DUPLICATE KEY UPDATE) on purpose: this key is
--    admin-editable, so a re-run must NOT stomp a value someone has changed.
INSERT IGNORE INTO config (ConfigKey, ConfigValue, Description)
VALUES ('PhotoGalleryUrl',
        'https://mmr-data-pipeline.web.app/',
        'Race photo gallery URL shown in the member portal. Must be http(s) — validated before render.');

-- ── Self-registration (required — prevents re-run) ───────────────────────────
INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('V037', 'Member portal: nyrr_event_rsvps table, members.ShowRsvpPublicly, config.PhotoGalleryUrl', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
