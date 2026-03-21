-- ============================================================
-- Migration 0001: Add sync metadata and snapshots
-- Purpose: Track bi-directional sync between Google Sheets and MySQL
-- Date: 2026-03-21
--
-- HOW TO RUN:
--   mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p mmrdb < 0001_sync_metadata.sql
--
-- SAFE TO RE-RUN: Uses CREATE TABLE IF NOT EXISTS
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- ============================================================
-- 1. SYNC_METADATA
--    Tracks sync state and modified timestamps
--    One row per Google Sheet being synced
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_metadata (
    sync_id             INT         AUTO_INCREMENT PRIMARY KEY,
    sheet_name          VARCHAR(100) NOT NULL UNIQUE,    -- e.g., 'Membership Master'
    spreadsheet_id      VARCHAR(255) NOT NULL,            -- Google Sheets ID
    last_synced_at      TIMESTAMP    NULL,                -- When we last synced
    last_sheets_modified TIMESTAMP   NULL,                -- When Google Sheets was last modified
    last_snapshot_hash  VARCHAR(64)  NULL,                -- SHA-256 of last snapshot
    sync_status         ENUM('idle', 'syncing', 'error') NOT NULL DEFAULT 'idle',
    last_error          TEXT         NULL,                -- Error message if sync_status = 'error'
    sync_direction      ENUM('sheets_to_mysql', 'mysql_to_sheets', 'bidirectional') DEFAULT 'bidirectional',
    rows_synced         INT          DEFAULT 0,           -- Last sync: number of rows processed
    rows_added          INT          DEFAULT 0,           -- Last sync: rows added
    rows_modified       INT          DEFAULT 0,           -- Last sync: rows modified
    rows_deleted        INT          DEFAULT 0,           -- Last sync: rows deleted
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_sync_sheet_name (sheet_name),
    INDEX idx_sync_status (sync_status),
    INDEX idx_sync_last_synced (last_synced_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Initialize for Membership Master sheet
INSERT INTO sync_metadata (sheet_name, spreadsheet_id, sync_direction)
VALUES ('Membership Master', '', 'bidirectional')
ON DUPLICATE KEY UPDATE spreadsheet_id = VALUES(spreadsheet_id);


-- ============================================================
-- 2. SYNC_SNAPSHOTS
--    History of Google Sheets snapshots
--    Append-only; used to detect changes between syncs
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_snapshots (
    snapshot_id         BIGINT      AUTO_INCREMENT PRIMARY KEY,
    sheet_name          VARCHAR(100) NOT NULL,
    snapshot_hash       VARCHAR(64)  NOT NULL,            -- SHA-256 of snapshot data
    row_count           INT          NOT NULL,            -- Number of rows in snapshot
    snapshot_timestamp  DATETIME     NOT NULL,            -- When snapshot was taken
    google_modified_at  DATETIME     NULL,                -- Google Sheets modification time at snapshot
    snapshot_data_url   VARCHAR(500) NULL,                -- URL to blob storage (if too large for DB)
    status              ENUM('new', 'processed', 'error') NOT NULL DEFAULT 'new',
    processed_at        DATETIME     NULL,
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

    INDEX idx_snapshots_sheet_name (sheet_name),
    INDEX idx_snapshots_timestamp (snapshot_timestamp),
    INDEX idx_snapshots_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 3. SYNC_CHANGES
--    Log of detected changes between snapshots
--    One row per row that was added/modified/deleted
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_changes (
    change_id           BIGINT      AUTO_INCREMENT PRIMARY KEY,
    sheet_name          VARCHAR(100) NOT NULL,
    snapshot_id         BIGINT      NOT NULL,
    change_type         ENUM('added', 'modified', 'deleted') NOT NULL,
    row_key             VARCHAR(255) NOT NULL,            -- Primary key of row (usually email)
    old_values          JSON        NULL,                 -- Previous values (for modified/deleted)
    new_values          JSON        NULL,                 -- New values (for added/modified)
    sync_status         ENUM('pending', 'synced', 'conflict', 'error') NOT NULL DEFAULT 'pending',
    synced_at           DATETIME    NULL,
    conflict_resolution VARCHAR(50) NULL,                 -- 'sheets_wins' or 'mysql_wins'
    error_message       TEXT        NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_changes_sheet_name (sheet_name),
    INDEX idx_changes_snapshot_id (snapshot_id),
    INDEX idx_changes_type (change_type),
    INDEX idx_changes_sync_status (sync_status),
    INDEX idx_changes_row_key (row_key),

    CONSTRAINT fk_changes_snapshot
        FOREIGN KEY (snapshot_id) REFERENCES sync_snapshots(snapshot_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 4. SYNC_CONFLICTS
--    Conflicts when the same row changed in both systems
--    Manual review required by admin
-- ============================================================
CREATE TABLE IF NOT EXISTS sync_conflicts (
    conflict_id         BIGINT      AUTO_INCREMENT PRIMARY KEY,
    sheet_name          VARCHAR(100) NOT NULL,
    row_key             VARCHAR(255) NOT NULL,            -- Primary key of row (usually email)
    change_id           BIGINT      NULL,

    -- Google Sheets version
    sheets_values       JSON        NOT NULL,
    sheets_modified_at  DATETIME    NOT NULL,

    -- MySQL version
    mysql_values        JSON        NOT NULL,
    mysql_modified_at   DATETIME    NOT NULL,

    -- Resolution
    resolved            BOOLEAN     NOT NULL DEFAULT FALSE,
    resolution          ENUM('sheets_wins', 'mysql_wins', 'manual_merge') NULL,
    resolved_by         VARCHAR(255) NULL,
    resolved_at         DATETIME    NULL,
    resolved_values     JSON        NULL,

    notes               TEXT        NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    INDEX idx_conflicts_sheet_name (sheet_name),
    INDEX idx_conflicts_resolved (resolved),
    INDEX idx_conflicts_row_key (row_key),

    CONSTRAINT fk_conflicts_change
        FOREIGN KEY (change_id) REFERENCES sync_changes(change_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- Record migration in schema_migrations
-- ============================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
    version             VARCHAR(50)  NOT NULL PRIMARY KEY,
    description         VARCHAR(500),
    executed_at         TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO schema_migrations (version, description) VALUES
('0001', 'Add sync metadata and snapshots tables')
ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;


SET FOREIGN_KEY_CHECKS = 1;

-- End of migration 0001
