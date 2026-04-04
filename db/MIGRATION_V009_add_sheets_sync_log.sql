-- MIGRATION_V009: Add sheets_sync_log table for batch tracking & resume capability
-- Purpose: Track each batch of a sync operation to enable resuming from last success point
-- MySQL 5.7+ compatible (no multi-clause ALTERs)

-- Create sheets_sync_log table
CREATE TABLE IF NOT EXISTS `sheets_sync_log` (
  `SyncLogID` int NOT NULL AUTO_INCREMENT,
  `JobID` varchar(36) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Foreign key to sync_jobs.JobID',
  `ConfigKey` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Sync config key (e.g., export_members, import_transactions)',
  `Direction` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'sheet_to_mysql or mysql_to_sheet',
  `BatchNumber` int NOT NULL COMMENT 'Batch sequence (0, 1, 2, ...)',
  `BatchSize` int NOT NULL COMMENT 'Number of rows in this batch',
  `TotalRows` int NOT NULL COMMENT 'Total rows in entire sync operation',
  `StartedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When batch processing started',
  `CompletedAt` datetime DEFAULT NULL COMMENT 'When batch processing completed',
  `Status` enum('pending','processing','success','error') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `ErrorMessage` text COLLATE utf8mb4_unicode_ci COMMENT 'Error details if Status=error',
  `RowsProcessed` int NOT NULL DEFAULT 0 COMMENT 'Rows attempted in this batch',
  `RowsInserted` int NOT NULL DEFAULT 0 COMMENT 'Rows successfully inserted',
  `RowsUpdated` int NOT NULL DEFAULT 0 COMMENT 'Rows successfully updated',
  `RowsSkipped` int NOT NULL DEFAULT 0 COMMENT 'Rows skipped (duplicates, validation failures)',
  PRIMARY KEY (`SyncLogID`),
  UNIQUE KEY `uk_job_batch` (`JobID`, `BatchNumber`),
  KEY `idx_jobid` (`JobID`),
  KEY `idx_config_key` (`ConfigKey`),
  KEY `idx_status` (`Status`),
  KEY `idx_started_at` (`StartedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tracks sheets sync batches for resume capability and monitoring';

-- Create index on sync_jobs.JobID for FK lookup if not exists
CREATE INDEX IF NOT EXISTS idx_syncjob_jobid ON `sync_jobs`(`JobID`);

-- Optionally add foreign key constraint (comment out if sync_jobs.JobID is not a true PK)
ALTER TABLE `sheets_sync_log` ADD CONSTRAINT `fk_sheets_sync_log_jobid`
  FOREIGN KEY (`JobID`) REFERENCES `sync_jobs`(`JobID`) ON DELETE CASCADE;

-- Helper view: last successful batch per job
CREATE OR REPLACE VIEW v_last_successful_batch AS
SELECT
  JobID,
  ConfigKey,
  MAX(BatchNumber) AS LastSuccessfulBatch,
  MAX(StartedAt) AS LastSyncTime
FROM sheets_sync_log
WHERE Status = 'success'
GROUP BY JobID, ConfigKey;

-- Helper view: sync summary (for monitoring dashboard)
CREATE OR REPLACE VIEW v_sync_summary AS
SELECT
  JobID,
  ConfigKey,
  COUNT(*) AS TotalBatches,
  SUM(RowsInserted) AS TotalInserted,
  SUM(RowsUpdated) AS TotalUpdated,
  SUM(RowsSkipped) AS TotalSkipped,
  SUM(CASE WHEN Status = 'success' THEN 1 ELSE 0 END) AS SuccessfulBatches,
  SUM(CASE WHEN Status = 'error' THEN 1 ELSE 0 END) AS FailedBatches,
  MAX(CompletedAt) AS LastCompletedAt
FROM sheets_sync_log
GROUP BY JobID, ConfigKey;
