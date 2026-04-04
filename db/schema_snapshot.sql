-- Schema export for mmrdb
-- Timestamp: 2026-04-04T16:28:10.188815 UTC

-- TABLES
CREATE TABLE `activity_log` (
  `LogID` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `SessionID` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `MemberID` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `EventID` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Action` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `State` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ErrorCode` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ErrorMessage` text COLLATE utf8mb4_unicode_ci,
  `ErrorContext` json DEFAULT NULL COMMENT 'Detailed error info: {field, value, constraint, suggestion}',
  `ErrorSeverity` enum('INFO','WARNING','ERROR','CRITICAL') COLLATE utf8mb4_unicode_ci DEFAULT 'ERROR' COMMENT 'Error classification level',
  `StackTrace` text COLLATE utf8mb4_unicode_ci COMMENT 'Python/Node stack trace if available',
  PRIMARY KEY (`LogID`),
  KEY `idx_actlog_memberid` (`MemberID`),
  KEY `idx_actlog_timestamp` (`Timestamp`),
  KEY `idx_actlog_action` (`Action`),
  KEY `idx_actlog_sessionid` (`SessionID`),
  KEY `idx_error_code` (`ErrorCode`),
  KEY `idx_error_severity` (`ErrorSeverity`),
  CONSTRAINT `chk_actlog_email_valid` CHECK (((`Email` is null) or (`Email` like _utf8mb4'%@%')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admin_member_overrides` (
  `OverrideID` int NOT NULL AUTO_INCREMENT,
  `AdminEmail` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Admin who performed the manual change',
  `TargetMemberID` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `ImpactedMemberIDs` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'Family members affected',
  `ActionType` enum('STATUS_CHANGE','EXPIRATION_OVERRIDE','LIFETIME_SET','INACTIVE_SET') COLLATE utf8mb4_unicode_ci NOT NULL,
  `OldValue` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `NewValue` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AdminNotes` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `Timestamp` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`OverrideID`),
  KEY `fk_override_member` (`TargetMemberID`),
  CONSTRAINT `fk_override_member` FOREIGN KEY (`TargetMemberID`) REFERENCES `members` (`MemberID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `admin_users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('admin','super_admin') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'admin',
  `added_by` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system',
  `added_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`),
  KEY `idx_admin_role` (`role`),
  KEY `idx_admin_email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=16 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `config` (
  `ConfigKey` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ConfigValue` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`ConfigKey`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `error_context` (
  `ErrorContextID` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'UUID for error tracking',
  `ErrorCode` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Matches activity_log.ErrorCode',
  `ErrorMessage` text COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'User-friendly error message',
  `TechnicalMessage` text COLLATE utf8mb4_unicode_ci COMMENT 'Technical details for debugging',
  `SuggestedFix` text COLLATE utf8mb4_unicode_ci COMMENT 'Recommended resolution action',
  `TableName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Which table had the issue',
  `ColumnName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Which column (if applicable)',
  `ConstraintName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Which constraint was violated',
  `ProblematicValue` text COLLATE utf8mb4_unicode_ci COMMENT 'The actual value that caused error',
  `ValidValueExamples` text COLLATE utf8mb4_unicode_ci COMMENT 'JSON array of valid example values',
  `AllowedRange` varchar(200) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'If numeric: min-max; if enum: allowed values',
  `OffendingRowID` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Row identifier (JSON for compound keys)',
  `OffendingRowContext` json DEFAULT NULL COMMENT 'Full row data (sensitive fields masked)',
  `DetectedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When error was first logged',
  `FirstOccurrence` datetime DEFAULT CURRENT_TIMESTAMP COMMENT 'When this error first happened',
  `LastOccurrence` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Most recent occurrence',
  `OccurrenceCount` int DEFAULT '1' COMMENT 'How many times this error occurred',
  `Severity` enum('INFO','WARNING','ERROR','CRITICAL') COLLATE utf8mb4_unicode_ci DEFAULT 'ERROR',
  `Status` enum('NEW','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','DUPLICATE','WONTFIX') COLLATE utf8mb4_unicode_ci DEFAULT 'NEW',
  `AssignedTo` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Admin email responsible for fix',
  `ResolutionNotes` text COLLATE utf8mb4_unicode_ci COMMENT 'How it was fixed',
  `ResolvedAt` datetime DEFAULT NULL,
  PRIMARY KEY (`ErrorContextID`),
  KEY `idx_error_code` (`ErrorCode`),
  KEY `idx_table_column` (`TableName`,`ColumnName`),
  KEY `idx_constraint` (`ConstraintName`),
  KEY `idx_severity_status` (`Severity`,`Status`),
  KEY `idx_detected_at` (`DetectedAt`),
  KEY `idx_status` (`Status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `gmail_transactions` (
  `TransactionNumber` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `Timestamp` datetime DEFAULT NULL COMMENT 'From Sheets/GAS',
  `Sender` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Amount` decimal(10,2) DEFAULT NULL COMMENT 'Total original amount',
  `Memo` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `TransactionDate` date DEFAULT NULL,
  `PaymentMethod` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Zelle, Venmo, etc.',
  `MessageId` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  `Subject` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `OriginalMemo` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  `Notes` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'User friendly split summary',
  `UpdatedAt` datetime DEFAULT NULL COMMENT 'Last linked time',
  PRIMARY KEY (`TransactionNumber`),
  CONSTRAINT `chk_gmail_amount_nonnegative` CHECK (((`Amount` is null) or (`Amount` >= 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `member_log` (
  `LogID` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `LoggingTime` datetime NOT NULL,
  `MemberID` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ChangeType` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Created` datetime DEFAULT NULL,
  `Expiration` date DEFAULT NULL,
  `Email` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FirstName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `LastName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Type` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FamilyID` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Gender` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `WeChatID` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `District` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `MembershipFeePaid` decimal(10,2) DEFAULT NULL,
  `PaymentDate` date DEFAULT NULL,
  `PaymentTransaction` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `JoinYear` smallint DEFAULT NULL,
  `PhoneNumber` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Notes` text COLLATE utf8mb4_unicode_ci,
  `NYRRRunnerName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `YearBorn` smallint DEFAULT NULL,
  PRIMARY KEY (`LogID`),
  KEY `idx_memberid` (`MemberID`),
  KEY `idx_loggingtime` (`LoggingTime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `members` (
  `MemberID` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Status` enum('active','expired','inactive','pending','pending_upgrade') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'active=paying; expired=may renew; inactive=left; pending=awaiting payment; pending_upgrade=upgrading to family',
  `Created` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `Expiration` date DEFAULT NULL,
  `Email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `FirstName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `LastName` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Type` enum('Individual','Family') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Individual',
  `FamilyID` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Gender` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `WeChatID` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `District` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `MembershipFeePaid` decimal(10,2) DEFAULT NULL,
  `PaymentDate` date DEFAULT NULL,
  `PaymentTransaction` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `JoinYear` smallint DEFAULT NULL,
  `PhoneNumber` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Notes` text COLLATE utf8mb4_unicode_ci,
  `NYRRRunnerName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `YearBorn` smallint DEFAULT NULL,
  `YearBornGuess` smallint DEFAULT NULL COMMENT 'System-inferred birth year from NYRR age data',
  `password_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `google_sub` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `microsoft_sub` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`MemberID`),
  UNIQUE KEY `uq_members_email` (`Email`),
  UNIQUE KEY `google_sub` (`google_sub`),
  UNIQUE KEY `microsoft_sub` (`microsoft_sub`),
  KEY `idx_status` (`Status`),
  KEY `idx_expiration` (`Expiration`),
  KEY `idx_family` (`FamilyID`),
  KEY `idx_joinyear` (`JoinYear`),
  CONSTRAINT `chk_members_email_valid` CHECK (((`Email` is null) or (`Email` like _utf8mb4'%@%'))),
  CONSTRAINT `chk_members_status_valid` CHECK ((`Status` in (_utf8mb4'active',_utf8mb4'expired',_utf8mb4'inactive',_utf8mb4'pending',_utf8mb4'pending_upgrade')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `nyrr_event_runners` (
  `id` int NOT NULL AUTO_INCREMENT,
  `nyrr_event_id` int NOT NULL,
  `nyrr_runner_id` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `runner_name` varchar(200) COLLATE utf8mb4_unicode_ci NOT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `age` smallint DEFAULT NULL,
  `gender` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `state_province` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `city` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `bib_number` varchar(20) COLLATE utf8mb4_unicode_ci NOT NULL,
  `finish_time` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `pace` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `overall_place` int DEFAULT NULL,
  `gender_place` int DEFAULT NULL,
  `age_grade_time` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `age_grade_place` int DEFAULT NULL,
  `age_grade_percent` decimal(5,2) DEFAULT NULL,
  `team_code` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sync_source` enum('finishers','mmr_team','both') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `is_registered_only` tinyint(1) NOT NULL DEFAULT '0',
  `mmr_member_id` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `match_method` enum('auto_name','auto_lastname','auto_firstlast','auto_partial_name','manual','not_member','unmatched') COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `matched_by` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `matched_at` datetime DEFAULT NULL,
  `scan_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_bib` (`nyrr_event_id`,`bib_number`),
  KEY `idx_runner_id` (`nyrr_runner_id`),
  KEY `idx_last_name` (`last_name`),
  KEY `idx_runner_name` (`runner_name`),
  KEY `idx_mmr_member` (`mmr_member_id`),
  KEY `idx_match_method` (`match_method`),
  KEY `idx_team_code` (`team_code`),
  CONSTRAINT `fk_event_runners_event` FOREIGN KEY (`nyrr_event_id`) REFERENCES `nyrr_events` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=353202 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `nyrr_events` (
  `id` int NOT NULL AUTO_INCREMENT,
  `event_code` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `event_url` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `location` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `distance` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `event_date` date DEFAULT NULL,
  `event_year` smallint DEFAULT NULL,
  `is_upcoming` tinyint(1) NOT NULL DEFAULT '0',
  `is_virtual` tinyint(1) NOT NULL DEFAULT '0',
  `processing_status` enum('Pending','InProgress','Completed','Error') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'Pending',
  `processed_at` datetime DEFAULT NULL,
  `processed_by` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `result_count` int NOT NULL DEFAULT '0',
  `nyrr_finisher_count` int DEFAULT NULL,
  `mmr_runner_count` int NOT NULL DEFAULT '0',
  `mmr_matched_count` int NOT NULL DEFAULT '0',
  `notes` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_event_code` (`event_code`),
  KEY `idx_event_date` (`event_date`),
  KEY `idx_event_year` (`event_year`),
  KEY `idx_processing_status` (`processing_status`),
  KEY `idx_is_upcoming` (`is_upcoming`),
  KEY `idx_finisher_count` (`nyrr_finisher_count`),
  KEY `idx_finisher_gap` (`event_date`,`nyrr_finisher_count`,`result_count`)
) ENGINE=InnoDB AUTO_INCREMENT=88 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `nyrr_processing_log` (
  `id` int NOT NULL AUTO_INCREMENT,
  `run_timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `triggered_by` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `nyrr_event_id` int DEFAULT NULL,
  `run_status` enum('Success','PartialSuccess','Failed') COLLATE utf8mb4_unicode_ci NOT NULL,
  `rows_written` int NOT NULL DEFAULT '0',
  `error_details` text COLLATE utf8mb4_unicode_ci,
  `created_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_log_run_timestamp` (`run_timestamp`),
  KEY `idx_log_run_status` (`run_status`),
  KEY `idx_log_event_id` (`nyrr_event_id`),
  CONSTRAINT `fk_processing_log_event` FOREIGN KEY (`nyrr_event_id`) REFERENCES `nyrr_events` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB AUTO_INCREMENT=95 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `password_reset_tokens` (
  `TokenID` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `TokenHash` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ExpiresAt` datetime NOT NULL,
  `Used` tinyint(1) NOT NULL DEFAULT '0',
  `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`TokenID`),
  KEY `idx_prt_email` (`Email`),
  KEY `idx_prt_expiresat` (`ExpiresAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `payments` (
  `PaymentID` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `MemberID` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PaymentDate` date DEFAULT NULL,
  `Amount` decimal(10,2) NOT NULL,
  `PaymentMethod` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PayerName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `MemoField` text COLLATE utf8mb4_unicode_ci,
  `Last4Digits` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ProcessedBy` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Source` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Notes` text COLLATE utf8mb4_unicode_ci,
  `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `TransactionNumber` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Linked to gmail_transactions.TransactionNumber',
  `SubmissionID` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Optional: Link to the user submission that started this',
  `PaymentType` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'Set at creation (e.g., Membership, Donation)',
  PRIMARY KEY (`PaymentID`),
  KEY `idx_payments_memberid` (`MemberID`),
  KEY `idx_payments_paymentdate` (`PaymentDate`),
  KEY `idx_pay_tx` (`TransactionNumber`),
  CONSTRAINT `fk_payments_member` FOREIGN KEY (`MemberID`) REFERENCES `members` (`MemberID`) ON DELETE SET NULL,
  CONSTRAINT `chk_payments_amount_nonnegative` CHECK ((`Amount` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `schema_migrations` (
  `version` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `executed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sheets_sync_log` (
  `SyncLogID` int NOT NULL AUTO_INCREMENT,
  `JobID` varchar(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Foreign key to sync_jobs.JobID',
  `ConfigKey` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'Sync config key (e.g., export_members, import_transactions)',
  `Direction` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'sheet_to_mysql or mysql_to_sheet',
  `BatchNumber` int NOT NULL COMMENT 'Batch sequence (0, 1, 2, ...)',
  `BatchSize` int NOT NULL COMMENT 'Number of rows in this batch',
  `TotalRows` int NOT NULL COMMENT 'Total rows in entire sync operation',
  `StartedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When batch processing started',
  `CompletedAt` datetime DEFAULT NULL COMMENT 'When batch processing completed',
  `Status` enum('pending','processing','success','error') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `ErrorMessage` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'Error details if Status=error',
  `RowsProcessed` int NOT NULL DEFAULT '0' COMMENT 'Rows attempted in this batch',
  `RowsInserted` int NOT NULL DEFAULT '0' COMMENT 'Rows successfully inserted',
  `RowsUpdated` int NOT NULL DEFAULT '0' COMMENT 'Rows successfully updated',
  `RowsSkipped` int NOT NULL DEFAULT '0' COMMENT 'Rows skipped (duplicates, validation failures)',
  PRIMARY KEY (`SyncLogID`),
  UNIQUE KEY `uk_job_batch` (`JobID`,`BatchNumber`),
  KEY `idx_jobid` (`JobID`),
  KEY `idx_config_key` (`ConfigKey`),
  KEY `idx_status` (`Status`),
  KEY `idx_started_at` (`StartedAt`),
  CONSTRAINT `fk_sheets_sync_log_jobid` FOREIGN KEY (`JobID`) REFERENCES `sync_jobs` (`JobID`) ON DELETE CASCADE
) ENGINE=InnoDB AUTO_INCREMENT=52 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Tracks sheets sync batches for resume capability and monitoring';

CREATE TABLE `submissions` (
  `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp when the user hits submit button',
  `SubmissionID` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'auto gen unique identifier (migrated from EventID)',
  `Status` enum('pending','approved','cancelled','expired') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'Logic: once submitted=pending; matched payment=approved; past ExpiresAt=expired; user action=cancelled',
  `MemberID` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'submitter MemberID from members table',
  `SubmissionType` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL COMMENT 'set at creation time (migrated from EventType)',
  `ExpiresAt` datetime DEFAULT NULL COMMENT 'set at creation time',
  `PaymentIntent` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'set at creation time',
  `Amount` decimal(10,2) DEFAULT NULL COMMENT 'set at creation time',
  `PaymentMethod` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'user input',
  `PayerName` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'user input',
  `PaymentDate` date DEFAULT NULL COMMENT 'user input',
  `MemoField` text CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci COMMENT 'user input',
  `Last4Digits` varchar(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'user input',
  `PaymentID` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'added when approved; links to payments table',
  `UpdatedByID` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci DEFAULT NULL COMMENT 'ID who updated this record the last time',
  `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'trigger at update',
  PRIMARY KEY (`SubmissionID`),
  KEY `fk_submission_member` (`MemberID`),
  KEY `idx_submissions_status` (`Status`),
  KEY `idx_submissions_expires` (`ExpiresAt`),
  KEY `idx_submissions_status_expires` (`Status`,`ExpiresAt`),
  CONSTRAINT `fk_submission_member` FOREIGN KEY (`MemberID`) REFERENCES `members` (`MemberID`) ON DELETE CASCADE,
  CONSTRAINT `chk_submissions_amount_nonnegative` CHECK (((`Amount` is null) or (`Amount` >= 0))),
  CONSTRAINT `chk_submissions_status_valid` CHECK ((`Status` in (_utf8mb4'pending',_utf8mb4'approved',_utf8mb4'cancelled',_utf8mb4'expired')))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sync_jobs` (
  `JobID` varchar(16) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Operation` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Status` enum('queued','running','done','error') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'queued',
  `Message` text COLLATE utf8mb4_unicode_ci,
  `Progress` int DEFAULT '0',
  `Result` longtext COLLATE utf8mb4_unicode_ci,
  `StartedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `UpdatedAt` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `CompletedAt` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`JobID`),
  KEY `Status` (`Status`),
  KEY `StartedAt` (`StartedAt`),
  KEY `UpdatedAt` (`UpdatedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `viewer_user_settings` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `table_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `visible_columns` json DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_user_table` (`email`,`table_name`)
) ENGINE=InnoDB AUTO_INCREMENT=2 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================
-- VIEWS
-- ==========================================
DROP VIEW IF EXISTS `v_family_members`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_family_members` AS 
SELECT 
    `m`.`FamilyID` AS `FamilyID`,
   min(`m`.`MemberID`) OVER (PARTITION BY `m`.`FamilyID` )  AS `primary_member_id`,
   `m`.`MemberID` AS `member_id`,
   `m`.`FirstName` AS `FirstName`,
   `m`.`LastName` AS `LastName`,
   `m`.`Email` AS `Email`,
   `m`.`Status` AS `Status`,
   `m`.`Expiration` AS `Expiration`,
   `m`.`Type` AS `Type`
FROM `members` `m`
WHERE (`m`.`FamilyID` is not null);

DROP VIEW IF EXISTS `v_gmail_split_audit`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_gmail_split_audit` AS 
SELECT 
    `gt`.`TransactionNumber` AS `TransactionNumber`,
   `gt`.`Amount` AS `Total`,
   ifnull(sum(`p`.`Amount`),
   0) AS `Allocated`,
   (`gt`.`Amount` - ifnull(sum(`p`.`Amount`),
   0)) AS `Balance`,
   `gt`.`Notes` AS `SplitHistory`
FROM (`gmail_transactions` `gt`
LEFT JOIN `payments` `p` on((`gt`.`TransactionNumber` = `p`.`TransactionNumber`)))
GROUP BY `gt`.`TransactionNumber`;

DROP VIEW IF EXISTS `v_last_successful_batch`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_last_successful_batch` AS 
SELECT 
    `sheets_sync_log`.`JobID` AS `JobID`,
   `sheets_sync_log`.`ConfigKey` AS `ConfigKey`,
   max(`sheets_sync_log`.`BatchNumber`) AS `LastSuccessfulBatch`,
   max(`sheets_sync_log`.`StartedAt`) AS `LastSyncTime`
FROM `sheets_sync_log`
WHERE (`sheets_sync_log`.`Status` = 'success')
GROUP BY `sheets_sync_log`.`JobID`,
   `sheets_sync_log`.`ConfigKey`;

DROP VIEW IF EXISTS `v_payment_details`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_payment_details` AS 
SELECT 
    `p`.`PaymentID` AS `PaymentID`,
   `p`.`CreatedAt` AS `CreatedAt`,
   `m`.`MemberID` AS `MemberID`,
   concat(`m`.`FirstName`,
   ' ',
   `m`.`LastName`) AS `MemberFullName`,
   `m`.`FamilyID` AS `FamilyID`,
   `p`.`PaymentType` AS `PaymentType`,
   `p`.`Amount` AS `Amount`,
   `p`.`PaymentDate` AS `PaymentDate`,
   `p`.`TransactionNumber` AS `TransactionNumber`,
   `s`.`SubmissionType` AS `SubmissionType`,
   `p`.`ProcessedBy` AS `ProcessedBy`,
   `p`.`Source` AS `Source`
FROM ((`payments` `p` join `members` `m` on((`p`.`MemberID` = `m`.`MemberID`)))
LEFT JOIN `submissions` `s` on((`p`.`SubmissionID` = `s`.`SubmissionID`)));

DROP VIEW IF EXISTS `v_payment_splits`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_payment_splits` AS 
SELECT 
    `gt`.`TransactionNumber` AS `TransactionNumber`,
   `gt`.`Amount` AS `OriginalTotal`,
   (select sum(`p`.`Amount`)
FROM `payments` `p`
WHERE (`p`.`TransactionNumber` = `gt`.`TransactionNumber`)) AS `TotalAllocated`,
   (`gt`.`Amount` - (select ifnull(sum(`p`.`Amount`),
   0)
FROM `payments` `p`
WHERE (`p`.`TransactionNumber` = `gt`.`TransactionNumber`))) AS `RemainingBalance`
FROM `gmail_transactions` `gt`;

DROP VIEW IF EXISTS `v_sync_summary`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_sync_summary` AS 
SELECT 
    `sheets_sync_log`.`JobID` AS `JobID`,
   `sheets_sync_log`.`ConfigKey` AS `ConfigKey`,
   count(0) AS `TotalBatches`,
   sum(`sheets_sync_log`.`RowsInserted`) AS `TotalInserted`,
   sum(`sheets_sync_log`.`RowsUpdated`) AS `TotalUpdated`,
   sum(`sheets_sync_log`.`RowsSkipped`) AS `TotalSkipped`,
   sum((case when (`sheets_sync_log`.`Status` = 'success') then 1 else 0 end)) AS `SuccessfulBatches`,
   sum((case when (`sheets_sync_log`.`Status` = 'error') then 1 else 0 end)) AS `FailedBatches`,
   max(`sheets_sync_log`.`CompletedAt`) AS `LastCompletedAt`
FROM `sheets_sync_log`
GROUP BY `sheets_sync_log`.`JobID`,
   `sheets_sync_log`.`ConfigKey`;

DROP VIEW IF EXISTS `v_unresolved_errors`;
CREATE ALGORITHM=UNDEFINED SQL SECURITY DEFINER VIEW `v_unresolved_errors` AS 
SELECT 
    `error_context`.`ErrorContextID` AS `ErrorContextID`,
   `error_context`.`ErrorCode` AS `ErrorCode`,
   `error_context`.`ErrorMessage` AS `ErrorMessage`,
   `error_context`.`TableName` AS `TableName`,
   `error_context`.`ColumnName` AS `ColumnName`,
   `error_context`.`Severity` AS `Severity`,
   `error_context`.`OccurrenceCount` AS `OccurrenceCount`,
   `error_context`.`LastOccurrence` AS `LastOccurrence`,
   `error_context`.`AssignedTo` AS `AssignedTo`,
   `error_context`.`SuggestedFix` AS `SuggestedFix`,
   (case when (`error_context`.`Severity` = 'CRITICAL') then 'URGENT' when ((`error_context`.`Severity` = 'ERROR') and (`error_context`.`OccurrenceCount` > 5)) then 'HIGH' when (`error_context`.`Severity` = 'ERROR') then 'MEDIUM' else 'LOW' end) AS `priority`
FROM `error_context`
WHERE (`error_context`.`Status` in ('NEW',
   'ACKNOWLEDGED',
   'IN_PROGRESS')) order by field(`error_context`.`Severity`,
   'CRITICAL',
   'ERROR',
   'WARNING',
   'INFO') desc,
   `error_context`.`OccurrenceCount` desc,
   `error_context`.`LastOccurrence` desc;

-- PROCEDURES
CREATE PROCEDURE `generate_member_id`(OUT new_id VARCHAR(10))
BEGIN
    DECLARE max_num INT DEFAULT 0;
    START TRANSACTION;
        SELECT COALESCE(MAX(CAST(SUBSTRING(MemberID, 2) AS UNSIGNED)), 0) INTO max_num FROM members FOR UPDATE;
        SET new_id = CONCAT('A', LPAD(max_num + 1, 4, '0'));
    COMMIT;
END;

CREATE PROCEDURE `sp_admin_update_member_status`(
    IN p_AdminEmail VARCHAR(255),
    IN p_MemberID VARCHAR(10),
    IN p_NewStatus VARCHAR(20),
    IN p_NewExpiration DATE,
    IN p_NewNotes TEXT
)
BEGIN
    DECLARE v_FamilyID VARCHAR(10);
    DECLARE v_OldStatus VARCHAR(20);
    DECLARE v_ImpactedIDs TEXT;
    DECLARE v_CalculatedAction VARCHAR(50);

    SELECT Status, FamilyID INTO v_OldStatus, v_FamilyID FROM members WHERE MemberID = p_MemberID;

    SET v_CalculatedAction = CASE
        WHEN p_NewStatus = 'lifetime' THEN 'LIFETIME_SET'
        WHEN v_OldStatus = 'expired' AND p_NewStatus = 'inactive' THEN 'INACTIVE_SET'
        WHEN p_NewExpiration IS NOT NULL THEN 'EXPIRATION_OVERRIDE'
        ELSE 'STATUS_CHANGE'
    END;

    IF v_FamilyID IS NOT NULL THEN
        SELECT GROUP_CONCAT(MemberID) INTO v_ImpactedIDs FROM members WHERE FamilyID = v_FamilyID;
    ELSE
        SET v_ImpactedIDs = p_MemberID;
    END IF;

    SET @internal_proc = 1;

    UPDATE members
    SET
        Status = IFNULL(p_NewStatus, Status),
        Expiration = IFNULL(p_NewExpiration, Expiration),
        Notes = CONCAT(IFNULL(Notes, ''), '\n--- Admin Override (', p_AdminEmail, ' ', NOW(), ') ---\n', p_NewNotes)
    WHERE (v_FamilyID IS NOT NULL AND FamilyID = v_FamilyID) OR MemberID = p_MemberID;

    SET @internal_proc = NULL;

    INSERT INTO admin_member_overrides (
        AdminEmail, TargetMemberID, ImpactedMemberIDs, ActionType, OldValue, NewValue, AdminNotes
    )
    VALUES (
        p_AdminEmail, p_MemberID, v_ImpactedIDs, v_CalculatedAction, v_OldStatus, IFNULL(p_NewStatus, v_OldStatus), p_NewNotes
    );
END;

CREATE PROCEDURE `sp_error_summary_report`(IN days_back INT)
BEGIN
  
  SELECT
    `ErrorCode`,
    `TableName`,
    `ColumnName`,
    `Severity`,
    `Status`,
    COUNT(*) as occurrence_count,
    MIN(`FirstOccurrence`) as first_seen,
    MAX(`LastOccurrence`) as last_seen,
    GROUP_CONCAT(DISTINCT `OffendingRowID` SEPARATOR ', ') as sample_row_ids,
    MAX(`SuggestedFix`) as recommended_fix
  FROM `error_context`
  WHERE `DetectedAt` >= NOW() - INTERVAL days_back DAY
  GROUP BY `ErrorCode`, `Severity`, `Status`
  ORDER BY occurrence_count DESC, `Severity` DESC;
END;

CREATE PROCEDURE `sp_link_transaction`(
    IN p_TxNum VARCHAR(100),
    IN p_MemID VARCHAR(10),
    IN p_Type VARCHAR(50),
    IN p_Amt DECIMAL(10,2),
    IN p_Admin VARCHAR(255),
    IN p_SubID VARCHAR(50)
)
BEGIN
    INSERT INTO payments (PaymentID, MemberID, TransactionNumber, Amount, SubmissionID, PaymentType, ProcessedBy)
    VALUES (UUID(), p_MemID, p_TxNum, p_Amt, p_SubID, p_Type, p_Admin);

    UPDATE gmail_transactions
    SET
        UpdatedAt = NOW(),
        Notes = CONCAT(IFNULL(Notes, ''), '\n[', NOW(), '] Linked: ', p_MemID, ' (', p_Type, ') $', p_Amt)
    WHERE TransactionNumber = p_TxNum;
END;

-- TRIGGERS
CREATE TRIGGER `trg_payments_auto_fill` BEFORE INSERT ON `payments` FOR EACH ROW BEGIN
    IF NEW.TransactionNumber IS NOT NULL THEN
        SELECT PaymentDate, PaymentMethod, Sender, Memo
        INTO @d, @m, @p, @memo
        FROM gmail_transactions
        WHERE TransactionNumber = NEW.TransactionNumber
        LIMIT 1;
        SET NEW.PaymentDate = @d;
        SET NEW.PaymentMethod = @m;
        SET NEW.PayerName = @p;
        SET NEW.MemoField = @memo;
    END IF;
END;

CREATE TRIGGER `trg_payments_limit_check_insert` BEFORE INSERT ON `payments` FOR EACH ROW BEGIN
    DECLARE v_max DECIMAL(10,2);
    DECLARE v_used DECIMAL(10,2);
    SELECT Amount INTO v_max FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;
    SELECT IFNULL(SUM(Amount), 0) INTO v_used FROM payments WHERE TransactionNumber = NEW.TransactionNumber;
    IF (v_used + NEW.Amount) > v_max THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Split Error: Total payments exceed Gmail Transaction amount.';
    END IF;
END;

CREATE TRIGGER `trg_payments_limit_check_update` BEFORE UPDATE ON `payments` FOR EACH ROW BEGIN
    DECLARE v_max_total DECIMAL(10,2);
DECLARE v_used_others DECIMAL(10,2);
DECLARE v_rem DECIMAL(10,2);
DECLARE v_msg VARCHAR(128);
SELECT Amount INTO v_max_total 
    FROM gmail_transactions 
    WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;
SELECT IFNULL(SUM(Amount), 0) INTO v_used_others 
    FROM payments 
    WHERE TransactionNumber = NEW.TransactionNumber AND PaymentID <> OLD.PaymentID;
SET v_rem = v_max_total - v_used_others;
IF NEW.Amount > v_rem THEN
        SET v_msg = CONCAT('Limit Exceeded: Try $', NEW.Amount, ', but only $', v_rem, ' left on TX: ', LEFT(NEW.TransactionNumber, 20));
SIGNAL SQLSTATE '45000' 
        SET MESSAGE_TEXT = v_msg;
END IF;
END;

CREATE TRIGGER `trg_payments_sync_membership_only` AFTER INSERT ON `payments` FOR EACH ROW BEGIN
    DECLARE v_FamilyID VARCHAR(10);

    IF NEW.PaymentType LIKE '%Membership%' THEN
        SELECT FamilyID INTO v_FamilyID FROM members WHERE MemberID = NEW.MemberID;
        SET @internal_proc = 1;
        UPDATE members
        SET
            Status = 'active',
            PaymentDate = NEW.PaymentDate,
            PaymentTransaction = NEW.TransactionNumber,
            MembershipFeePaid = NEW.Amount,
            Expiration = DATE_ADD(NEW.PaymentDate, INTERVAL 1 YEAR)
        WHERE (v_FamilyID IS NOT NULL AND FamilyID = v_FamilyID)
           OR MemberID = NEW.MemberID;
        SET @internal_proc = NULL;
    END IF;
END;

CREATE TRIGGER `trg_payments_approve_submission` AFTER INSERT ON `payments` FOR EACH ROW BEGIN
    IF NEW.SubmissionID IS NOT NULL THEN
        UPDATE submissions
        SET
            Status = 'approved',
            PaymentID = NEW.PaymentID,
            UpdatedByID = NEW.ProcessedBy
        WHERE SubmissionID = NEW.SubmissionID;
    END IF;
END;

CREATE TRIGGER `trg_payments_insert_validate` BEFORE INSERT ON `payments` FOR EACH ROW BEGIN
  DECLARE error_context_id VARCHAR(50);
  DECLARE error_msg TEXT;

  SET error_context_id = UUID();

  IF NEW.`Amount` IS NOT NULL AND NEW.`Amount` < 0 THEN
    SET error_msg = CONCAT(
      'Payment amount cannot be negative: ', NEW.`Amount`, '. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, 'PAY_NEGATIVE_AMOUNT',
      'Payment amount is negative',
      CONCAT('Amount validation failed: ', NEW.`Amount`),
      'payments', 'Amount', CAST(NEW.`Amount` AS CHAR),
      '>= 0',
      'Check payment amount calculation. Use absolute value if needed.',
      'WARNING'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`SubmissionID` IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM `submissions` WHERE `SubmissionID` = NEW.`SubmissionID`) THEN
      SET error_msg = CONCAT(
        'SubmissionID "', NEW.`SubmissionID`, '" does not exist. ',
        'Error: ', error_context_id
      );
      INSERT INTO `error_context` (
        `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
        `TableName`, `ColumnName`, `ConstraintName`, `ProblematicValue`,
        `SuggestedFix`, `Severity`
      ) VALUES (
        error_context_id, 'PAY_FK_INVALID_SUBMISSION',
        CONCAT('Referenced submission not found: ', NEW.`SubmissionID`),
        'Foreign key validation failed on payments.SubmissionID',
        'payments', 'SubmissionID', 'fk_payments_submissions',
        NEW.`SubmissionID`,
        'Verify SubmissionID exists before linking payment. Or leave NULL if payment is standalone.',
        'WARNING'
      );
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
    END IF;
  END IF;
END;

CREATE TRIGGER `trg_submissions_insert_validate` BEFORE INSERT ON `submissions` FOR EACH ROW BEGIN
  DECLARE error_context_id VARCHAR(50);
  DECLARE error_msg TEXT;
  DECLARE error_code VARCHAR(50);

  SET error_context_id = UUID();

  IF NEW.`SubmissionID` IS NULL THEN
    SET error_code = 'SUBM_NULL_ID';
    SET error_msg = CONCAT(
      'Submission ID cannot be NULL. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `ValidValueExamples`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      'Cannot create submission without unique ID',
      'SubmissionID column received NULL value on INSERT',
      'submissions', 'SubmissionID', 'NULL',
      '["sub_abc123xyz", "sub_2026_001"]',
      'Ensure UUID is generated before INSERT. Check application code.',
      'CRITICAL'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM `members` WHERE `MemberID` = NEW.`MemberID`) THEN
    SET error_code = 'SUBM_FK_INVALID_MEMBER';
    SET error_msg = CONCAT(
      'MemberID "', NEW.`MemberID`, '" does not exist in members table. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ConstraintName`, `ProblematicValue`,
      `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      CONCAT('Invalid MemberID: ', NEW.`MemberID`),
      'Foreign key validation failed: referenced member does not exist',
      'submissions', 'MemberID', 'fk_submissions_members',
      NEW.`MemberID`,
      'Verify MemberID exists in members table before creating submission',
      'ERROR'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`Status` NOT IN ('pending','approved','cancelled','expired') THEN
    SET error_code = 'SUBM_INVALID_STATUS';
    SET error_msg = CONCAT(
      'Invalid Status value: "', NEW.`Status`, '". ',
      'Allowed: pending, approved, cancelled, expired. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `ValidValueExamples`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      CONCAT('Invalid submission status: ', NEW.`Status`),
      'Status enum constraint violated',
      'submissions', 'Status', NEW.`Status`,
      'pending | approved | cancelled | expired',
      '["pending", "approved"]',
      'Use one of the allowed status values. Default is "pending".',
      'ERROR'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`Amount` IS NOT NULL AND NEW.`Amount` < 0 THEN
    SET error_code = 'SUBM_NEGATIVE_AMOUNT';
    SET error_msg = CONCAT(
      'Amount cannot be negative: ', NEW.`Amount`, '. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, error_code,
      'Submission amount is negative',
      'Amount validation failed: received negative value',
      'submissions', 'Amount', CAST(NEW.`Amount` AS CHAR),
      '>= 0',
      'Ensure amount is positive. Use absolute value or check calculation logic.',
      'WARNING'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;
END;

CREATE TRIGGER `trg_members_insert_validate` BEFORE INSERT ON `members` FOR EACH ROW BEGIN
  DECLARE error_context_id VARCHAR(50);
  DECLARE error_msg TEXT;

  SET error_context_id = UUID();

  IF NEW.`Email` IS NOT NULL AND NEW.`Email` NOT LIKE '%@%' THEN
    SET error_msg = CONCAT(
      'Invalid email format: "', NEW.`Email`, '". Must contain @. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `ValidValueExamples`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, 'MEM_INVALID_EMAIL',
      CONCAT('Email format invalid: ', NEW.`Email`),
      'Email validation failed: missing @ symbol',
      'members', 'Email', NEW.`Email`,
      '["john@example.com", "jane.doe@company.org"]',
      'Verify email address format matches standard email pattern (user@domain.com)',
      'WARNING'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;

  IF NEW.`Status` NOT IN ('active','expired','inactive','pending') THEN
    SET error_msg = CONCAT(
      'Invalid Status: "', NEW.`Status`, '". ',
      'Allowed: active, expired, inactive, pending. ',
      'Error: ', error_context_id
    );
    INSERT INTO `error_context` (
      `ErrorContextID`, `ErrorCode`, `ErrorMessage`, `TechnicalMessage`,
      `TableName`, `ColumnName`, `ProblematicValue`,
      `AllowedRange`, `SuggestedFix`, `Severity`
    ) VALUES (
      error_context_id, 'MEM_INVALID_STATUS',
      CONCAT('Invalid member status: ', NEW.`Status`),
      'Status enum constraint violated on members table',
      'members', 'Status', NEW.`Status`,
      'active | expired | inactive | pending',
      'Status must be one of: active (paying), expired (may renew), inactive (left), pending (awaiting payment)',
      'ERROR'
    );
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
  END IF;
END;

CREATE TRIGGER `members_before_update` BEFORE UPDATE ON `members` FOR EACH ROW BEGIN
    IF NEW.Expiration <> OLD.Expiration THEN
        IF @internal_proc IS NULL OR @internal_proc <> 1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Direct update to Expiration column is not allowed. Use the approved Procedure.';
        END IF;
    END IF;
END;

CREATE TRIGGER `trg_members_after_insert` AFTER INSERT ON `members` FOR EACH ROW BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
    MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, Notes,
    NYRRRunnerName, YearBorn
  )
  VALUES (
    UUID(), NOW(), NEW.MemberID, 'INSERT', NEW.Status, NEW.Created, NEW.Expiration,
    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District,
    NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.Notes,
    NEW.NYRRRunnerName, NEW.YearBorn
  );
END;

CREATE TRIGGER `trg_members_family_inheritance` AFTER INSERT ON `members` FOR EACH ROW BEGIN
  IF NEW.FamilyID IS NOT NULL THEN
    UPDATE members
    SET 
      Expiration = (
        SELECT Expiration FROM members 
        WHERE FamilyID = NEW.FamilyID AND Status IN ('active','lifetime') 
        LIMIT 1
      ),
      MembershipFeePaid = (
        SELECT MembershipFeePaid FROM members 
        WHERE FamilyID = NEW.FamilyID AND Status IN ('active','lifetime')
        LIMIT 1
      ),
      PaymentDate = (
        SELECT PaymentDate FROM members 
        WHERE FamilyID = NEW.FamilyID AND Status IN ('active','lifetime')
        LIMIT 1
      ),
      PaymentTransaction = (
        SELECT PaymentTransaction FROM members 
        WHERE FamilyID = NEW.FamilyID AND Status IN ('active','lifetime')
        LIMIT 1
      )
    WHERE MemberID = NEW.MemberID 
      AND FamilyID = NEW.FamilyID
      AND Status IN ('pending', 'pending_ungrade', 'expired', 'inactive');
  END IF;
END;

CREATE TRIGGER `trg_members_after_update` AFTER UPDATE ON `members` FOR EACH ROW BEGIN
  INSERT INTO member_log (
    LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
    Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
    MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, Notes,
    NYRRRunnerName, YearBorn
  )
  VALUES (
    UUID(), NOW(), NEW.MemberID, 'UPDATE', NEW.Status, NEW.Created, NEW.Expiration,
    NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District,
    NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.Notes,
    NEW.NYRRRunnerName, NEW.YearBorn
  );
END;

-- EVENTS
CREATE EVENT `e_daily_member_expiration_check` ON SCHEDULE EVERY 1 DAY STARTS '2026-04-05 01:00:00' ON COMPLETION NOT PRESERVE ENABLE DO BEGIN
    SET @internal_proc = 1;
    UPDATE members
SET 
    Status = 'expired',
    Notes = CONCAT(IFNULL(Notes, ''), '\n[System Auto-Expire ', NOW(), ']: Membership reached expiration date.')
WHERE Status = 'active' 
  AND Expiration < CURRENT_DATE;
    SET @internal_proc = NULL;
END;

