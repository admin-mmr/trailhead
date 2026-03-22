-- ============================================================
-- MMR Database Inspector
-- Target: mmr-mysql-v4.mysql.database.azure.com / mmrdb
--
-- HOW TO RUN:
--   mysql-mmr < db/mmr_db_inspector.sql
--
-- WHAT THIS OUTPUTS:
--   1.  Tables — engine, charset, row counts, size
--   2.  Columns — for every table (type, nullability, default, comment)
--   3.  Indexes — all keys including PKs and unique constraints
--   4.  Foreign keys — (currently none on live DB but checked for completeness)
--   5.  Views — definition
--   6.  Stored procedures & functions
--   7.  Migration history (schema_migrations)
--   8.  Sample member sub-columns — verifies OAuth columns exist
--   9.  Config table contents
--  10.  Recent activity_log entries
--  11.  Payment & event summary
-- ============================================================

SET NAMES utf8mb4;

-- ============================================================
-- 1. TABLES — engine, charset, estimated row count, data size
-- ============================================================
SELECT '=== 1. TABLES ===' AS section;

SELECT
    TABLE_NAME                                      AS `table`,
    ENGINE                                          AS engine,
    TABLE_COLLATION                                 AS collation,
    TABLE_ROWS                                      AS est_rows,
    ROUND((DATA_LENGTH + INDEX_LENGTH) / 1024, 1)  AS size_kb,
    CREATE_TIME                                     AS created,
    UPDATE_TIME                                     AS last_updated,
    TABLE_COMMENT                                   AS comment
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE   = 'BASE TABLE'
ORDER BY TABLE_NAME;


-- ============================================================
-- 2. COLUMNS — all tables
-- ============================================================
SELECT '=== 2. COLUMNS (all tables) ===' AS section;

SELECT
    TABLE_NAME      AS `table`,
    ORDINAL_POSITION AS `#`,
    COLUMN_NAME     AS column_name,
    COLUMN_TYPE     AS col_type,
    IS_NULLABLE     AS nullable,
    COLUMN_DEFAULT  AS `default`,
    EXTRA           AS extra,
    COLUMN_KEY      AS `key`,
    COLUMN_COMMENT  AS comment
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, ORDINAL_POSITION;


-- ============================================================
-- 3. INDEXES — all tables
-- ============================================================
SELECT '=== 3. INDEXES ===' AS section;

SELECT
    TABLE_NAME   AS `table`,
    INDEX_NAME   AS index_name,
    NON_UNIQUE   AS non_unique,
    SEQ_IN_INDEX AS seq,
    COLUMN_NAME  AS column_name,
    INDEX_TYPE   AS index_type,
    NULLABLE     AS nullable
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX;


-- ============================================================
-- 4. FOREIGN KEYS
-- ============================================================
SELECT '=== 4. FOREIGN KEYS ===' AS section;

SELECT
    kcu.TABLE_NAME          AS `table`,
    kcu.COLUMN_NAME         AS column_name,
    kcu.CONSTRAINT_NAME     AS constraint_name,
    kcu.REFERENCED_TABLE_NAME  AS ref_table,
    kcu.REFERENCED_COLUMN_NAME AS ref_column,
    rc.UPDATE_RULE,
    rc.DELETE_RULE
FROM information_schema.KEY_COLUMN_USAGE kcu
JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
     ON rc.CONSTRAINT_NAME   = kcu.CONSTRAINT_NAME
    AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
WHERE kcu.TABLE_SCHEMA = DATABASE()
  AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME;


-- ============================================================
-- 5. VIEWS
-- ============================================================
SELECT '=== 5. VIEWS ===' AS section;

SELECT
    TABLE_NAME   AS view_name,
    VIEW_DEFINITION
FROM information_schema.VIEWS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;


-- ============================================================
-- 6. STORED PROCEDURES & FUNCTIONS
-- ============================================================
SELECT '=== 6. STORED PROCEDURES & FUNCTIONS ===' AS section;

SELECT
    ROUTINE_TYPE AS type,
    ROUTINE_NAME AS name,
    DATA_TYPE    AS return_type,
    CREATED,
    LAST_ALTERED
FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA = DATABASE()
ORDER BY ROUTINE_TYPE, ROUTINE_NAME;


-- ============================================================
-- 7. MIGRATION HISTORY
-- ============================================================
SELECT '=== 7. MIGRATION HISTORY ===' AS section;

SELECT * FROM schema_migrations ORDER BY version;


-- ============================================================
-- 8. MEMBERS — OAuth sub-columns & auth columns presence check
-- ============================================================
SELECT '=== 8. MEMBERS — auth columns ===' AS section;

SELECT
    COLUMN_NAME,
    COLUMN_TYPE,
    IS_NULLABLE,
    COLUMN_KEY,
    COLUMN_COMMENT
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME   = 'members'
  AND COLUMN_NAME IN (
      'google_sub', 'apple_sub', 'microsoft_sub',
      'yahoo_sub',  'facebook_sub', 'password_hash',
      'MemberID', 'Email', 'Status', 'FamilyID',
      'EnglishName', 'ChineseName', 'CreatedAt'
  )
ORDER BY ORDINAL_POSITION;


-- ============================================================
-- 9. CONFIG TABLE CONTENTS
-- ============================================================
SELECT '=== 9. CONFIG ===' AS section;

SELECT * FROM config ORDER BY 1;


-- ============================================================
-- 10. RECENT ACTIVITY LOG (last 20 rows)
-- ============================================================
SELECT '=== 10. RECENT ACTIVITY LOG ===' AS section;

SELECT * FROM activity_log ORDER BY 1 DESC LIMIT 20;


-- ============================================================
-- 11. PAYMENT & EVENT SUMMARY
-- ============================================================
SELECT '=== 11. PAYMENTS — source breakdown ===' AS section;

SELECT
    Source,
    COUNT(*) AS count,
    MIN(CreatedAt) AS earliest,
    MAX(CreatedAt) AS latest
FROM payments
GROUP BY Source
ORDER BY Source;

SELECT '=== 11b. WEBAPP_EVENTS — EventType + Status breakdown ===' AS section;

SELECT
    EventType,
    Status,
    COUNT(*) AS count,
    MIN(CreatedAt) AS earliest,
    MAX(CreatedAt) AS latest
FROM webapp_events
GROUP BY EventType, Status
ORDER BY EventType, Status;


-- ============================================================
-- End of inspector
-- ============================================================
