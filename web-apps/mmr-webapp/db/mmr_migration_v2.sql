-- ============================================================
-- MMR Database Migration Script v2.0 — Photo Pipeline
-- Target: mmr-mysql.mysql.database.azure.com / mmrdb
-- Run after: mmr_migration_v1.sql (membership tables must exist first)
--
-- HOW TO RUN:
--   mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p \
--         --ssl-mode=REQUIRED mmrdb < mmr_migration_v2.sql
--
-- SAFE TO RE-RUN: Uses CREATE TABLE IF NOT EXISTS
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- ============================================================
-- 1. PHOTO_EVENTS
--    One row per race / club event that has photos.
--    Links to Google Drive folder where raw photos live.
-- ============================================================
CREATE TABLE IF NOT EXISTS photo_events (
    event_id            VARCHAR(60)     NOT NULL,   -- e.g. 20260315-nyc-half
    name_en             VARCHAR(200)    NULL,
    name_zh             VARCHAR(200)    NULL,
    event_date          DATE            NULL,
    drive_folder_id     VARCHAR(100)    NULL,        -- Google Drive folder ID
    nyrr_event_code     VARCHAR(50)     NULL,        -- NYRR event code if applicable
    sync_status         ENUM('pending','syncing','done','error') NOT NULL DEFAULT 'pending',
    photos_total        INT             NOT NULL DEFAULT 0,
    photos_analyzed     INT             NOT NULL DEFAULT 0,
    last_synced_at      DATETIME        NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 2. PHOTOS
--    One row per photo. AI analysis results cached here forever.
--    Raw originals stay on Google Drive; only 400px thumbs in Blob.
-- ============================================================
CREATE TABLE IF NOT EXISTS photos (
    photo_id            VARCHAR(80)     NOT NULL,   -- {event-id}_{sha256[:12]}
    event_id            VARCHAR(60)     NOT NULL,
    blob_thumb_url      VARCHAR(500)    NULL,        -- Azure Blob CDN URL for 400px thumb
    blob_raw_url        VARCHAR(500)    NULL,        -- Azure Blob URL for full-res (optional)
    drive_file_id       VARCHAR(100)    NULL,        -- Google Drive file ID
    drive_folder_id     VARCHAR(100)    NULL,
    photographer        VARCHAR(100)    NULL,
    taken_at            DATETIME        NULL,        -- EXIF datetime if available
    width_px            INT             NULL,
    height_px           INT             NULL,
    file_size_bytes     BIGINT          NULL,
    quality_score       FLOAT           NULL,        -- 0.0 bad → 1.0 excellent
    people_count        INT             NULL,
    image_tags          JSON            NULL,        -- ["running","crowd","sunny",...]
    analyzed_at         DATETIME        NULL,
    synced_at           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (photo_id),
    INDEX idx_photos_event      (event_id),
    INDEX idx_photos_analyzed   (analyzed_at),
    FOREIGN KEY (event_id) REFERENCES photo_events(event_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 3. PHOTO_DETECTIONS
--    One row per detected person per photo.
--    Face embeddings stored as JSON (512 floats, ArcFace/InsightFace).
--    All cross-referencing and member matching happens here.
-- ============================================================
CREATE TABLE IF NOT EXISTS photo_detections (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    photo_id            VARCHAR(80)     NOT NULL,
    person_index        TINYINT         NOT NULL DEFAULT 0,  -- 0,1,2... left→right
    -- Bib OCR
    bib_raw             VARCHAR(30)     NULL,        -- raw OCR: "_234", "B1234"
    bib_normalized      VARCHAR(20)     NULL,        -- cleaned digits: "1234"
    bib_confidence      FLOAT           NULL,
    -- Face AI
    face_embedding      JSON            NULL,        -- float[512] ArcFace vector
    face_bbox           JSON            NULL,        -- {"x":int,"y":int,"w":int,"h":int}
    face_score          FLOAT           NULL,        -- detection confidence
    head_yaw            FLOAT           NULL,        -- -90=left, 0=front, 90=right
    head_pitch          FLOAT           NULL,
    has_glasses         BOOLEAN         NULL,
    has_hat             BOOLEAN         NULL,
    face_occluded       FLOAT           NULL,        -- 0=clear → 1=fully covered
    clothing_colors     JSON            NULL,        -- [{"hex":"#ff0000","pct":0.42},...]
    -- Member matching
    matched_member_id   VARCHAR(10)     NULL,
    match_score         FLOAT           NULL,        -- 0.0 → 1.0
    match_method        ENUM('auto','manual','bib_only','face_only','user_confirmed') NULL,
    match_reviewed_by   VARCHAR(100)    NULL,
    match_reviewed_at   DATETIME        NULL,
    -- User feedback flags
    is_wrong            BOOLEAN         NOT NULL DEFAULT FALSE,
    wrong_reported_by   VARCHAR(10)     NULL,
    wrong_reported_at   DATETIME        NULL,

    PRIMARY KEY (id),
    INDEX idx_det_photo     (photo_id),
    INDEX idx_det_member    (matched_member_id),
    INDEX idx_det_bib       (bib_normalized),
    FOREIGN KEY (photo_id) REFERENCES photos(photo_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 4. PHOTO_FAVORITES
--    Member's starred photos. Simple many-to-many.
-- ============================================================
CREATE TABLE IF NOT EXISTS photo_favorites (
    member_id           VARCHAR(10)     NOT NULL,
    photo_id            VARCHAR(80)     NOT NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (member_id, photo_id),
    INDEX idx_fav_photo     (photo_id),
    FOREIGN KEY (photo_id)  REFERENCES photos(photo_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 5. PHOTO_FEEDBACK
--    One row per member per photo: star rating + story caption.
--    Story is displayed publicly within the portal under the photo.
-- ============================================================
CREATE TABLE IF NOT EXISTS photo_feedback (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    photo_id            VARCHAR(80)     NOT NULL,
    member_id           VARCHAR(10)     NOT NULL,
    rating              TINYINT         NULL,        -- 1–5 stars, NULL = not rated
    story               TEXT            NULL,        -- member caption / memory
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_feedback          (photo_id, member_id),
    INDEX idx_feedback_member       (member_id),
    FOREIGN KEY (photo_id)          REFERENCES photos(photo_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 6. MEMBER_REFERENCE_PHOTOS
--    Face crops that members have added to their reference library.
--    Used by match.py to improve face matching accuracy.
--    No limit per member. Stored as face crops in Azure Blob.
-- ============================================================
CREATE TABLE IF NOT EXISTS member_reference_photos (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    member_id           VARCHAR(10)     NOT NULL,
    photo_id            VARCHAR(80)     NOT NULL,    -- source event photo
    detection_id        BIGINT          NULL,        -- which detection was cropped
    blob_url            VARCHAR(500)    NULL,        -- Azure Blob URL for the face crop
    face_embedding      JSON            NULL,        -- pre-computed embedding for this crop
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    added_at            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_ref_member    (member_id),
    INDEX idx_ref_photo     (photo_id),
    FOREIGN KEY (photo_id)  REFERENCES photos(photo_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 7. MEMBER_BIB_ASSIGNMENTS
--    Bib number ↔ member ↔ event.
--    Sources: NYRR auto-sync, member self-assign, admin bulk upload.
--    One member per bib per event (unique constraint).
-- ============================================================
CREATE TABLE IF NOT EXISTS member_bib_assignments (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    member_id           VARCHAR(10)     NOT NULL,
    event_id            VARCHAR(60)     NOT NULL,
    bib_number          VARCHAR(20)     NOT NULL,
    source              ENUM('nyrr_auto','member_self','admin_import') NOT NULL DEFAULT 'member_self',
    nyrr_event_code     VARCHAR(50)     NULL,        -- NYRR event code if source=nyrr_auto
    admin_reviewed      BOOLEAN         NOT NULL DEFAULT FALSE,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    UNIQUE KEY uq_bib_event         (event_id, bib_number),  -- one member per bib per event
    INDEX idx_bib_member            (member_id),
    INDEX idx_bib_event             (event_id),
    FOREIGN KEY (event_id)          REFERENCES photo_events(event_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 8. PHOTO_DETECTION_CORRECTIONS
--    User-submitted tag corrections.
--    Corrections are queued for admin review before being applied.
--    After admin approval → photo_detections.matched_member_id is updated.
-- ============================================================
CREATE TABLE IF NOT EXISTS photo_detection_corrections (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    detection_id        BIGINT          NOT NULL,
    reported_by         VARCHAR(10)     NOT NULL,    -- member who submitted
    correction_type     ENUM('wrong_person','correct_person','missing_person') NOT NULL,
    suggested_member_id VARCHAR(10)     NULL,        -- who they think it actually is
    note                TEXT            NULL,
    status              ENUM('pending','applied','rejected') NOT NULL DEFAULT 'pending',
    reviewed_by         VARCHAR(100)    NULL,
    reviewed_at         DATETIME        NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_corr_detection    (detection_id),
    INDEX idx_corr_reported     (reported_by),
    INDEX idx_corr_status       (status),
    FOREIGN KEY (detection_id)  REFERENCES photo_detections(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 9. PHOTO_TAG_INVITES
--    When a member wants to tag an unknown person and invite them to join MMR.
-- ============================================================
CREATE TABLE IF NOT EXISTS photo_tag_invites (
    id                  BIGINT          NOT NULL AUTO_INCREMENT,
    detection_id        BIGINT          NOT NULL,
    requested_by        VARCHAR(10)     NOT NULL,    -- member who initiated the invite
    invite_email        VARCHAR(255)    NULL,        -- email to send the invite to
    note                TEXT            NULL,
    status              ENUM('pending','sent','resolved','cancelled') NOT NULL DEFAULT 'pending',
    sent_at             DATETIME        NULL,
    created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (id),
    INDEX idx_invite_detection  (detection_id),
    INDEX idx_invite_email      (invite_email),
    FOREIGN KEY (detection_id)  REFERENCES photo_detections(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- Verification query — run after migration to confirm tables exist
-- ============================================================
-- SELECT table_name, table_rows
-- FROM information_schema.tables
-- WHERE table_schema = 'mmrdb'
--   AND table_name IN (
--     'photo_events','photos','photo_detections',
--     'photo_favorites','photo_feedback',
--     'member_reference_photos','member_bib_assignments',
--     'photo_detection_corrections','photo_tag_invites'
--   )
-- ORDER BY table_name;
