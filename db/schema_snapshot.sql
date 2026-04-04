-- Schema export for mmrdb
-- Timestamp: 2026-04-04T02:22:53.083381 UTC

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
  PRIMARY KEY (`LogID`),
  KEY `idx_actlog_memberid` (`MemberID`),
  KEY `idx_actlog_timestamp` (`Timestamp`),
  KEY `idx_actlog_action` (`Action`),
  KEY `idx_actlog_sessionid` (`SessionID`)
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

CREATE TABLE `admins` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `added_by` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'system',
  `added_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=8 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `config` (
  `ConfigKey` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `ConfigValue` varchar(500) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Description` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`ConfigKey`)
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
  PRIMARY KEY (`TransactionNumber`)
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
  `Info` text COLLATE utf8mb4_unicode_ci,
  `LastUpdated` datetime DEFAULT NULL,
  `MembershipFeePaid` decimal(10,2) DEFAULT NULL,
  `PaymentDate` date DEFAULT NULL,
  `PaymentTransaction` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `JoinYear` smallint DEFAULT NULL,
  `PhoneNumber` varchar(30) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `LastLogin` datetime DEFAULT NULL,
  `Notes` text COLLATE utf8mb4_unicode_ci,
  `NYRRRunnerName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `YearBorn` smallint DEFAULT NULL,
  PRIMARY KEY (`LogID`),
  KEY `idx_memberid` (`MemberID`),
  KEY `idx_loggingtime` (`LoggingTime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `members` (
  `MemberID` varchar(10) COLLATE utf8mb4_unicode_ci NOT NULL,
  `Status` enum('active','expired','inactive','pending') CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending' COMMENT 'active=paying; expired=may renew; inactive=left; pending=awaiting payment',
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
  KEY `idx_joinyear` (`JoinYear`)
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
  CONSTRAINT `fk_payments_member` FOREIGN KEY (`MemberID`) REFERENCES `members` (`MemberID`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `schema_migrations` (
  `version` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `description` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `executed_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`version`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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
  CONSTRAINT `fk_submission_member` FOREIGN KEY (`MemberID`) REFERENCES `members` (`MemberID`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sync_changes` (
  `change_id` int NOT NULL AUTO_INCREMENT,
  `sheet_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `snapshot_id` int DEFAULT NULL,
  `change_type` varchar(20) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `row_key` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `old_values` json DEFAULT NULL,
  `new_values` json DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`change_id`),
  KEY `idx_snapshot` (`snapshot_id`),
  KEY `idx_sheet` (`sheet_name`)
) ENGINE=InnoDB AUTO_INCREMENT=26714 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE `sync_metadata` (
  `sheet_name` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `spreadsheet_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `sync_status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `last_synced_at` datetime DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  `updated_at` datetime DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`sheet_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `sync_snapshots` (
  `snapshot_id` int NOT NULL AUTO_INCREMENT,
  `sheet_name` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `snapshot_hash` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `row_count` int DEFAULT NULL,
  `snapshot_timestamp` datetime DEFAULT NULL,
  `google_modified_at` datetime DEFAULT NULL,
  `snapshot_data_url` longtext COLLATE utf8mb4_unicode_ci,
  `status` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'pending',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`snapshot_id`),
  KEY `idx_sheet` (`sheet_name`),
  KEY `idx_timestamp` (`snapshot_timestamp`)
) ENGINE=InnoDB AUTO_INCREMENT=108 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE `viewer_admins` (
  `id` int NOT NULL AUTO_INCREMENT,
  `email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `role` enum('admin','super_admin') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'admin',
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB AUTO_INCREMENT=9 DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

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

CREATE TABLE `webapp_events` (
  `EventID` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `EventType` varchar(50) COLLATE utf8mb4_unicode_ci NOT NULL,
  `EventCategory` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT 'payment',
  `Timestamp` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `ExpiresAt` datetime DEFAULT NULL,
  `MemberID` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Email` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `PaymentIntent` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `Amount` decimal(10,2) DEFAULT NULL,
  `PaymentMethod` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `PayerName` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `MemoField` text COLLATE utf8mb4_unicode_ci,
  `Last4Digits` varchar(10) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `FamilyMemberEmails` text COLLATE utf8mb4_unicode_ci,
  `Status` enum('pending','matched','approved','rejected','expired','error') COLLATE utf8mb4_unicode_ci NOT NULL DEFAULT 'pending',
  `MatchedMessageId` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `MatchedTransactionNumber` varchar(100) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `AdminApprover` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `ApprovalDate` datetime DEFAULT NULL,
  `Notes` text COLLATE utf8mb4_unicode_ci,
  `PaymentDate` date DEFAULT NULL,
  `ScreenshotFileId` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `GDriveFilePath` varchar(500) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `OCRText` text COLLATE utf8mb4_unicode_ci,
  `OCRTimestamp` datetime DEFAULT NULL,
  `CreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `UpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `timestamp_unix` bigint DEFAULT '0' COMMENT 'Unix timestamp (seconds since epoch) for timezone-invariant sync',
  `expires_at_unix` bigint DEFAULT '0' COMMENT 'Unix timestamp for expiration',
  `approval_date_unix` bigint DEFAULT '0' COMMENT 'Unix timestamp for approval',
  PRIMARY KEY (`EventID`),
  KEY `idx_pe_memberid` (`MemberID`),
  KEY `idx_pe_email` (`Email`),
  KEY `idx_pe_status` (`Status`),
  KEY `idx_pe_timestamp` (`Timestamp`),
  KEY `idx_pe_matchedmessageid` (`MatchedMessageId`),
  KEY `idx_webapp_events_timestamp_unix` (`timestamp_unix`),
  KEY `idx_webapp_events_expires_at_unix` (`expires_at_unix`),
  KEY `idx_webapp_events_approval_date_unix` (`approval_date_unix`),
  CONSTRAINT `fk_pe_member` FOREIGN KEY (`MemberID`) REFERENCES `members` (`MemberID`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ==========================================
-- VIEWS
-- ==========================================
DROP VIEW IF EXISTS `v_family_members`;
CREATE ALGORITHM=UNDEFINED DEFINER=`mmradmin`@`%` SQL SECURITY DEFINER VIEW `v_family_members` AS select `m`.`FamilyID` AS `FamilyID`,min(`m`.`MemberID`) OVER (PARTITION BY `m`.`FamilyID` )  AS `primary_member_id`,`m`.`MemberID` AS `member_id`,`m`.`FirstName` AS `FirstName`,`m`.`LastName` AS `LastName`,`m`.`Email` AS `Email`,`m`.`Status` AS `Status`,`m`.`Expiration` AS `Expiration`,`m`.`Type` AS `Type` from `members` `m` where (`m`.`FamilyID` is not null);

DROP VIEW IF EXISTS `v_gmail_split_audit`;
CREATE ALGORITHM=UNDEFINED DEFINER=`mmradmin`@`%` SQL SECURITY DEFINER VIEW `v_gmail_split_audit` AS select `gt`.`TransactionNumber` AS `TransactionNumber`,`gt`.`Amount` AS `Total`,ifnull(sum(`p`.`Amount`),0) AS `Allocated`,(`gt`.`Amount` - ifnull(sum(`p`.`Amount`),0)) AS `Balance`,`gt`.`Notes` AS `SplitHistory` from (`gmail_transactions` `gt` left join `payments` `p` on((`gt`.`TransactionNumber` = `p`.`TransactionNumber`))) group by `gt`.`TransactionNumber`;

DROP VIEW IF EXISTS `v_payment_details`;
CREATE ALGORITHM=UNDEFINED DEFINER=`mmradmin`@`%` SQL SECURITY DEFINER VIEW `v_payment_details` AS select `p`.`PaymentID` AS `PaymentID`,`p`.`CreatedAt` AS `CreatedAt`,`m`.`MemberID` AS `MemberID`,concat(`m`.`FirstName`,' ',`m`.`LastName`) AS `MemberFullName`,`m`.`FamilyID` AS `FamilyID`,`p`.`PaymentType` AS `PaymentType`,`p`.`Amount` AS `Amount`,`p`.`PaymentDate` AS `PaymentDate`,`p`.`TransactionNumber` AS `TransactionNumber`,`s`.`SubmissionType` AS `SubmissionType`,`p`.`ProcessedBy` AS `ProcessedBy`,`p`.`Source` AS `Source` from ((`payments` `p` join `members` `m` on((`p`.`MemberID` = `m`.`MemberID`))) left join `submissions` `s` on((`p`.`SubmissionID` = `s`.`SubmissionID`)));

DROP VIEW IF EXISTS `v_payment_splits`;
CREATE ALGORITHM=UNDEFINED DEFINER=`mmradmin`@`%` SQL SECURITY DEFINER VIEW `v_payment_splits` AS select `gt`.`TransactionNumber` AS `TransactionNumber`,`gt`.`Amount` AS `OriginalTotal`,(select sum(`p`.`Amount`) from `payments` `p` where (`p`.`TransactionNumber` = `gt`.`TransactionNumber`)) AS `TotalAllocated`,(`gt`.`Amount` - (select ifnull(sum(`p`.`Amount`),0) from `payments` `p` where (`p`.`TransactionNumber` = `gt`.`TransactionNumber`))) AS `RemainingBalance` from `gmail_transactions` `gt`;

-- PROCEDURES
CREATE DEFINER=`mmradmin`@`%` PROCEDURE `generate_member_id`(OUT new_id VARCHAR(10))
BEGIN
    DECLARE max_num INT DEFAULT 0;
    START TRANSACTION;
        SELECT COALESCE(MAX(CAST(SUBSTRING(MemberID, 2) AS UNSIGNED)), 0) INTO max_num FROM members FOR UPDATE;
        SET new_id = CONCAT('A', LPAD(max_num + 1, 4, '0'));
    COMMIT;
END;

CREATE DEFINER=`mmradmin`@`%` PROCEDURE `sp_admin_update_member_status`(
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

CREATE DEFINER=`mmradmin`@`%` PROCEDURE `sp_link_transaction`(
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
CREATE DEFINER=`mmradmin`@`%` TRIGGER `members_insert_lastlogin_unix` BEFORE INSERT ON `members` FOR EACH ROW BEGIN
  IF NEW.LastLogin IS NOT NULL THEN
    SET NEW.last_login_unix = UNIX_TIMESTAMP(NEW.LastLogin);
  ELSE
    SET NEW.last_login_unix = 0;
  END IF;
END;

CREATE DEFINER=`mmradmin`@`%` TRIGGER `members_insert_created_unix` BEFORE INSERT ON `members` FOR EACH ROW BEGIN
  IF NEW.Created IS NOT NULL THEN
    SET NEW.created_at_unix = UNIX_TIMESTAMP(NEW.Created);
  ELSE
    SET NEW.created_at_unix = 0;
  END IF;
END;

CREATE DEFINER=`mmradmin`@`%` TRIGGER `members_update_lastlogin_unix` BEFORE UPDATE ON `members` FOR EACH ROW BEGIN
  IF NEW.LastLogin <> OLD.LastLogin OR
     (NEW.LastLogin IS NULL AND OLD.LastLogin IS NOT NULL) OR
     (NEW.LastLogin IS NOT NULL AND OLD.LastLogin IS NULL)
  THEN
    SET NEW.last_login_unix = IF(NEW.LastLogin IS NULL, 0, UNIX_TIMESTAMP(NEW.LastLogin));
  END IF;
END;

CREATE DEFINER=`mmradmin`@`%` TRIGGER `members_update_created_unix` BEFORE UPDATE ON `members` FOR EACH ROW BEGIN
  IF NEW.Created <> OLD.Created OR
     (NEW.Created IS NULL AND OLD.Created IS NOT NULL) OR
     (NEW.Created IS NOT NULL AND OLD.Created IS NULL)
  THEN
    SET NEW.created_at_unix = IF(NEW.Created IS NULL, 0, UNIX_TIMESTAMP(NEW.Created));
  END IF;
END;

CREATE DEFINER=`mmradmin`@`%` TRIGGER `members_before_update` BEFORE UPDATE ON `members` FOR EACH ROW BEGIN
    IF NEW.Expiration <> OLD.Expiration THEN
        IF @internal_proc IS NULL OR @internal_proc <> 1 THEN
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Direct update to Expiration column is not allowed. Use the approved Procedure.';
        END IF;
    END IF;
END;

CREATE DEFINER=`mmradmin`@`%` TRIGGER `trg_members_after_insert` AFTER INSERT ON `members` FOR EACH ROW BEGIN
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

CREATE DEFINER=`mmradmin`@`%` TRIGGER `trg_members_after_update` AFTER UPDATE ON `members` FOR EACH ROW BEGIN
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

CREATE DEFINER=`mmradmin`@`%` TRIGGER `trg_payments_auto_fill` BEFORE INSERT ON `payments` FOR EACH ROW BEGIN
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

CREATE DEFINER=`mmradmin`@`%` TRIGGER `trg_payments_limit_check_insert` BEFORE INSERT ON `payments` FOR EACH ROW BEGIN
    DECLARE v_max DECIMAL(10,2);
    DECLARE v_used DECIMAL(10,2);
    SELECT Amount INTO v_max FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;
    SELECT IFNULL(SUM(Amount), 0) INTO v_used FROM payments WHERE TransactionNumber = NEW.TransactionNumber;
    IF (v_used + NEW.Amount) > v_max THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Split Error: Total payments exceed Gmail Transaction amount.';
    END IF;
END;

CREATE DEFINER=`mmradmin`@`%` TRIGGER `trg_payments_limit_check_update` BEFORE UPDATE ON `payments` FOR EACH ROW BEGIN
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

CREATE DEFINER=`mmradmin`@`%` TRIGGER `trg_payments_sync_membership_only` AFTER INSERT ON `payments` FOR EACH ROW BEGIN
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

CREATE DEFINER=`mmradmin`@`%` TRIGGER `trg_payments_approve_submission` AFTER INSERT ON `payments` FOR EACH ROW BEGIN
    IF NEW.SubmissionID IS NOT NULL THEN
        UPDATE submissions
        SET
            Status = 'approved',
            PaymentID = NEW.PaymentID,
            UpdatedByID = NEW.ProcessedBy
        WHERE SubmissionID = NEW.SubmissionID;
    END IF;
END;

-- EVENTS
CREATE DEFINER=`mmradmin`@`%` EVENT `e_daily_member_expiration_check` ON SCHEDULE EVERY 1 DAY STARTS '2026-04-05 01:00:00' ON COMPLETION NOT PRESERVE ENABLE DO BEGIN
    SET @internal_proc = 1;
    UPDATE members
SET 
    Status = 'expired',
    Notes = CONCAT(IFNULL(Notes, ''), '\n[System Auto-Expire ', NOW(), ']: Membership reached expiration date.')
WHERE Status = 'active' 
  AND Expiration < CURRENT_DATE;
    SET @internal_proc = NULL;
END;

