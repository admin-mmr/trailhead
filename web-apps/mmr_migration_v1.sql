-- ============================================================
-- MMR Database Migration Script v1.0
-- Target: mmr-mysql.mysql.database.azure.com / mmrdb
-- Run as: mmradmin
-- Date: 2026-03-18
--
-- HOW TO RUN:
--   mysql -h mmr-mysql.mysql.database.azure.com -u mmradmin -p \
--         --ssl-mode=REQUIRED mmrdb < mmr_migration_v1.sql
--
-- SAFE TO RE-RUN: Uses CREATE TABLE IF NOT EXISTS + ALTER ... IF NOT EXISTS
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;
SET NAMES utf8mb4;

-- ============================================================
-- 1. FAMILIES
--    Referenced by members.FamilyID
-- ============================================================
CREATE TABLE IF NOT EXISTS families (
    FamilyID          VARCHAR(10)   NOT NULL,
    PrimaryMemberID   VARCHAR(10)   NULL,
    CreatedAt         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Notes             TEXT          NULL,
    PRIMARY KEY (FamilyID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 2. MEMBERS
--    Source of truth. Matches Membership Master → Main sheet.
--    Adds auth columns for social login (Google, Microsoft, Apple, Yahoo).
-- ============================================================
CREATE TABLE IF NOT EXISTS members (
    -- Core identity
    MemberID            VARCHAR(10)     NOT NULL,
    Status              ENUM('active','not active','pending') NOT NULL DEFAULT 'pending',
    Created             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Expiration          DATETIME        NULL,
    Email               VARCHAR(255)    NOT NULL,   -- Primary login key, always unique
    FirstName           VARCHAR(100)    NOT NULL,
    LastName            VARCHAR(100)    NOT NULL,
    Type                ENUM('Individual','Family') NOT NULL DEFAULT 'Individual',
    FamilyID            VARCHAR(10)     NULL,
    Gender              VARCHAR(20)     NULL,
    WeChatID            VARCHAR(100)    NULL,
    District            VARCHAR(100)    NULL,
    WebApp              VARCHAR(50)     NULL,
    PaymentCheck        VARCHAR(50)     NULL,
    Info                TEXT            NULL,
    LastUpdated         DATETIME        NULL,
    MembershipFeePaid   DECIMAL(10,2)   NULL,
    PaymentDate         DATETIME        NULL,
    PaymentTransaction  VARCHAR(100)    NULL,
    JoinYear            SMALLINT        NULL,
    PhoneNumber         VARCHAR(30)     NULL,
    LastLoginDate       DATETIME        NULL,
    Notes               TEXT            NULL,
    NYRRMemberID        VARCHAR(50)     NULL,
    NYRRMemberName      VARCHAR(100)    NULL,

    -- Auth: password (bcrypt/argon2, stored hashed — no plaintext ever)
    password_hash       VARCHAR(255)    NULL,

    -- Auth: OAuth subject IDs (NULL = provider not linked)
    google_sub          VARCHAR(255)    NULL,   -- Google Identity sub claim
    microsoft_sub       VARCHAR(255)    NULL,   -- Microsoft identity object ID
    apple_sub           VARCHAR(255)    NULL,   -- Apple sub claim
    yahoo_sub           VARCHAR(255)    NULL,   -- Yahoo GUID

    -- Timestamps
    CreatedAt           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (MemberID),
    UNIQUE KEY uq_members_email       (Email),
    UNIQUE KEY uq_members_google      (google_sub),
    UNIQUE KEY uq_members_microsoft   (microsoft_sub),
    UNIQUE KEY uq_members_apple       (apple_sub),
    UNIQUE KEY uq_members_yahoo       (yahoo_sub),
    INDEX idx_members_status          (Status),
    INDEX idx_members_expiration      (Expiration),
    INDEX idx_members_familyid        (FamilyID),
    INDEX idx_members_joinyear        (JoinYear),

    CONSTRAINT fk_members_family
        FOREIGN KEY (FamilyID) REFERENCES families(FamilyID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 3. MEMBER_LOG
--    Append-only audit trail. Matches Membership-Master-Log sheet.
--    Every INSERT/UPDATE to members writes a snapshot here.
-- ============================================================
CREATE TABLE IF NOT EXISTS member_log (
    LogID               VARCHAR(60)     NOT NULL,
    LoggingTime         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    MemberID            VARCHAR(10)     NOT NULL,
    ChangeType          ENUM('INSERT','UPDATE','DELETE','IMPORT','ADMIN') NULL,
    ChangedBy           VARCHAR(255)    NULL,   -- email of who made the change
    -- Snapshot of member row at time of change:
    Status              VARCHAR(50)     NULL,
    Created             DATETIME        NULL,
    Expiration          DATETIME        NULL,
    Email               VARCHAR(255)    NULL,
    FirstName           VARCHAR(100)    NULL,
    LastName            VARCHAR(100)    NULL,
    Type                VARCHAR(50)     NULL,
    FamilyID            VARCHAR(10)     NULL,
    Gender              VARCHAR(20)     NULL,
    WeChatID            VARCHAR(100)    NULL,
    District            VARCHAR(100)    NULL,
    WebApp              VARCHAR(50)     NULL,
    PaymentCheck        VARCHAR(50)     NULL,
    Info                TEXT            NULL,
    LastUpdated         DATETIME        NULL,
    MembershipFeePaid   DECIMAL(10,2)   NULL,
    PaymentDate         DATETIME        NULL,
    PaymentTransaction  VARCHAR(100)    NULL,
    JoinYear            SMALLINT        NULL,
    PhoneNumber         VARCHAR(30)     NULL,
    LastLoginDate       DATETIME        NULL,
    Notes               TEXT            NULL,
    NYRRMemberID        VARCHAR(50)     NULL,
    NYRRMemberName      VARCHAR(100)    NULL,

    PRIMARY KEY (LogID),
    INDEX idx_memberlog_memberid    (MemberID),
    INDEX idx_memberlog_loggingtime (LoggingTime)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 4. OTP_TOKENS
--    Email-based one-time passwords. Matches OTP sheet.
-- ============================================================
CREATE TABLE IF NOT EXISTS otp_tokens (
    id          BIGINT          NOT NULL AUTO_INCREMENT,
    Email       VARCHAR(255)    NOT NULL,
    OTPCode     VARCHAR(10)     NOT NULL,
    CreatedAt   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ExpiresAt   DATETIME        NOT NULL,
    Used        BOOLEAN         NOT NULL DEFAULT FALSE,
    IPAddress   VARCHAR(50)     NULL,

    PRIMARY KEY (id),
    INDEX idx_otp_email     (Email),
    INDEX idx_otp_expiresat (ExpiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 5. PASSWORD_RESET_TOKENS
--    New table. Used by forgot-password flow.
--    Token stored hashed (SHA-256), never plaintext.
--    One active token per email at a time.
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    TokenID     VARCHAR(50)     NOT NULL,
    Email       VARCHAR(255)    NOT NULL,
    TokenHash   VARCHAR(255)    NOT NULL,   -- SHA-256 of the token sent in the email link
    ExpiresAt   DATETIME        NOT NULL,   -- typically NOW() + 1 hour
    Used        BOOLEAN         NOT NULL DEFAULT FALSE,
    CreatedAt   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (TokenID),
    INDEX idx_prt_email     (Email),
    INDEX idx_prt_expiresat (ExpiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 6. GMAIL_TRANSACTIONS
--    Combines Active + Archive tabs from "Fetch Gmail data" sheet.
--    GAS trigger writes to Google Sheet; Azure Function syncs here.
--    MessageId is the Gmail message ID — globally unique.
-- ============================================================
CREATE TABLE IF NOT EXISTS gmail_transactions (
    MessageId           VARCHAR(100)    NOT NULL,   -- Gmail message ID, PK
    TimeStamp           DATETIME        NOT NULL,
    Sender              VARCHAR(255)    NULL,
    Amount              DECIMAL(10,2)   NULL,
    Memo                TEXT            NULL,
    TransactionDate     DATE            NULL,
    TransactionNumber   VARCHAR(100)    NULL,       -- Zelle confirmation / Venmo ID
    Subject             VARCHAR(500)    NULL,
    OriginalMemo        TEXT            NULL,
    Notes               TEXT            NULL,
    ProcessedTime       DATETIME        NULL,
    Source              ENUM('Zelle','Venmo','Other') NULL,
    WebAppID            VARCHAR(50)     NULL,       -- FK → payment_events.EventID when matched
    IsArchived          BOOLEAN         NOT NULL DEFAULT FALSE,  -- replaces Active vs Archive tabs
    SyncedAt            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (MessageId),
    INDEX idx_gmail_transactiondate   (TransactionDate),
    INDEX idx_gmail_transactionnumber (TransactionNumber),
    INDEX idx_gmail_isarchived        (IsArchived),
    INDEX idx_gmail_webappid          (WebAppID),
    INDEX idx_gmail_source            (Source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 7. PAYMENT_EVENTS
--    Payment submissions from member portal. Matches WebApp-Events sheet.
--    Status is the workflow state (pending → approved / rejected).
-- ============================================================
CREATE TABLE IF NOT EXISTS payment_events (
    EventID                     VARCHAR(50)     NOT NULL,
    EventType                   VARCHAR(50)     NOT NULL,   -- e.g. 'PaymentProof'
    Timestamp                   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ExpiresAt                   DATETIME        NULL,
    MemberID                    VARCHAR(10)     NULL,
    Email                       VARCHAR(255)    NOT NULL,
    PaymentIntent               VARCHAR(100)    NULL,   -- 'Individual Membership', 'Family Membership', etc.
    Amount                      DECIMAL(10,2)   NULL,
    PaymentMethod               VARCHAR(50)     NULL,   -- 'Zelle' or 'Venmo'
    PayerName                   VARCHAR(100)    NULL,
    MemoField                   TEXT            NULL,
    Last4Digits                 VARCHAR(10)     NULL,
    FamilyMemberEmails          TEXT            NULL,   -- comma-separated for family plans
    Status                      ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    MatchedMessageId            VARCHAR(100)    NULL,   -- FK → gmail_transactions.MessageId
    MatchedTransactionNumber    VARCHAR(100)    NULL,
    AdminApprover               VARCHAR(255)    NULL,
    ApprovalDate                DATETIME        NULL,
    Notes                       TEXT            NULL,
    PaymentDate                 DATETIME        NULL,
    ScreenshotFileId            VARCHAR(255)    NULL,
    GDriveFilePath              VARCHAR(500)    NULL,
    OCRText                     TEXT            NULL,
    OCRTimestamp                DATETIME        NULL,
    CreatedAt                   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt                   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

    PRIMARY KEY (EventID),
    INDEX idx_pe_memberid         (MemberID),
    INDEX idx_pe_email            (Email),
    INDEX idx_pe_status           (Status),
    INDEX idx_pe_timestamp        (Timestamp),
    INDEX idx_pe_matchedmessageid (MatchedMessageId),

    CONSTRAINT fk_pe_member
        FOREIGN KEY (MemberID) REFERENCES members(MemberID) ON DELETE SET NULL,
    CONSTRAINT fk_pe_gmail
        FOREIGN KEY (MatchedMessageId) REFERENCES gmail_transactions(MessageId) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 8. PAYMENTS
--    Confirmed/processed payments. Matches Payment-History sheet.
--    This is the official financial record.
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
    PaymentID               VARCHAR(50)     NOT NULL,
    EventID                 VARCHAR(50)     NULL,
    MemberID                VARCHAR(10)     NULL,
    PaymentDate             DATETIME        NULL,
    Amount                  DECIMAL(10,2)   NOT NULL,
    MembershipType          VARCHAR(100)    NULL,
    PaymentMethod           VARCHAR(50)     NULL,
    PayerName               VARCHAR(100)    NULL,
    MemoField               TEXT            NULL,
    Last4Digits             VARCHAR(10)     NULL,
    TransactionReference    VARCHAR(100)    NULL,
    PeriodStart             DATE            NULL,
    PeriodEnd               DATE            NULL,
    ProcessedBy             VARCHAR(255)    NULL,
    ProcessedDate           DATETIME        NULL,
    Source                  VARCHAR(50)     NULL,   -- 'WebApp', 'Admin-Created', etc.
    Notes                   TEXT            NULL,
    CreatedAt               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY (PaymentID),
    INDEX idx_payments_memberid    (MemberID),
    INDEX idx_payments_eventid     (EventID),
    INDEX idx_payments_paymentdate (PaymentDate),
    INDEX idx_payments_periodend   (PeriodEnd),

    CONSTRAINT fk_payments_member
        FOREIGN KEY (MemberID) REFERENCES members(MemberID) ON DELETE SET NULL,
    CONSTRAINT fk_payments_event
        FOREIGN KEY (EventID) REFERENCES payment_events(EventID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 9. ACTIVITY_LOG
--    Web app session events. Matches WebApp-ActivityLog sheet.
--    Write-heavy; no foreign key constraints to stay fast.
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_log (
    LogID           VARCHAR(50)     NOT NULL,
    Timestamp       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    SessionID       VARCHAR(50)     NULL,
    MemberID        VARCHAR(10)     NULL,
    Email           VARCHAR(255)    NULL,
    EventID         VARCHAR(50)     NULL,
    Action          VARCHAR(100)    NOT NULL,   -- LOGIN_START, LOGIN_SUCCESS, PAYMENT_SUBMIT, etc.
    State           VARCHAR(50)     NULL,
    ErrorCode       VARCHAR(50)     NULL,
    ErrorMessage    TEXT            NULL,

    PRIMARY KEY (LogID),
    INDEX idx_actlog_memberid  (MemberID),
    INDEX idx_actlog_timestamp (Timestamp),
    INDEX idx_actlog_action    (Action),
    INDEX idx_actlog_sessionid (SessionID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ============================================================
-- 10. CONFIG
--     Key-value app settings. Matches Config sheet.
-- ============================================================
CREATE TABLE IF NOT EXISTS config (
    ConfigKey       VARCHAR(100)    NOT NULL,
    ConfigValue     VARCHAR(500)    NOT NULL,
    Description     VARCHAR(500)    NULL,
    UpdatedAt       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (ConfigKey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed from spreadsheet Config tab
INSERT INTO config (ConfigKey, ConfigValue, Description) VALUES
('IndividualPrice',       '30',          'Price for individual membership'),
('FamilyPrice',           '50',          'Price for family membership'),
('PaymentMethods',        'Zelle,Venmo', 'Accepted payment methods'),
('ReminderDaysBefore',    '30',          'Days before expiry to send reminder'),
('MembershipRenewalYears','1',           'Years added per renewal')
ON DUPLICATE KEY UPDATE ConfigValue = VALUES(ConfigValue), Description = VALUES(Description);


-- ============================================================
-- 11. STORED PROCEDURE: generate_member_id
--     Generates next sequential MemberID (A0001, A0002, ...)
--     Uses SELECT ... FOR UPDATE to prevent race conditions.
-- ============================================================
DROP PROCEDURE IF EXISTS generate_member_id;

DELIMITER //
CREATE PROCEDURE generate_member_id(OUT new_id VARCHAR(10))
BEGIN
    DECLARE max_num INT DEFAULT 0;
    START TRANSACTION;
        SELECT COALESCE(MAX(CAST(SUBSTRING(MemberID, 2) AS UNSIGNED)), 0)
        INTO max_num
        FROM members
        FOR UPDATE;
        SET new_id = CONCAT('A', LPAD(max_num + 1, 4, '0'));
    COMMIT;
END //
DELIMITER ;


-- ============================================================
-- 12. TRIGGER: auto-log member changes to member_log
--     Fires after every UPDATE on members.
-- ============================================================
DROP TRIGGER IF EXISTS trg_members_after_update;

DELIMITER //
CREATE TRIGGER trg_members_after_update
AFTER UPDATE ON members
FOR EACH ROW
BEGIN
    INSERT INTO member_log (
        LogID, LoggingTime, MemberID, ChangeType,
        Status, Created, Expiration, Email, FirstName, LastName,
        Type, FamilyID, Gender, WeChatID, District, WebApp,
        PaymentCheck, Info, LastUpdated, MembershipFeePaid,
        PaymentDate, PaymentTransaction, JoinYear, PhoneNumber,
        LastLoginDate, Notes, NYRRMemberID, NYRRMemberName
    ) VALUES (
        CONCAT('ML-', UNIX_TIMESTAMP(NOW(3)) * 1000, '-', FLOOR(RAND() * 10000)),
        NOW(), NEW.MemberID, 'UPDATE',
        NEW.Status, NEW.Created, NEW.Expiration, NEW.Email, NEW.FirstName, NEW.LastName,
        NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District, NEW.WebApp,
        NEW.PaymentCheck, NEW.Info, NEW.LastUpdated, NEW.MembershipFeePaid,
        NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber,
        NEW.LastLoginDate, NEW.Notes, NEW.NYRRMemberID, NEW.NYRRMemberName
    );
END //
DELIMITER ;

-- Same trigger for INSERT
DROP TRIGGER IF EXISTS trg_members_after_insert;

DELIMITER //
CREATE TRIGGER trg_members_after_insert
AFTER INSERT ON members
FOR EACH ROW
BEGIN
    INSERT INTO member_log (
        LogID, LoggingTime, MemberID, ChangeType,
        Status, Created, Expiration, Email, FirstName, LastName,
        Type, FamilyID, Gender, WeChatID, District, WebApp,
        PaymentCheck, Info, LastUpdated, MembershipFeePaid,
        PaymentDate, PaymentTransaction, JoinYear, PhoneNumber,
        LastLoginDate, Notes, NYRRMemberID, NYRRMemberName
    ) VALUES (
        CONCAT('ML-', UNIX_TIMESTAMP(NOW(3)) * 1000, '-', FLOOR(RAND() * 10000)),
        NOW(), NEW.MemberID, 'INSERT',
        NEW.Status, NEW.Created, NEW.Expiration, NEW.Email, NEW.FirstName, NEW.LastName,
        NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District, NEW.WebApp,
        NEW.PaymentCheck, NEW.Info, NEW.LastUpdated, NEW.MembershipFeePaid,
        NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber,
        NEW.LastLoginDate, NEW.Notes, NEW.NYRRMemberID, NEW.NYRRMemberName
    );
END //
DELIMITER ;


-- ============================================================
-- VERIFY: show all created tables
-- ============================================================
SELECT TABLE_NAME, TABLE_ROWS, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

SET FOREIGN_KEY_CHECKS = 1;

-- End of migration script v1.0
