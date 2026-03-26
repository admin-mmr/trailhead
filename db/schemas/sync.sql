-- ============================================================
-- Sync Schema (Source of Truth)
-- Bi-directional sync between Google Sheets and MySQL
-- ============================================================

-- Track sync state per sheet
CREATE TABLE IF NOT EXISTS sync_metadata (
    sync_id             INT         AUTO_INCREMENT PRIMARY KEY,
    sheet_name          VARCHAR(100) NOT NULL UNIQUE,
    spreadsheet_id      VARCHAR(255) NOT NULL,
    last_synced_at      TIMESTAMP    NULL,
    last_sheets_modified TIMESTAMP   NULL,
    last_snapshot_hash  VARCHAR(64)  NULL,
    sync_status         ENUM('idle', 'syncing', 'error') NOT NULL DEFAULT 'idle',
    last_error          TEXT         NULL,
    sync_direction      ENUM('sheets_to_mysql', 'mysql_to_sheets', 'bidirectional') DEFAULT 'bidirectional',
    rows_synced         INT          DEFAULT 0,
    rows_added          INT          DEFAULT 0,
    rows_modified       INT          DEFAULT 0,
    rows_deleted        INT          DEFAULT 0,
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (sheet_name),
    INDEX (sync_status),
    INDEX (last_synced_at)
);

-- Historical snapshots of Google Sheets
CREATE TABLE IF NOT EXISTS sync_snapshots (
    snapshot_id         BIGINT      AUTO_INCREMENT PRIMARY KEY,
    sheet_name          VARCHAR(100) NOT NULL,
    snapshot_hash       VARCHAR(64)  NOT NULL,
    row_count           INT          NOT NULL,
    snapshot_timestamp  DATETIME     NOT NULL,
    google_modified_at  DATETIME     NULL,
    snapshot_data_url   VARCHAR(500) NULL,
    status              ENUM('new', 'processed', 'error') NOT NULL DEFAULT 'new',
    processed_at        DATETIME     NULL,
    created_at          TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX (sheet_name),
    INDEX (snapshot_timestamp),
    INDEX (status)
);

-- Detected changes between snapshots
CREATE TABLE IF NOT EXISTS sync_changes (
    change_id           BIGINT      AUTO_INCREMENT PRIMARY KEY,
    sheet_name          VARCHAR(100) NOT NULL,
    snapshot_id         BIGINT      NOT NULL,
    change_type         ENUM('added', 'modified', 'deleted') NOT NULL,
    row_key             VARCHAR(255) NOT NULL,
    old_values          JSON        NULL,
    new_values          JSON        NULL,
    sync_status         ENUM('pending', 'synced', 'conflict', 'error') NOT NULL DEFAULT 'pending',
    synced_at           DATETIME    NULL,
    conflict_resolution VARCHAR(50) NULL,
    error_message       TEXT        NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (sheet_name),
    INDEX (snapshot_id),
    INDEX (change_type),
    INDEX (sync_status),
    INDEX (row_key),
    CONSTRAINT fk_changes_snapshot
        FOREIGN KEY (snapshot_id) REFERENCES sync_snapshots(snapshot_id) ON DELETE CASCADE
);

-- Conflicts requiring manual resolution
CREATE TABLE IF NOT EXISTS sync_conflicts (
    conflict_id         BIGINT      AUTO_INCREMENT PRIMARY KEY,
    sheet_name          VARCHAR(100) NOT NULL,
    row_key             VARCHAR(255) NOT NULL,
    change_id           BIGINT      NULL,
    sheets_values       JSON        NOT NULL,
    sheets_modified_at  DATETIME    NOT NULL,
    mysql_values        JSON        NOT NULL,
    mysql_modified_at   DATETIME    NOT NULL,
    resolved            BOOLEAN     NOT NULL DEFAULT FALSE,
    resolution          ENUM('sheets_wins', 'mysql_wins', 'manual_merge') NULL,
    resolved_by         VARCHAR(255) NULL,
    resolved_at         DATETIME    NULL,
    resolved_values     JSON        NULL,
    notes               TEXT        NULL,
    created_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at          TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (sheet_name),
    INDEX (resolved),
    INDEX (row_key),
    CONSTRAINT fk_conflicts_change
        FOREIGN KEY (change_id) REFERENCES sync_changes(change_id) ON DELETE SET NULL
);
