-- =============================================================================
-- MMR Integration Test Schema
-- MySQL 5.7+ compatible DDL — used by testcontainers for local integration tests
-- Derived from schema_snapshot.sql (source of truth: /api/export-schema)
--
-- Creation order respects FK dependencies.
-- MySQL 5.7+ constraints: no IF NOT EXISTS in ALTER/INDEX, no multi-clause ALTER.
-- =============================================================================

CREATE DATABASE IF NOT EXISTS mmrdb CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE mmrdb;

-- ---------------------------------------------------------------------------
-- 1. TABLES (dependency order: no-FK tables first)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS config (
    ConfigKey    VARCHAR(100) NOT NULL,
    ConfigValue  VARCHAR(500) NOT NULL,
    Description  VARCHAR(500) DEFAULT NULL,
    UpdatedAt    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (ConfigKey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS error_context (
    ErrorContextID    VARCHAR(50)  NOT NULL COMMENT 'UUID for error tracking',
    ErrorCode         VARCHAR(50)  NOT NULL COMMENT 'Matches activity_log.ErrorCode',
    ErrorMessage      TEXT         NOT NULL COMMENT 'User-friendly error message',
    TechnicalMessage  TEXT         DEFAULT NULL COMMENT 'Technical details for debugging',
    SuggestedFix      TEXT         DEFAULT NULL COMMENT 'Recommended resolution action',
    TableName         VARCHAR(100) NOT NULL COMMENT 'Which table had the issue',
    ColumnName        VARCHAR(100) DEFAULT NULL COMMENT 'Which column (if applicable)',
    ConstraintName    VARCHAR(100) DEFAULT NULL COMMENT 'Which constraint was violated',
    ProblematicValue  TEXT         DEFAULT NULL COMMENT 'The actual value that caused error',
    ValidValueExamples TEXT        DEFAULT NULL COMMENT 'JSON array of valid example values',
    AllowedRange      VARCHAR(200) DEFAULT NULL COMMENT 'If numeric: min-max; if enum: allowed values',
    OffendingRowID    VARCHAR(255) DEFAULT NULL COMMENT 'Row identifier (JSON for compound keys)',
    OffendingRowContext JSON        DEFAULT NULL COMMENT 'Full row data (sensitive fields masked)',
    DetectedAt        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When error was first logged',
    FirstOccurrence   DATETIME     DEFAULT CURRENT_TIMESTAMP COMMENT 'When this error first happened',
    LastOccurrence    DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Most recent occurrence',
    OccurrenceCount   INT          DEFAULT 1 COMMENT 'How many times this error occurred',
    Severity          ENUM('INFO','WARNING','ERROR','CRITICAL') DEFAULT 'ERROR',
    Status            ENUM('NEW','ACKNOWLEDGED','IN_PROGRESS','RESOLVED','DUPLICATE','WONTFIX') DEFAULT 'NEW',
    AssignedTo        VARCHAR(255) DEFAULT NULL COMMENT 'Admin email responsible for fix',
    ResolutionNotes   TEXT         DEFAULT NULL COMMENT 'How it was fixed',
    ResolvedAt        DATETIME     DEFAULT NULL,
    PRIMARY KEY (ErrorContextID),
    KEY idx_error_code    (ErrorCode),
    KEY idx_error_table   (TableName),
    KEY idx_error_constraint (ConstraintName),
    KEY idx_error_detected (DetectedAt),
    KEY idx_error_severity (Severity),
    KEY idx_error_status   (Status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     VARCHAR(50)  NOT NULL,
    description VARCHAR(255) DEFAULT NULL,
    executed_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS admin_users (
    id         INT          NOT NULL AUTO_INCREMENT,
    email      VARCHAR(255) NOT NULL,
    role       ENUM('admin','super_admin') NOT NULL DEFAULT 'admin',
    added_by   VARCHAR(255) NOT NULL DEFAULT 'system',
    added_at   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_admin_email (email),
    KEY idx_admin_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS members (
    MemberID         VARCHAR(10)  NOT NULL,
    Status           ENUM('active','expired','inactive','pending','pending_upgrade','lifetime') NOT NULL DEFAULT 'pending'
                     COMMENT 'active=paying; expired=may renew; inactive=left; pending=awaiting payment; pending_upgrade=upgrading to family; lifetime=lifetime member',
    Created          DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Expiration       DATE         DEFAULT NULL,
    Email            VARCHAR(255) NOT NULL,
    FirstName        VARCHAR(100) NOT NULL,
    LastName         VARCHAR(100) NOT NULL,
    Type             ENUM('Individual','Family') NOT NULL DEFAULT 'Individual',
    FamilyID         VARCHAR(10)  DEFAULT NULL,
    Gender           VARCHAR(20)  DEFAULT NULL,
    WeChatID         VARCHAR(100) DEFAULT NULL,
    District         VARCHAR(100) DEFAULT NULL,
    MembershipFeePaid DECIMAL(10,2) DEFAULT NULL,
    PaymentDate      DATE         DEFAULT NULL,
    PaymentTransaction VARCHAR(100) DEFAULT NULL,
    JoinYear         SMALLINT     DEFAULT NULL,
    PhoneNumber      VARCHAR(30)  DEFAULT NULL,
    Notes            TEXT         DEFAULT NULL,
    NYRRRunnerName   VARCHAR(100) DEFAULT NULL,
    YearBorn         SMALLINT     DEFAULT NULL,
    YearBornGuess    SMALLINT     DEFAULT NULL COMMENT 'System-inferred birth year from NYRR age data',
    password_hash    VARCHAR(255) DEFAULT NULL,
    google_sub       VARCHAR(255) DEFAULT NULL,
    microsoft_sub    VARCHAR(255) DEFAULT NULL,
    UpdatedAt        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (MemberID),
    UNIQUE KEY uq_member_email   (Email),
    UNIQUE KEY uq_member_google  (google_sub),
    UNIQUE KEY uq_member_ms      (microsoft_sub),
    KEY idx_member_status     (Status),
    KEY idx_member_expiration (Expiration),
    KEY idx_member_family     (FamilyID),
    KEY idx_member_join_year  (JoinYear),
    KEY idx_member_updated    (UpdatedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS member_log (
    LogID              VARCHAR(50)  NOT NULL,
    LoggingTime        DATETIME     NOT NULL,
    MemberID           VARCHAR(10)  NOT NULL,
    ChangeType         VARCHAR(20)  DEFAULT NULL,
    Status             VARCHAR(50)  DEFAULT NULL,
    Created            DATETIME     DEFAULT NULL,
    Expiration         DATE         DEFAULT NULL,
    Email              VARCHAR(255) DEFAULT NULL,
    FirstName          VARCHAR(100) DEFAULT NULL,
    LastName           VARCHAR(100) DEFAULT NULL,
    Type               VARCHAR(50)  DEFAULT NULL,
    FamilyID           VARCHAR(10)  DEFAULT NULL,
    Gender             VARCHAR(20)  DEFAULT NULL,
    WeChatID           VARCHAR(100) DEFAULT NULL,
    District           VARCHAR(100) DEFAULT NULL,
    MembershipFeePaid  DECIMAL(10,2) DEFAULT NULL,
    PaymentDate        DATE         DEFAULT NULL,
    PaymentTransaction VARCHAR(100) DEFAULT NULL,
    JoinYear           SMALLINT     DEFAULT NULL,
    PhoneNumber        VARCHAR(30)  DEFAULT NULL,
    Notes              TEXT         DEFAULT NULL,
    NYRRRunnerName     VARCHAR(100) DEFAULT NULL,
    YearBorn           SMALLINT     DEFAULT NULL,
    PRIMARY KEY (LogID),
    KEY idx_mlog_time     (LoggingTime),
    KEY idx_mlog_memberid (MemberID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS activity_log (
    LogID         VARCHAR(50)  NOT NULL,
    Timestamp     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    SessionID     VARCHAR(50)  DEFAULT NULL,
    MemberID      VARCHAR(10)  DEFAULT NULL,
    Email         VARCHAR(255) DEFAULT NULL,
    EventID       VARCHAR(50)  DEFAULT NULL,
    Action        VARCHAR(100) NOT NULL,
    State         VARCHAR(50)  DEFAULT NULL,
    ErrorCode     VARCHAR(50)  DEFAULT NULL,
    ErrorMessage  TEXT         DEFAULT NULL,
    ErrorContext  JSON         DEFAULT NULL COMMENT 'Detailed error info: {field, value, constraint, suggestion}',
    ErrorSeverity ENUM('INFO','WARNING','ERROR','CRITICAL') DEFAULT 'ERROR' COMMENT 'Error classification level',
    StackTrace    TEXT         DEFAULT NULL COMMENT 'Python/Node stack trace if available',
    PRIMARY KEY (LogID),
    KEY idx_alog_timestamp (Timestamp),
    KEY idx_alog_session   (SessionID),
    KEY idx_alog_member    (MemberID),
    KEY idx_alog_action    (Action),
    KEY idx_alog_errorcode (ErrorCode),
    KEY idx_alog_severity  (ErrorSeverity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    TokenID   VARCHAR(50)  NOT NULL,
    Email     VARCHAR(255) NOT NULL,
    TokenHash VARCHAR(255) NOT NULL,
    ExpiresAt DATETIME     NOT NULL,
    Used      TINYINT(1)   NOT NULL DEFAULT 0,
    CreatedAt DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (TokenID),
    KEY idx_prt_email   (Email),
    KEY idx_prt_expires (ExpiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gmail_transactions (
    TransactionNumber VARCHAR(100) NOT NULL,
    Timestamp         DATETIME     DEFAULT NULL COMMENT 'From Sheets/GAS',
    Sender            VARCHAR(255) DEFAULT NULL,
    Amount            DECIMAL(10,2) DEFAULT NULL COMMENT 'Total original amount',
    Memo              TEXT         DEFAULT NULL,
    TransactionDate   DATE         DEFAULT NULL,
    PaymentMethod     VARCHAR(100) DEFAULT NULL COMMENT 'Zelle, Venmo, etc.',
    MessageId         VARCHAR(100) NOT NULL,
    Subject           TEXT         DEFAULT NULL,
    OriginalMemo      TEXT         DEFAULT NULL,
    Notes             TEXT         DEFAULT NULL COMMENT 'User friendly split summary',
    UpdatedAt         DATETIME     DEFAULT NULL COMMENT 'Last linked time',
    PRIMARY KEY (TransactionNumber)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nyrr_events (
    id               INT          NOT NULL AUTO_INCREMENT,
    event_code       VARCHAR(255) DEFAULT NULL,
    event_name       VARCHAR(255) NOT NULL,
    event_url        VARCHAR(500) DEFAULT NULL,
    location         VARCHAR(255) DEFAULT NULL,
    distance         VARCHAR(50)  DEFAULT NULL,
    event_date       DATE         DEFAULT NULL,
    event_year       SMALLINT     DEFAULT NULL,
    is_upcoming      TINYINT(1)   NOT NULL DEFAULT 0,
    is_virtual       TINYINT(1)   NOT NULL DEFAULT 0,
    processing_status ENUM('Pending','InProgress','Completed','Error') NOT NULL DEFAULT 'Pending',
    processed_at     DATETIME     DEFAULT NULL,
    processed_by     VARCHAR(100) DEFAULT NULL,
    result_count     INT          NOT NULL DEFAULT 0,
    nyrr_finisher_count INT       DEFAULT NULL,
    mmr_runner_count INT          NOT NULL DEFAULT 0,
    mmr_matched_count INT         NOT NULL DEFAULT 0,
    notes            TEXT         DEFAULT NULL,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_event_code (event_code),
    KEY idx_event_date   (event_date),
    KEY idx_event_year   (event_year),
    KEY idx_event_upcoming (is_upcoming),
    KEY idx_event_status  (processing_status),
    KEY idx_event_finisher_count (nyrr_finisher_count)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sync_jobs (
    JobID       VARCHAR(16)  NOT NULL,
    Operation   VARCHAR(100) NOT NULL,
    Status      ENUM('queued','running','done','error') NOT NULL DEFAULT 'queued',
    Message     TEXT         DEFAULT NULL,
    Progress    INT          DEFAULT 0,
    Result      LONGTEXT     DEFAULT NULL,
    StartedAt   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt   TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CompletedAt TIMESTAMP    DEFAULT NULL,
    PRIMARY KEY (JobID),
    KEY idx_syncjob_status    (Status),
    KEY idx_syncjob_started   (StartedAt),
    KEY idx_syncjob_updated   (UpdatedAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS viewer_user_settings (
    id             INT          NOT NULL AUTO_INCREMENT,
    email          VARCHAR(255) NOT NULL,
    table_name     VARCHAR(255) NOT NULL,
    visible_columns JSON        DEFAULT NULL,
    created_at     DATETIME     DEFAULT CURRENT_TIMESTAMP,
    updated_at     DATETIME     DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_user_table (email, table_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tables with FK dependencies (created after their referenced tables)

CREATE TABLE IF NOT EXISTS admin_member_overrides (
    OverrideID       INT          NOT NULL AUTO_INCREMENT,
    AdminEmail       VARCHAR(255) NOT NULL COMMENT 'Admin who performed the manual change',
    TargetMemberID   VARCHAR(10)  NOT NULL,
    ImpactedMemberIDs TEXT        DEFAULT NULL COMMENT 'Family members affected',
    ActionType       ENUM('STATUS_CHANGE','EXPIRATION_OVERRIDE','LIFETIME_SET','INACTIVE_SET') NOT NULL,
    OldValue         VARCHAR(255) DEFAULT NULL,
    NewValue         VARCHAR(255) DEFAULT NULL,
    AdminNotes       TEXT         NOT NULL,
    Timestamp        DATETIME     DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (OverrideID),
    KEY idx_amo_target (TargetMemberID),
    CONSTRAINT fk_override_member FOREIGN KEY (TargetMemberID) REFERENCES members (MemberID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nyrr_event_runners (
    id               INT          NOT NULL AUTO_INCREMENT,
    nyrr_event_id    INT          NOT NULL,
    nyrr_runner_id   VARCHAR(20)  DEFAULT NULL,
    runner_name      VARCHAR(200) NOT NULL,
    first_name       VARCHAR(100) DEFAULT NULL,
    last_name        VARCHAR(100) DEFAULT NULL,
    age              SMALLINT     DEFAULT NULL,
    gender           VARCHAR(10)  DEFAULT NULL,
    state_province   VARCHAR(50)  DEFAULT NULL,
    city             VARCHAR(100) DEFAULT NULL,
    bib_number       VARCHAR(20)  NOT NULL,
    finish_time      VARCHAR(20)  DEFAULT NULL,
    pace             VARCHAR(20)  DEFAULT NULL,
    overall_place    INT          DEFAULT NULL,
    gender_place     INT          DEFAULT NULL,
    age_grade_time   VARCHAR(20)  DEFAULT NULL,
    age_grade_place  INT          DEFAULT NULL,
    age_grade_percent DECIMAL(5,2) DEFAULT NULL,
    team_code        VARCHAR(20)  DEFAULT NULL,
    sync_source      ENUM('finishers','mmr_team','both') DEFAULT NULL,
    is_registered_only TINYINT(1) NOT NULL DEFAULT 0,
    mmr_member_id    VARCHAR(10)  DEFAULT NULL,
    match_method     ENUM('auto_name','auto_lastname','auto_firstlast','auto_partial_name','manual','not_member','unmatched') DEFAULT NULL,
    matched_by       VARCHAR(100) DEFAULT NULL,
    matched_at       DATETIME     DEFAULT NULL,
    scan_timestamp   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_ner_event      (nyrr_event_id),
    KEY idx_ner_runner_id  (nyrr_runner_id),
    KEY idx_ner_name       (runner_name),
    KEY idx_ner_last_name  (last_name),
    KEY idx_ner_team       (team_code),
    KEY idx_ner_member     (mmr_member_id),
    KEY idx_ner_method     (match_method),
    CONSTRAINT fk_event_runners_event FOREIGN KEY (nyrr_event_id) REFERENCES nyrr_events (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nyrr_processing_log (
    id            INT          NOT NULL AUTO_INCREMENT,
    run_timestamp DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    triggered_by  VARCHAR(100) DEFAULT NULL,
    nyrr_event_id INT          DEFAULT NULL,
    run_status    ENUM('Success','PartialSuccess','Failed') NOT NULL,
    rows_written  INT          NOT NULL DEFAULT 0,
    error_details TEXT         DEFAULT NULL,
    created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_npl_timestamp (run_timestamp),
    KEY idx_npl_event     (nyrr_event_id),
    KEY idx_npl_status    (run_status),
    CONSTRAINT fk_processing_log_event FOREIGN KEY (nyrr_event_id) REFERENCES nyrr_events (id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS submissions (
    CreatedAt      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'Timestamp when the user hits submit button',
    SubmissionID   VARCHAR(50)  NOT NULL COMMENT 'auto gen unique identifier (migrated from EventID)',
    Status         ENUM('pending','approved','cancelled','expired') NOT NULL DEFAULT 'pending'
                   COMMENT 'Logic: once submitted=pending; matched payment=approved; past ExpiresAt=expired; user action=cancelled',
    MemberID       VARCHAR(10)  NOT NULL COMMENT 'submitter MemberID from members table',
    SubmissionType VARCHAR(100) NOT NULL COMMENT 'set at creation time (migrated from EventType)',
    ExpiresAt      DATETIME     DEFAULT NULL COMMENT 'set at creation time',
    PaymentIntent  VARCHAR(100) DEFAULT NULL COMMENT 'set at creation time',
    Amount         DECIMAL(10,2) DEFAULT NULL COMMENT 'set at creation time',
    PaymentMethod  VARCHAR(50)  DEFAULT NULL COMMENT 'user input',
    PayerName      VARCHAR(100) DEFAULT NULL COMMENT 'user input',
    PaymentDate    DATE         DEFAULT NULL COMMENT 'user input',
    MemoField      TEXT         DEFAULT NULL COMMENT 'user input',
    Last4Digits    VARCHAR(10)  DEFAULT NULL COMMENT 'user input',
    PaymentID      VARCHAR(50)  DEFAULT NULL COMMENT 'added when approved; links to payments table',
    UpdatedByID    VARCHAR(255) DEFAULT NULL COMMENT 'ID who updated this record the last time',
    UpdatedAt      DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'trigger at update',
    PRIMARY KEY (SubmissionID),
    KEY idx_submissions_member         (MemberID),
    KEY idx_submissions_status         (Status),
    KEY idx_submissions_expires        (ExpiresAt),
    KEY idx_submissions_status_expires (Status, ExpiresAt),
    CONSTRAINT fk_submission_member FOREIGN KEY (MemberID) REFERENCES members (MemberID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
    PaymentID         VARCHAR(50)   NOT NULL,
    MemberID          VARCHAR(10)   DEFAULT NULL,
    PaymentDate       DATE          DEFAULT NULL,
    Amount            DECIMAL(10,2) NOT NULL,
    PaymentMethod     VARCHAR(50)   DEFAULT NULL,
    PayerName         VARCHAR(100)  DEFAULT NULL,
    MemoField         TEXT          DEFAULT NULL,
    Last4Digits       VARCHAR(10)   DEFAULT NULL,
    ProcessedBy       VARCHAR(255)  DEFAULT NULL,
    Source            VARCHAR(50)   DEFAULT NULL,
    Notes             TEXT          DEFAULT NULL,
    CreatedAt         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    TransactionNumber VARCHAR(100)  DEFAULT NULL COMMENT 'Linked to gmail_transactions.TransactionNumber',
    SubmissionID      VARCHAR(50)   DEFAULT NULL COMMENT 'Optional: Link to the user submission that started this',
    PaymentType       VARCHAR(50)   DEFAULT NULL COMMENT 'Set at creation (e.g., Membership, Donation)',
    UpdatedAt         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP COMMENT 'Last modified timestamp for incremental sync',
    PRIMARY KEY (PaymentID),
    KEY idx_payments_member      (MemberID),
    KEY idx_payments_date        (PaymentDate),
    KEY idx_payments_txnum       (TransactionNumber),
    KEY idx_payments_updated     (UpdatedAt),
    CONSTRAINT fk_payments_member FOREIGN KEY (MemberID) REFERENCES members (MemberID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sheets_sync_log (
    SyncLogID    INT          NOT NULL AUTO_INCREMENT COMMENT 'Tracks sheets sync batches for resume capability and monitoring',
    JobID        VARCHAR(36)  NOT NULL COMMENT 'Foreign key to sync_jobs.JobID',
    ConfigKey    VARCHAR(50)  NOT NULL COMMENT 'Sync config key (e.g., export_members, import_transactions)',
    Direction    VARCHAR(20)  NOT NULL COMMENT 'sheet_to_mysql or mysql_to_sheet',
    BatchNumber  INT          NOT NULL COMMENT 'Batch sequence (0, 1, 2, ...)',
    BatchSize    INT          NOT NULL COMMENT 'Number of rows in this batch',
    TotalRows    INT          NOT NULL COMMENT 'Total rows in entire sync operation',
    StartedAt    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT 'When batch processing started',
    CompletedAt  DATETIME     DEFAULT NULL COMMENT 'When batch processing completed',
    Status       ENUM('pending','processing','success','error') NOT NULL DEFAULT 'pending',
    ErrorMessage TEXT         DEFAULT NULL COMMENT 'Error details if Status=error',
    RowsProcessed INT         NOT NULL DEFAULT 0 COMMENT 'Rows attempted in this batch',
    RowsInserted INT          NOT NULL DEFAULT 0 COMMENT 'Rows successfully inserted',
    RowsUpdated  INT          NOT NULL DEFAULT 0 COMMENT 'Rows successfully updated',
    RowsSkipped  INT          NOT NULL DEFAULT 0 COMMENT 'Rows skipped (duplicates, validation failures)',
    PRIMARY KEY (SyncLogID),
    UNIQUE KEY uk_job_batch  (JobID, BatchNumber),
    KEY idx_ssl_config   (ConfigKey),
    KEY idx_ssl_started  (StartedAt),
    KEY idx_ssl_status   (Status),
    CONSTRAINT fk_sheets_sync_log_jobid FOREIGN KEY (JobID) REFERENCES sync_jobs (JobID) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------------------------------------------------------------------------
-- 2. VIEWS
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_family_members AS
SELECT
    m.FamilyID,
    MIN(m.MemberID) OVER (PARTITION BY m.FamilyID) AS primary_member_id,
    m.MemberID    AS member_id,
    m.FirstName,
    m.LastName,
    m.Email,
    m.Status,
    m.Expiration,
    m.Type
FROM members m
WHERE m.FamilyID IS NOT NULL;

CREATE OR REPLACE VIEW v_gmail_split_audit AS
SELECT
    gt.TransactionNumber,
    gt.Amount                              AS Total,
    IFNULL(SUM(p.Amount), 0)              AS Allocated,
    (gt.Amount - IFNULL(SUM(p.Amount), 0)) AS Balance,
    gt.Notes                               AS SplitHistory
FROM gmail_transactions gt
LEFT JOIN payments p ON gt.TransactionNumber = p.TransactionNumber
GROUP BY gt.TransactionNumber;

CREATE OR REPLACE VIEW v_inconsistent_family_data AS
SELECT
    m.FamilyID,
    COUNT(m.MemberID)                                                     AS TotalMembers,
    COUNT(DISTINCT m.Status)                                              AS DistinctStatuses,
    COUNT(DISTINCT m.Expiration)                                          AS DistinctExpirations,
    GROUP_CONCAT(DISTINCT m.Status ORDER BY m.Status SEPARATOR ', ')     AS StatusesFound,
    GROUP_CONCAT(DISTINCT IFNULL(m.Expiration,'NULL') ORDER BY m.Expiration SEPARATOR ', ') AS ExpirationsFound
FROM members m
WHERE m.FamilyID IS NOT NULL
GROUP BY m.FamilyID
HAVING (DistinctStatuses > 1) OR (DistinctExpirations > 1);

CREATE OR REPLACE VIEW v_last_successful_batch AS
SELECT
    sl.JobID,
    sl.ConfigKey,
    MAX(sl.BatchNumber) AS LastSuccessfulBatch,
    MAX(sl.StartedAt)   AS LastSyncTime
FROM sheets_sync_log sl
WHERE sl.Status = 'success'
GROUP BY sl.JobID, sl.ConfigKey;

CREATE OR REPLACE VIEW v_payment_details AS
SELECT
    p.PaymentID,
    p.CreatedAt,
    m.MemberID,
    CONCAT(m.FirstName, ' ', m.LastName) AS MemberFullName,
    m.FamilyID,
    p.PaymentType,
    p.Amount,
    p.PaymentDate,
    p.TransactionNumber,
    s.SubmissionType,
    p.ProcessedBy,
    p.Source
FROM payments p
JOIN members m ON p.MemberID = m.MemberID
LEFT JOIN submissions s ON p.SubmissionID = s.SubmissionID;

CREATE OR REPLACE VIEW v_payment_splits AS
SELECT
    gt.TransactionNumber,
    gt.Amount AS OriginalTotal,
    (SELECT SUM(p.Amount) FROM payments p WHERE p.TransactionNumber = gt.TransactionNumber)                   AS TotalAllocated,
    (gt.Amount - (SELECT IFNULL(SUM(p.Amount), 0) FROM payments p WHERE p.TransactionNumber = gt.TransactionNumber)) AS RemainingBalance
FROM gmail_transactions gt;

CREATE OR REPLACE VIEW v_sync_summary AS
SELECT
    sl.JobID,
    sl.ConfigKey,
    COUNT(*)                                                     AS TotalBatches,
    SUM(sl.RowsInserted)                                         AS TotalInserted,
    SUM(sl.RowsUpdated)                                          AS TotalUpdated,
    SUM(sl.RowsSkipped)                                          AS TotalSkipped,
    SUM(CASE WHEN sl.Status = 'success' THEN 1 ELSE 0 END)      AS SuccessfulBatches,
    SUM(CASE WHEN sl.Status = 'error'   THEN 1 ELSE 0 END)      AS FailedBatches,
    MAX(sl.CompletedAt)                                          AS LastCompletedAt
FROM sheets_sync_log sl
GROUP BY sl.JobID, sl.ConfigKey;

CREATE OR REPLACE VIEW v_unresolved_errors AS
SELECT
    ec.ErrorContextID,
    ec.ErrorCode,
    ec.ErrorMessage,
    ec.TableName,
    ec.ColumnName,
    ec.Severity,
    ec.OccurrenceCount,
    ec.LastOccurrence,
    ec.AssignedTo,
    ec.SuggestedFix,
    CASE
        WHEN ec.Severity = 'CRITICAL' THEN 'URGENT'
        WHEN ec.Severity = 'ERROR' AND ec.OccurrenceCount > 5 THEN 'HIGH'
        WHEN ec.Severity = 'ERROR' THEN 'MEDIUM'
        ELSE 'LOW'
    END AS priority
FROM error_context ec
WHERE ec.Status IN ('NEW','ACKNOWLEDGED','IN_PROGRESS')
ORDER BY FIELD(ec.Severity,'CRITICAL','ERROR','WARNING','INFO') DESC,
         ec.OccurrenceCount DESC,
         ec.LastOccurrence DESC;

-- ---------------------------------------------------------------------------
-- 3. STORED PROCEDURES & FUNCTIONS
-- ---------------------------------------------------------------------------

DELIMITER $$

CREATE PROCEDURE generate_member_id (OUT new_id VARCHAR(10))
BEGIN
    DECLARE max_num INT DEFAULT 0;
    START TRANSACTION;
        SELECT COALESCE(MAX(CAST(SUBSTRING(MemberID, 2) AS UNSIGNED)), 0) INTO max_num
        FROM members FOR UPDATE;
        SET new_id = CONCAT('A', LPAD(max_num + 1, 4, '0'));
    COMMIT;
END$$

CREATE PROCEDURE sp_admin_update_member_status (
    IN p_MemberID      VARCHAR(10),
    IN p_AdminEmail    VARCHAR(255),
    IN p_NewStatus     VARCHAR(50),
    IN p_NewExpiration DATE,
    IN p_NewNotes      TEXT
)
BEGIN
    DECLARE v_FamilyID         VARCHAR(10)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_OldStatus        VARCHAR(20)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_ImpactedIDs      TEXT         CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
    DECLARE v_CalculatedAction VARCHAR(50)  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

    SELECT Status, FamilyID INTO v_OldStatus, v_FamilyID
    FROM members WHERE MemberID = p_MemberID;

    SET v_CalculatedAction = CASE
        WHEN p_NewStatus = 'lifetime' THEN 'LIFETIME_SET'
        WHEN v_OldStatus = 'expired' AND p_NewStatus = 'inactive' THEN 'INACTIVE_SET'
        WHEN p_NewExpiration IS NOT NULL THEN 'EXPIRATION_OVERRIDE'
        ELSE 'STATUS_CHANGE'
    END;

    IF v_FamilyID IS NOT NULL THEN
        SELECT GROUP_CONCAT(MemberID) INTO v_ImpactedIDs
        FROM members WHERE FamilyID = v_FamilyID;
    ELSE
        SET v_ImpactedIDs = p_MemberID;
    END IF;

    SET @internal_proc = 1;

    UPDATE members
    SET
        Status     = IFNULL(p_NewStatus,     Status),
        Expiration = IFNULL(p_NewExpiration, Expiration),
        Notes      = CONCAT(IFNULL(Notes, ''), '\n--- Admin Override (', p_AdminEmail, ' ', NOW(), ') ---\n', p_NewNotes)
    WHERE (v_FamilyID IS NOT NULL AND FamilyID = v_FamilyID)
       OR MemberID = p_MemberID;

    SET @internal_proc = NULL;

    INSERT INTO admin_member_overrides (
        AdminEmail, TargetMemberID, ImpactedMemberIDs,
        ActionType, OldValue, NewValue, AdminNotes
    ) VALUES (
        p_AdminEmail, p_MemberID, v_ImpactedIDs,
        v_CalculatedAction, v_OldStatus,
        IFNULL(p_NewStatus, v_OldStatus), p_NewNotes
    );
END$$

CREATE PROCEDURE sp_error_summary_report (IN p_days_back INT)
BEGIN
    SELECT
        ErrorCode,
        TableName,
        ColumnName,
        Severity,
        COUNT(*)       AS TotalOccurrences,
        MAX(LastOccurrence) AS MostRecent,
        Status
    FROM error_context
    WHERE LastOccurrence >= DATE_SUB(NOW(), INTERVAL p_days_back DAY)
    GROUP BY ErrorCode, TableName, ColumnName, Severity, Status
    ORDER BY FIELD(Severity,'CRITICAL','ERROR','WARNING','INFO') DESC, TotalOccurrences DESC;
END$$

CREATE PROCEDURE sp_link_transaction (
    IN p_transaction_number VARCHAR(100),
    IN p_member_id          VARCHAR(10),
    IN p_payment_type       VARCHAR(50),
    IN p_amount             DECIMAL(10,2),
    IN p_submission_id      VARCHAR(50)
)
BEGIN
    -- 1. Validation: transaction must exist
    IF NOT EXISTS (SELECT 1 FROM gmail_transactions WHERE TransactionNumber = p_transaction_number) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Error: TransactionNumber not found in gmail_transactions.';
    END IF;

    -- 2. Validation: member must exist
    IF NOT EXISTS (SELECT 1 FROM members WHERE MemberID = p_member_id) THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Error: MemberID not found.';
    END IF;

    -- 3. Insert payment — triggers handle: auto-fill, member status update,
    --    submission approval, and gmail Notes sync
    INSERT INTO payments (
        PaymentID,
        MemberID,
        TransactionNumber,
        PaymentType,
        Amount,
        SubmissionID,
        UpdatedAt
    ) VALUES (
        REPLACE(UUID(), '-', ''),
        p_member_id,
        p_transaction_number,
        p_payment_type,
        p_amount,
        p_submission_id,
        NOW()
    );
END$$

CREATE PROCEDURE sp_reconcile_member_payments (IN p_dry_run TINYINT(1))
BEGIN
    -- Stub: production version reconciles payments <-> member status.
    -- Implementation varies; basic version shown here.
    SELECT 'reconcile stub' AS run_status, p_dry_run AS dry_run;
END$$

CREATE PROCEDURE sp_renewal_audit (
    IN p_start_date        DATE,
    IN p_end_date          DATE,
    IN p_target_expiration DATE,
    IN p_membership_type   VARCHAR(20),
    IN p_only_mismatches   BOOLEAN
)
BEGIN
    DROP TEMPORARY TABLE IF EXISTS tmp_audit_results;
    DROP TEMPORARY TABLE IF EXISTS tmp_matching_txns;

    CREATE TEMPORARY TABLE tmp_audit_results (
        message_id          VARCHAR(100),
        amount              DECIMAL(10,2),
        transaction_date    DATE,
        sender              VARCHAR(255),
        memo                TEXT,
        member_id           VARCHAR(10),
        member_name         VARCHAR(255),
        current_expiration  DATE,
        target_expiration   DATE,
        status_match        VARCHAR(20),
        trace_route         VARCHAR(100),
        family_members_checked INT DEFAULT NULL,
        family_all_match    CHAR(1) DEFAULT NULL
    );

    CREATE TEMPORARY TABLE tmp_matching_txns (
        message_id          VARCHAR(100),
        amount              DECIMAL(10,2),
        transaction_date    DATE,
        transaction_number  VARCHAR(100),
        sender              VARCHAR(255),
        memo                TEXT,
        original_memo       TEXT,
        traced              BOOLEAN DEFAULT FALSE,
        member_id           VARCHAR(10)
    );

    INSERT INTO tmp_matching_txns (message_id, amount, transaction_date, transaction_number, sender, memo, original_memo)
    SELECT MessageId, Amount, TransactionDate, TransactionNumber, Sender, Memo, OriginalMemo
    FROM gmail_transactions
    WHERE TransactionDate BETWEEN p_start_date AND p_end_date
      AND Amount IN (30.00, 50.00);

    UPDATE tmp_matching_txns txn
    INNER JOIN members m ON txn.transaction_number = m.PaymentTransaction
    SET txn.member_id = m.MemberID, txn.traced = TRUE;

    UPDATE tmp_matching_txns txn
    INNER JOIN payments p ON txn.transaction_number = p.TransactionNumber
    INNER JOIN members m ON p.MemberID = m.MemberID
    SET txn.member_id = m.MemberID, txn.traced = TRUE
    WHERE txn.traced = FALSE;

    INSERT INTO tmp_audit_results (
        message_id, amount, transaction_date, sender, memo,
        member_id, member_name, current_expiration, target_expiration,
        status_match, trace_route
    )
    SELECT
        txn.message_id, txn.amount, txn.transaction_date, txn.sender,
        COALESCE(txn.memo, txn.original_memo, ''),
        txn.member_id, CONCAT(m.FirstName, ' ', m.LastName),
        m.Expiration, p_target_expiration,
        CASE
            WHEN m.Expiration IS NULL               THEN 'ERROR'
            WHEN m.Expiration >= p_target_expiration THEN 'MATCH'
            ELSE 'MISMATCH'
        END,
        CASE
            WHEN m.PaymentTransaction = txn.transaction_number THEN 'members.PaymentTransaction'
            WHEN txn.traced                                    THEN 'payments.TransactionNumber'
            ELSE 'UNKNOWN'
        END
    FROM tmp_matching_txns txn
    INNER JOIN members m ON txn.member_id = m.MemberID
    WHERE (p_membership_type = 'both')
       OR (p_membership_type = 'individual' AND LOWER(m.Type) = 'individual')
       OR (p_membership_type = 'family'     AND LOWER(m.Type) = 'family');

    INSERT INTO tmp_audit_results (message_id, amount, transaction_date, sender, memo, status_match, trace_route)
    SELECT message_id, amount, transaction_date, sender,
           COALESCE(memo, original_memo, ''), 'NOT TRACED', 'NOT FOUND'
    FROM tmp_matching_txns WHERE member_id IS NULL;

    UPDATE tmp_audit_results audit
    INNER JOIN members m ON audit.member_id = m.MemberID
    SET
        audit.family_members_checked = (SELECT COUNT(*) FROM members m2 WHERE m2.FamilyID = m.FamilyID),
        audit.family_all_match = (
            SELECT IF(MIN(m3.Expiration >= p_target_expiration) = 1, 'Y', 'N')
            FROM members m3 WHERE m3.FamilyID = m.FamilyID
        )
    WHERE m.FamilyID IS NOT NULL;

    SELECT * FROM tmp_audit_results
    WHERE (p_only_mismatches IS FALSE OR status_match <> 'MATCH')
    ORDER BY FIELD(status_match, 'MISMATCH', 'NOT TRACED', 'MATCH', 'ERROR'), transaction_date DESC;

    DROP TEMPORARY TABLE IF EXISTS tmp_audit_results;
    DROP TEMPORARY TABLE IF EXISTS tmp_matching_txns;
END$$

CREATE PROCEDURE sp_renewal_audit_default ()
BEGIN
    DECLARE v_start_date       DATE;
    DECLARE v_target_expiration DATE;

    SELECT CAST(ConfigValue AS DATE) INTO v_start_date
    FROM config WHERE ConfigKey = 'MembershipCollectionStart';

    SELECT CAST(ConfigValue AS DATE) INTO v_target_expiration
    FROM config WHERE ConfigKey = 'MembershipYearEnd';

    CALL sp_renewal_audit(v_start_date, CURDATE(), v_target_expiration, 'both', TRUE);
END$$

CREATE PROCEDURE sp_search_members_advanced (
    IN p_search_string VARCHAR(255),
    IN p_limit         INT
)
BEGIN
    DECLARE v_done            INT DEFAULT 0;
    DECLARE v_term            VARCHAR(255);
    DECLARE v_where_clause    TEXT DEFAULT '1=1';
    DECLARE v_remaining_query VARCHAR(255);

    SET v_remaining_query = TRIM(p_search_string);
    WHILE CHAR_LENGTH(v_remaining_query) > 0 AND v_done = 0 DO
        SET v_term = SUBSTRING_INDEX(v_remaining_query, ' ', 1);
        IF LOCATE(' ', v_remaining_query) > 0 THEN
            SET v_remaining_query = TRIM(SUBSTRING(v_remaining_query, LOCATE(' ', v_remaining_query) + 1));
        ELSE
            SET v_remaining_query = '';
            SET v_done = 1;
        END IF;
        SET v_where_clause = CONCAT(v_where_clause, ' AND (',
            'FirstName LIKE ', QUOTE(CONCAT('%', v_term, '%')),
            ' OR LastName LIKE ', QUOTE(CONCAT('%', v_term, '%')),
            ' OR Email LIKE ', QUOTE(CONCAT('%', v_term, '%')),
            ' OR Notes LIKE ', QUOTE(CONCAT('%', v_term, '%')),
            ' OR NYRRRunnerName LIKE ', QUOTE(CONCAT('%', v_term, '%')),
            ' OR WeChatID LIKE ', QUOTE(CONCAT('%', v_term, '%')),
            ' OR MemberID LIKE ', QUOTE(CONCAT('%', v_term, '%')),
            ')');
    END WHILE;
    SET @final_query = CONCAT(
        'SELECT MemberID, FirstName, LastName, Email, Type, Status, Expiration, WeChatID, Notes, NYRRRunnerName ',
        'FROM members ',
        'WHERE ', v_where_clause, ' ',
        'ORDER BY FirstName, LastName ',
        'LIMIT ', p_limit
    );
    PREPARE stmt FROM @final_query;
    EXECUTE stmt;
    DEALLOCATE PREPARE stmt;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- 4. TRIGGERS  (creation order = fire order within same event/timing)
-- ---------------------------------------------------------------------------

DELIMITER $$

-- members: BEFORE INSERT
CREATE TRIGGER trg_members_insert_validate
BEFORE INSERT ON members FOR EACH ROW
BEGIN
    DECLARE error_context_id VARCHAR(50);
    DECLARE error_msg TEXT;

    SET error_context_id = UUID();

    IF NEW.Email IS NOT NULL AND NEW.Email NOT LIKE '%@%' THEN
        SET error_msg = CONCAT('Invalid email format: "', NEW.Email, '". Must contain @. Error: ', error_context_id);
        INSERT INTO error_context (
            ErrorContextID, ErrorCode, ErrorMessage, TechnicalMessage,
            TableName, ColumnName, ProblematicValue, ValidValueExamples, SuggestedFix, Severity
        ) VALUES (
            error_context_id, 'MEM_INVALID_EMAIL',
            CONCAT('Email format invalid: ', NEW.Email),
            'Email validation failed: missing @ symbol',
            'members', 'Email', NEW.Email,
            '["john@example.com", "jane.doe@company.org"]',
            'Verify email address format matches standard email pattern (user@domain.com)',
            'WARNING'
        );
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
    END IF;

    IF NEW.Status NOT IN ('active','expired','inactive','pending','pending_upgrade','lifetime') THEN
        SET error_msg = CONCAT('Invalid Status: "', NEW.Status, '". Error: ', error_context_id);
        INSERT INTO error_context (
            ErrorContextID, ErrorCode, ErrorMessage, TechnicalMessage,
            TableName, ColumnName, ProblematicValue, AllowedRange, SuggestedFix, Severity
        ) VALUES (
            error_context_id, 'MEM_INVALID_STATUS',
            CONCAT('Invalid member status: ', NEW.Status),
            'Status enum constraint violated on members table',
            'members', 'Status', NEW.Status,
            'active | expired | inactive | pending | pending_upgrade | lifetime',
            'Status must be one of: active, expired, inactive, pending, pending_upgrade, lifetime',
            'ERROR'
        );
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
    END IF;
END$$

-- members: BEFORE UPDATE (x2 — fire in creation order)
CREATE TRIGGER members_before_update
BEFORE UPDATE ON members FOR EACH ROW
BEGIN
    IF NOT (NEW.Expiration <=> OLD.Expiration) THEN  -- NULL-safe: NULL<>NULL would be NULL, not TRUE
        IF @internal_proc IS NULL OR @internal_proc <> 1 THEN
            SIGNAL SQLSTATE '45000'
                SET MESSAGE_TEXT = 'Direct update to Expiration column is not allowed. Use the approved Procedure.';
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_members_before_update_lifetime
BEFORE UPDATE ON members FOR EACH ROW
BEGIN
    -- Fire regardless of @internal_proc — the expiration lock trigger already
    -- allows the procedure through; this setter must not be gated the same way.
    IF NEW.Status = 'lifetime' AND OLD.Status <> 'lifetime' THEN
        SET NEW.Expiration = '2126-03-31';
    END IF;
END$$

-- members: AFTER INSERT
CREATE TRIGGER trg_members_after_insert
AFTER INSERT ON members FOR EACH ROW
BEGIN
    INSERT INTO member_log (
        LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
        Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
        MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, Notes,
        NYRRRunnerName, YearBorn
    ) VALUES (
        UUID(), NOW(), NEW.MemberID, 'INSERT', NEW.Status, NEW.Created, NEW.Expiration,
        NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District,
        NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.Notes,
        NEW.NYRRRunnerName, NEW.YearBorn
    );
END$$

-- members: AFTER UPDATE
CREATE TRIGGER trg_members_after_update
AFTER UPDATE ON members FOR EACH ROW
BEGIN
    INSERT INTO member_log (
        LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration,
        Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District,
        MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, Notes,
        NYRRRunnerName, YearBorn
    ) VALUES (
        UUID(), NOW(), NEW.MemberID, 'UPDATE', NEW.Status, NEW.Created, NEW.Expiration,
        NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District,
        NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.Notes,
        NEW.NYRRRunnerName, NEW.YearBorn
    );
END$$

-- payments: BEFORE INSERT (x3 — fire in creation order)
CREATE TRIGGER trg_payments_limit_check_insert
BEFORE INSERT ON payments FOR EACH ROW
BEGIN
    DECLARE v_max  DECIMAL(10,2);
    DECLARE v_used DECIMAL(10,2);
    SELECT Amount INTO v_max FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;
    SELECT IFNULL(SUM(Amount), 0) INTO v_used FROM payments WHERE TransactionNumber = NEW.TransactionNumber;
    IF (v_used + NEW.Amount) > v_max THEN
        SIGNAL SQLSTATE '45000'
            SET MESSAGE_TEXT = 'Split Error: Total payments exceed Gmail Transaction amount.';
    END IF;
END$$

CREATE TRIGGER trg_payments_insert_validate
BEFORE INSERT ON payments FOR EACH ROW
BEGIN
    DECLARE error_context_id VARCHAR(50);
    DECLARE error_msg TEXT;

    SET error_context_id = UUID();

    IF NEW.Amount IS NOT NULL AND NEW.Amount < 0 THEN
        SET error_msg = CONCAT('Payment amount cannot be negative: ', NEW.Amount, '. Error: ', error_context_id);
        INSERT INTO error_context (
            ErrorContextID, ErrorCode, ErrorMessage, TechnicalMessage,
            TableName, ColumnName, ProblematicValue, AllowedRange, SuggestedFix, Severity
        ) VALUES (
            error_context_id, 'PAY_NEGATIVE_AMOUNT',
            'Payment amount is negative',
            CONCAT('Amount validation failed: ', NEW.Amount),
            'payments', 'Amount', CAST(NEW.Amount AS CHAR),
            '>= 0',
            'Check payment amount calculation. Use absolute value if needed.',
            'WARNING'
        );
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
    END IF;

    IF NEW.SubmissionID IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM submissions WHERE SubmissionID = NEW.SubmissionID) THEN
            SET error_msg = CONCAT('SubmissionID "', NEW.SubmissionID, '" does not exist. Error: ', error_context_id);
            INSERT INTO error_context (
                ErrorContextID, ErrorCode, ErrorMessage, TechnicalMessage,
                TableName, ColumnName, ConstraintName, ProblematicValue, SuggestedFix, Severity
            ) VALUES (
                error_context_id, 'PAY_FK_INVALID_SUBMISSION',
                CONCAT('Referenced submission not found: ', NEW.SubmissionID),
                'Foreign key validation failed on payments.SubmissionID',
                'payments', 'SubmissionID', 'fk_payments_submissions',
                NEW.SubmissionID,
                'Verify SubmissionID exists before linking payment. Or leave NULL if payment is standalone.',
                'WARNING'
            );
            SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
        END IF;
    END IF;
END$$

CREATE TRIGGER trg_payments_auto_fill
BEFORE INSERT ON payments FOR EACH ROW
BEGIN
    IF NEW.TransactionNumber IS NOT NULL THEN
        SELECT TransactionDate, PaymentMethod, Sender, Memo
        INTO @d, @m, @p, @memo
        FROM gmail_transactions
        WHERE TransactionNumber = NEW.TransactionNumber
        LIMIT 1;
        SET NEW.PaymentDate    = @d;
        SET NEW.PaymentMethod  = @m;
        SET NEW.PayerName      = @p;
        SET NEW.MemoField      = @memo;
    END IF;
END$$

-- payments: BEFORE UPDATE
CREATE TRIGGER trg_payments_limit_check_update
BEFORE UPDATE ON payments FOR EACH ROW
BEGIN
    DECLARE v_max_total  DECIMAL(10,2);
    DECLARE v_used_others DECIMAL(10,2);
    DECLARE v_rem        DECIMAL(10,2);
    DECLARE v_msg        VARCHAR(128);
    SELECT Amount INTO v_max_total
    FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber LIMIT 1;
    SELECT IFNULL(SUM(Amount), 0) INTO v_used_others
    FROM payments WHERE TransactionNumber = NEW.TransactionNumber AND PaymentID <> OLD.PaymentID;
    SET v_rem = v_max_total - v_used_others;
    IF NEW.Amount > v_rem THEN
        SET v_msg = CONCAT('Limit Exceeded: Try $', NEW.Amount, ', but only $', v_rem,
                           ' left on TX: ', LEFT(NEW.TransactionNumber, 20));
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = v_msg;
    END IF;
END$$

-- payments: AFTER INSERT (x3 — fire in creation order)
CREATE TRIGGER trg_payments_approve_submission
AFTER INSERT ON payments FOR EACH ROW
BEGIN
    IF NEW.SubmissionID IS NOT NULL THEN
        UPDATE submissions
        SET Status      = 'approved',
            PaymentID   = NEW.PaymentID,
            UpdatedByID = NEW.ProcessedBy
        WHERE SubmissionID = NEW.SubmissionID;
    END IF;
END$$

CREATE TRIGGER trg_payments_sync_to_gmail_on_change_after_payment_insert
AFTER INSERT ON payments FOR EACH ROW
BEGIN
    DECLARE v_new_notes    TEXT;
    DECLARE v_old_notes    TEXT;
    DECLARE v_latest_update DATETIME;
    SELECT
        GROUP_CONCAT(CONCAT('(', MemberID, ', ', IFNULL(PaymentType, 'N/A'), ', ', Amount, ')') SEPARATOR '; '),
        MAX(UpdatedAt)
    INTO v_new_notes, v_latest_update
    FROM payments WHERE TransactionNumber = NEW.TransactionNumber;
    SELECT Notes INTO v_old_notes
    FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber;
    IF v_old_notes IS NULL OR v_new_notes <> v_old_notes THEN
        UPDATE gmail_transactions
        SET Notes = v_new_notes, UpdatedAt = v_latest_update
        WHERE TransactionNumber = NEW.TransactionNumber;
    END IF;
END$$

CREATE TRIGGER trg_payments_sync_membership_only
AFTER INSERT ON payments FOR EACH ROW
BEGIN
    DECLARE v_target_expiration DATE;
    DECLARE v_calc_expiration   DATE;
    DECLARE v_family_id         VARCHAR(50);

    IF LOWER(NEW.PaymentType) LIKE '%membership%' THEN
        SELECT CAST(ConfigValue AS DATE) INTO v_target_expiration
        FROM config WHERE ConfigKey = 'MembershipYearEnd' LIMIT 1;

        SELECT FamilyID INTO v_family_id
        FROM members WHERE MemberID = NEW.MemberID LIMIT 1;

        SET v_calc_expiration = CASE
            WHEN MONTH(NEW.PaymentDate) >= 10
                THEN DATE(CONCAT(YEAR(NEW.PaymentDate) + 2, '-03-31'))
            ELSE DATE(CONCAT(YEAR(NEW.PaymentDate) + 1, '-03-31'))
        END;

        SET @internal_proc = 1;

        UPDATE members
        SET
            Status            = 'active',
            MembershipFeePaid = NEW.Amount,
            PaymentDate       = NEW.PaymentDate,
            PaymentTransaction = NEW.TransactionNumber,
            Expiration        = IFNULL(v_target_expiration, v_calc_expiration),
            UpdatedAt         = NOW()
        WHERE MemberID = NEW.MemberID
           OR (v_family_id IS NOT NULL AND v_family_id <> '' AND FamilyID = v_family_id);

        SET @internal_proc = NULL;
    END IF;
END$$

-- payments: AFTER UPDATE (x2)
CREATE TRIGGER trg_payments_sync_to_gmail_on_change
AFTER UPDATE ON payments FOR EACH ROW
BEGIN
    DECLARE v_new_notes    TEXT;
    DECLARE v_old_notes    TEXT;
    DECLARE v_latest_update DATETIME;
    SELECT
        GROUP_CONCAT(CONCAT('(', MemberID, ', ', IFNULL(PaymentType, 'N/A'), ', ', Amount, ')') SEPARATOR '; '),
        MAX(UpdatedAt)
    INTO v_new_notes, v_latest_update
    FROM payments WHERE TransactionNumber = NEW.TransactionNumber;
    SELECT Notes INTO v_old_notes
    FROM gmail_transactions WHERE TransactionNumber = NEW.TransactionNumber;
    IF v_old_notes IS NULL OR v_new_notes <> v_old_notes THEN
        UPDATE gmail_transactions
        SET Notes = v_new_notes, UpdatedAt = v_latest_update
        WHERE TransactionNumber = NEW.TransactionNumber;
    END IF;
END$$

CREATE TRIGGER trg_payments_update_approve_submission
AFTER UPDATE ON payments FOR EACH ROW
BEGIN
    IF (NEW.SubmissionID IS NOT NULL AND NEW.SubmissionID != '')
       AND (OLD.SubmissionID IS NULL OR OLD.SubmissionID = '')
    THEN
        UPDATE submissions
        SET Status      = 'approved',
            PaymentID   = NEW.PaymentID,
            UpdatedByID = NEW.ProcessedBy
        WHERE SubmissionID = NEW.SubmissionID AND Status = 'pending';
    END IF;
END$$

-- submissions: BEFORE INSERT
CREATE TRIGGER trg_submissions_insert_validate
BEFORE INSERT ON submissions FOR EACH ROW
BEGIN
    DECLARE error_context_id VARCHAR(50);
    DECLARE error_msg        TEXT;
    DECLARE error_code       VARCHAR(50);

    SET error_context_id = UUID();

    IF NEW.SubmissionID IS NULL THEN
        SET error_code = 'SUBM_NULL_ID';
        SET error_msg  = CONCAT('Submission ID cannot be NULL. Error: ', error_context_id);
        INSERT INTO error_context (
            ErrorContextID, ErrorCode, ErrorMessage, TechnicalMessage,
            TableName, ColumnName, ProblematicValue, ValidValueExamples, SuggestedFix, Severity
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

    IF NOT EXISTS (SELECT 1 FROM members WHERE MemberID = NEW.MemberID) THEN
        SET error_code = 'SUBM_FK_INVALID_MEMBER';
        SET error_msg  = CONCAT('MemberID "', NEW.MemberID, '" does not exist. Error: ', error_context_id);
        INSERT INTO error_context (
            ErrorContextID, ErrorCode, ErrorMessage, TechnicalMessage,
            TableName, ColumnName, ConstraintName, ProblematicValue, SuggestedFix, Severity
        ) VALUES (
            error_context_id, error_code,
            CONCAT('Invalid MemberID: ', NEW.MemberID),
            'Foreign key validation failed: referenced member does not exist',
            'submissions', 'MemberID', 'fk_submissions_members',
            NEW.MemberID,
            'Verify MemberID exists in members table before creating submission',
            'ERROR'
        );
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
    END IF;

    IF NEW.Status NOT IN ('pending','approved','cancelled','expired') THEN
        SET error_code = 'SUBM_INVALID_STATUS';
        SET error_msg  = CONCAT('Invalid Status value: "', NEW.Status, '". Error: ', error_context_id);
        INSERT INTO error_context (
            ErrorContextID, ErrorCode, ErrorMessage, TechnicalMessage,
            TableName, ColumnName, ProblematicValue, AllowedRange, ValidValueExamples, SuggestedFix, Severity
        ) VALUES (
            error_context_id, error_code,
            CONCAT('Invalid submission status: ', NEW.Status),
            'Status enum constraint violated',
            'submissions', 'Status', NEW.Status,
            'pending | approved | cancelled | expired',
            '["pending", "approved"]',
            'Use one of the allowed status values. Default is "pending".',
            'ERROR'
        );
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
    END IF;

    IF NEW.Amount IS NOT NULL AND NEW.Amount < 0 THEN
        SET error_code = 'SUBM_NEGATIVE_AMOUNT';
        SET error_msg  = CONCAT('Amount cannot be negative: ', NEW.Amount, '. Error: ', error_context_id);
        INSERT INTO error_context (
            ErrorContextID, ErrorCode, ErrorMessage, TechnicalMessage,
            TableName, ColumnName, ProblematicValue, AllowedRange, SuggestedFix, Severity
        ) VALUES (
            error_context_id, error_code,
            'Submission amount is negative',
            'Amount validation failed: received negative value',
            'submissions', 'Amount', CAST(NEW.Amount AS CHAR),
            '>= 0',
            'Ensure amount is positive. Use absolute value or check calculation logic.',
            'WARNING'
        );
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = error_msg;
    END IF;
END$$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- 5. SEED DATA — minimal config rows required by trigger logic
-- ---------------------------------------------------------------------------

INSERT INTO config (ConfigKey, ConfigValue, Description) VALUES
    ('MembershipYearEnd',         '2027-03-31', 'Expiration date for the current membership year'),
    ('MembershipCollectionStart', '2026-10-01', 'First day of the renewal collection window'),
    ('IndividualMembershipFee',   '30.00',      'Standard individual membership fee'),
    ('FamilyMembershipFee',       '50.00',      'Standard family membership fee')
ON DUPLICATE KEY UPDATE ConfigValue = VALUES(ConfigValue);

-- ---------------------------------------------------------------------------
-- 6. SELF-REGISTRATION
-- ---------------------------------------------------------------------------

INSERT INTO schema_migrations (version, description, executed_at)
VALUES ('INTEGRATION_SCHEMA', 'Integration test schema — all tables, views, triggers, procedures', NOW())
ON DUPLICATE KEY UPDATE executed_at = NOW();
