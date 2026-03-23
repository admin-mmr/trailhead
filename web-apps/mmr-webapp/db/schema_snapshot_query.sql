-- ============================================================
-- MMR Schema Snapshot Query
-- Target: mmr-mysql-v4.mysql.database.azure.com / mmrdb
--
-- HOW TO RUN (from web-apps/mmr-webapp/):
--   mysql-mmr < db/schema_snapshot_query.sql > db/schema_snapshot.sql
--
-- WHAT THIS CAPTURES (structure only — no row counts, no data):
--   1. Tables       — engine, charset (no row counts or timestamps)
--   2. Columns      — every table: type, nullability, default, key, extra
--   3. Indexes      — all keys including PKs and unique constraints
--   4. Foreign keys — referential constraints
--   5. Views        — full view definition
--   6. Routines     — stored procedures & functions with full body
--
-- WHY structure-only:
--   Row counts, CREATE_TIME, and UPDATE_TIME change with normal app
--   activity and would create false-positive drift alerts.
--
-- WHEN TO UPDATE THE SNAPSHOT:
--   After any schema migration (new table, new column, index change,
--   view or procedure change), re-run this query and commit the output.
-- ============================================================

SET NAMES utf8mb4;

-- ============================================================
-- 1. TABLES — engine and charset only (no row counts / timestamps)
-- ============================================================
SELECT '=== 1. TABLES ===' AS section;

SELECT
    TABLE_NAME       AS `table`,
    ENGINE           AS engine,
    TABLE_COLLATION  AS collation,
    TABLE_COMMENT    AS comment
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE   = 'BASE TABLE'
ORDER BY TABLE_NAME;


-- ============================================================
-- 2. COLUMNS — all tables
-- ============================================================
SELECT '=== 2. COLUMNS ===' AS section;

SELECT
    TABLE_NAME       AS `table`,
    ORDINAL_POSITION AS `#`,
    COLUMN_NAME      AS column_name,
    COLUMN_TYPE      AS col_type,
    IS_NULLABLE      AS nullable,
    COLUMN_DEFAULT   AS `default`,
    EXTRA            AS extra,
    COLUMN_KEY       AS `key`,
    COLUMN_COMMENT   AS comment
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
    kcu.TABLE_NAME             AS `table`,
    kcu.COLUMN_NAME            AS column_name,
    kcu.CONSTRAINT_NAME        AS constraint_name,
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
-- 5. VIEWS — full definition
-- ============================================================
SELECT '=== 5. VIEWS ===' AS section;

SELECT
    TABLE_NAME      AS view_name,
    VIEW_DEFINITION
FROM information_schema.VIEWS
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;


-- ============================================================
-- 6. ROUTINES — full body (catches stored procedure changes)
-- ============================================================
SELECT '=== 6. ROUTINES ===' AS section;

SELECT
    ROUTINE_TYPE       AS type,
    ROUTINE_NAME       AS name,
    DATA_TYPE          AS return_type,
    ROUTINE_DEFINITION AS body
FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA = DATABASE()
ORDER BY ROUTINE_TYPE, ROUTINE_NAME;


-- ============================================================
-- End of schema snapshot query
-- ============================================================
