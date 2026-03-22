-- ============================================================
-- MMR Database Migration - Consolidated Schema
-- This creates the complete schema with all v1-v4 corrections
-- ============================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- 1. FAMILIES TABLE
CREATE TABLE IF NOT EXISTS families (
    FamilyID          VARCHAR(10)   NOT NULL,
    PrimaryMemberID   VARCHAR(10)   NULL,
    CreatedAt         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Notes             TEXT          NULL,
    PRIMARY KEY (FamilyID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. MEMBERS TABLE
CREATE TABLE IF NOT EXISTS members (
    MemberID            VARCHAR(10)     NOT NULL,
    Status              ENUM('active','not active','pending') NOT NULL DEFAULT 'pending',
    Created             DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    Expiration          DATETIME        NULL,
    Email               VARCHAR(255)    NOT NULL,
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
    ProfileLastUpdated  DATETIME        NULL,
    Notes               TEXT            NULL,
    NYRRRunnerName      VARCHAR(100)    NULL,
    YearBorn            SMALLINT        NULL,
    password_hash       VARCHAR(255)    NULL,
    google_sub          VARCHAR(255)    NULL,
    microsoft_sub       VARCHAR(255)    NULL,
    apple_sub           VARCHAR(255)    NULL,
    yahoo_sub           VARCHAR(255)    NULL,
    CreatedAt           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UpdatedAt           DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (MemberID),
    UNIQUE KEY uq_members_email (Email),
    UNIQUE KEY uq_members_google (google_sub),
    UNIQUE KEY uq_members_microsoft (microsoft_sub),
    UNIQUE KEY uq_members_apple (apple_sub),
    UNIQUE KEY uq_members_yahoo (yahoo_sub),
    INDEX idx_members_status (Status),
    INDEX idx_members_expiration (Expiration),
    INDEX idx_members_familyid (FamilyID),
    INDEX idx_members_joinyear (JoinYear),
    CONSTRAINT fk_members_family FOREIGN KEY (FamilyID) REFERENCES families(FamilyID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. MEMBER_LOG
CREATE TABLE IF NOT EXISTS member_log (
    LogID               VARCHAR(60)     NOT NULL,
    LoggingTime         DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    MemberID            VARCHAR(10)     NOT NULL,
    ChangeType          ENUM('INSERT','UPDATE','DELETE','IMPORT','ADMIN') NULL,
    ChangedBy           VARCHAR(255)    NULL,
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
    NYRRRunnerName      VARCHAR(100)    NULL,
    YearBorn            SMALLINT        NULL,
    PRIMARY KEY (LogID),
    INDEX idx_memberlog_memberid (MemberID),
    INDEX idx_memberlog_loggingtime (LoggingTime)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. OTP_TOKENS
CREATE TABLE IF NOT EXISTS otp_tokens (
    id          BIGINT          NOT NULL AUTO_INCREMENT,
    Email       VARCHAR(255)    NOT NULL,
    OTPCode     VARCHAR(10)     NOT NULL,
    CreatedAt   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ExpiresAt   DATETIME        NOT NULL,
    Used        BOOLEAN         NOT NULL DEFAULT FALSE,
    IPAddress   VARCHAR(50)     NULL,
    PRIMARY KEY (id),
    INDEX idx_otp_email (Email),
    INDEX idx_otp_expiresat (ExpiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. PASSWORD_RESET_TOKENS
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    TokenID     VARCHAR(50)     NOT NULL,
    Email       VARCHAR(255)    NOT NULL,
    TokenHash   VARCHAR(255)    NOT NULL,
    ExpiresAt   DATETIME        NOT NULL,
    Used        BOOLEAN         NOT NULL DEFAULT FALSE,
    CreatedAt   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (TokenID),
    INDEX idx_prt_email (Email),
    INDEX idx_prt_expiresat (ExpiresAt)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. GMAIL_TRANSACTIONS
CREATE TABLE IF NOT EXISTS gmail_transactions (
    MessageId           VARCHAR(100)    NOT NULL,
    TimeStamp           DATETIME        NOT NULL,
    Sender              VARCHAR(255)    NULL,
    Amount              DECIMAL(10,2)   NULL,
    Memo                TEXT            NULL,
    TransactionDate     DATE            NULL,
    TransactionNumber   VARCHAR(100)    NULL,
    Subject             VARCHAR(500)    NULL,
    OriginalMemo        TEXT            NULL,
    Notes               TEXT            NULL,
    ProcessedTime       DATETIME        NULL,
    Source              VARCHAR(50)     NULL,
    WebAppID            VARCHAR(50)     NULL,
    IsArchived          BOOLEAN         NOT NULL DEFAULT FALSE,
    SyncedAt            DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (MessageId),
    INDEX idx_gmail_transactiondate (TransactionDate),
    INDEX idx_gmail_transactionnumber (TransactionNumber),
    INDEX idx_gmail_isarchived (IsArchived),
    INDEX idx_gmail_source (Source)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. WEBAPP_EVENTS
CREATE TABLE IF NOT EXISTS webapp_events (
    EventID                     VARCHAR(50)     NOT NULL,
    EventType                   VARCHAR(50)     NOT NULL,
    EventCategory               VARCHAR(50)     DEFAULT 'payment',
    Timestamp                   DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ExpiresAt                   DATETIME        NULL,
    MemberID                    VARCHAR(10)     NULL,
    Email                       VARCHAR(255)    NOT NULL,
    PaymentIntent               VARCHAR(100)    NULL,
    Amount                      DECIMAL(10,2)   NULL,
    PaymentMethod               VARCHAR(50)     NULL,
    PayerName                   VARCHAR(100)    NULL,
    MemoField                   TEXT            NULL,
    Last4Digits                 VARCHAR(10)     NULL,
    FamilyMemberEmails          TEXT            NULL,
    Status                      ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
    MatchedMessageId            VARCHAR(100)    NULL,
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
    INDEX idx_we_memberid (MemberID),
    INDEX idx_we_email (Email),
    INDEX idx_we_status (Status),
    INDEX idx_we_timestamp (Timestamp),
    INDEX idx_we_matchedmessageid (MatchedMessageId),
    CONSTRAINT fk_we_member FOREIGN KEY (MemberID) REFERENCES members(MemberID) ON DELETE SET NULL,
    CONSTRAINT fk_we_gmail FOREIGN KEY (MatchedMessageId) REFERENCES gmail_transactions(MessageId) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. PAYMENTS
CREATE TABLE IF NOT EXISTS payments (
    PaymentID               VARCHAR(50)     NOT NULL,
    EventID                 VARCHAR(50)     NULL,
    MemberID                VARCHAR(10)     NULL,
    PaymentDate             DATETIME        NULL,
    Amount                  DECIMAL(10,2)   NOT NULL,
    PaymentIntent           VARCHAR(100)    NULL,
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
    Source                  VARCHAR(50)     NULL,
    Notes                   TEXT            NULL,
    CreatedAt               DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (PaymentID),
    INDEX idx_payments_memberid (MemberID),
    INDEX idx_payments_eventid (EventID),
    INDEX idx_payments_paymentdate (PaymentDate),
    INDEX idx_payments_periodend (PeriodEnd),
    CONSTRAINT fk_payments_member FOREIGN KEY (MemberID) REFERENCES members(MemberID) ON DELETE SET NULL,
    CONSTRAINT fk_payments_event FOREIGN KEY (EventID) REFERENCES webapp_events(EventID) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. ACTIVITY_LOG
CREATE TABLE IF NOT EXISTS activity_log (
    LogID           VARCHAR(50)     NOT NULL,
    Timestamp       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    SessionID       VARCHAR(50)     NULL,
    MemberID        VARCHAR(10)     NULL,
    Email           VARCHAR(255)    NULL,
    EventID         VARCHAR(50)     NULL,
    Action          VARCHAR(100)    NOT NULL,
    State           VARCHAR(50)     NULL,
    ErrorCode       VARCHAR(50)     NULL,
    ErrorMessage    TEXT            NULL,
    PRIMARY KEY (LogID),
    INDEX idx_actlog_memberid (MemberID),
    INDEX idx_actlog_timestamp (Timestamp),
    INDEX idx_actlog_action (Action),
    INDEX idx_actlog_sessionid (SessionID)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. CONFIG
CREATE TABLE IF NOT EXISTS config (
    ConfigKey       VARCHAR(100)    NOT NULL,
    ConfigValue     VARCHAR(500)    NOT NULL,
    Description     VARCHAR(500)    NULL,
    UpdatedAt       DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (ConfigKey)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO config (ConfigKey, ConfigValue, Description) VALUES
('IndividualPrice',       '30',          'Price for individual membership'),
('FamilyPrice',           '50',          'Price for family membership'),
('PaymentMethods',        'Zelle,Venmo', 'Accepted payment methods'),
('ReminderDaysBefore',    '30',          'Days before expiry to send reminder'),
('MembershipRenewalYears','1',           'Years added per renewal')
ON DUPLICATE KEY UPDATE ConfigValue = VALUES(ConfigValue), Description = VALUES(Description);

-- 11. SCHEMA_MIGRATIONS
CREATE TABLE IF NOT EXISTS schema_migrations (
    version         VARCHAR(50)     NOT NULL,
    description     VARCHAR(255)    NULL,
    executed_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO schema_migrations (version, description) VALUES
('consolidated', 'Complete consolidated schema with all v1-v4 corrections')
ON DUPLICATE KEY UPDATE executed_at = CURRENT_TIMESTAMP;

-- 12. TRIGGER: Auto-log member INSERT
DROP TRIGGER IF EXISTS trg_members_after_insert;
DELIMITER //
CREATE TRIGGER trg_members_after_insert
AFTER INSERT ON members
FOR EACH ROW
BEGIN
    INSERT INTO member_log (LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration, Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District, WebApp, PaymentCheck, Info, LastUpdated, MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, LastLoginDate, Notes, NYRRRunnerName, YearBorn) 
    VALUES (CONCAT('ML-', UNIX_TIMESTAMP(NOW(3)) * 1000, '-', FLOOR(RAND() * 10000)), NOW(), NEW.MemberID, 'INSERT', NEW.Status, NEW.Created, NEW.Expiration, NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District, NEW.WebApp, NEW.PaymentCheck, NEW.Info, NEW.LastUpdated, NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.LastLoginDate, NEW.Notes, NEW.NYRRRunnerName, NEW.YearBorn);
END //
DELIMITER ;

-- 13. TRIGGER: Auto-log member UPDATE
DROP TRIGGER IF EXISTS trg_members_after_update;
DELIMITER //
CREATE TRIGGER trg_members_after_update
AFTER UPDATE ON members
FOR EACH ROW
BEGIN
    INSERT INTO member_log (LogID, LoggingTime, MemberID, ChangeType, Status, Created, Expiration, Email, FirstName, LastName, Type, FamilyID, Gender, WeChatID, District, WebApp, PaymentCheck, Info, LastUpdated, MembershipFeePaid, PaymentDate, PaymentTransaction, JoinYear, PhoneNumber, LastLoginDate, Notes, NYRRRunnerName, YearBorn) 
    VALUES (CONCAT('ML-', UNIX_TIMESTAMP(NOW(3)) * 1000, '-', FLOOR(RAND() * 10000)), NOW(), NEW.MemberID, 'UPDATE', NEW.Status, NEW.Created, NEW.Expiration, NEW.Email, NEW.FirstName, NEW.LastName, NEW.Type, NEW.FamilyID, NEW.Gender, NEW.WeChatID, NEW.District, NEW.WebApp, NEW.PaymentCheck, NEW.Info, NEW.LastUpdated, NEW.MembershipFeePaid, NEW.PaymentDate, NEW.PaymentTransaction, NEW.JoinYear, NEW.PhoneNumber, NEW.LastLoginDate, NEW.Notes, NEW.NYRRRunnerName, NEW.YearBorn);
END //
DELIMITER ;

-- 14. STORED PROCEDURE: Generate member ID
DROP PROCEDURE IF EXISTS generate_member_id;
DELIMITER //
CREATE PROCEDURE generate_member_id(OUT new_id VARCHAR(10))
BEGIN
    DECLARE max_num INT DEFAULT 0;
    START TRANSACTION;
        SELECT COALESCE(MAX(CAST(SUBSTRING(MemberID, 2) AS UNSIGNED)), 0) INTO max_num FROM members FOR UPDATE;
        SET new_id = CONCAT('A', LPAD(max_num + 1, 4, '0'));
    COMMIT;
END //
DELIMITER ;

SET FOREIGN_KEY_CHECKS = 1;
