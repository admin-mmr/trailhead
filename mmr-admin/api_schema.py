#!/usr/bin/env python3
"""
Schema export endpoints.

TSV snapshot (audit/diff):
    curl https://<host>/api/export-schema > db/schema_snapshot.sql
    mysql-mmr < db/queries/schema_snapshot_query.sql > db/schema_snapshot.sql

Executable DDL (testcontainers seed):
    curl https://<host>/api/export-schema-ddl > db/schema_integration.sql
"""

import os
from flask import Blueprint, Response
import mysql.connector

schema_bp = Blueprint('schema', __name__, url_prefix='/api')

# Sections match schema_snapshot_query.sql exactly (same columns, same ORDER BY)
_SECTIONS = [
    ('=== 1. TABLES ===', """
        SELECT TABLE_NAME AS `table`, ENGINE AS engine,
               TABLE_COLLATION AS collation, TABLE_COMMENT AS comment
        FROM information_schema.TABLES
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
        ORDER BY TABLE_NAME
    """),
    ('=== 2. COLUMNS ===', """
        SELECT TABLE_NAME AS `table`, ORDINAL_POSITION AS `#`,
               COLUMN_NAME AS column_name, COLUMN_TYPE AS col_type,
               IS_NULLABLE AS nullable, COLUMN_DEFAULT AS `default`,
               EXTRA AS extra, COLUMN_KEY AS `key`, COLUMN_COMMENT AS comment
        FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME, ORDINAL_POSITION
    """),
    ('=== 3. INDEXES ===', """
        SELECT TABLE_NAME AS `table`, INDEX_NAME AS index_name,
               NON_UNIQUE AS non_unique, SEQ_IN_INDEX AS seq,
               COLUMN_NAME AS column_name, INDEX_TYPE AS index_type,
               NULLABLE AS nullable
        FROM information_schema.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
    """),
    ('=== 4. FOREIGN KEYS ===', """
        SELECT kcu.TABLE_NAME AS `table`, kcu.COLUMN_NAME AS column_name,
               kcu.CONSTRAINT_NAME AS constraint_name,
               kcu.REFERENCED_TABLE_NAME AS ref_table,
               kcu.REFERENCED_COLUMN_NAME AS ref_column,
               rc.UPDATE_RULE, rc.DELETE_RULE
        FROM information_schema.KEY_COLUMN_USAGE kcu
        JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
             ON rc.CONSTRAINT_NAME   = kcu.CONSTRAINT_NAME
            AND rc.CONSTRAINT_SCHEMA = kcu.TABLE_SCHEMA
        WHERE kcu.TABLE_SCHEMA = DATABASE()
          AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
        ORDER BY kcu.TABLE_NAME, kcu.COLUMN_NAME
    """),
    ('=== 5. VIEWS ===', """
        SELECT TABLE_NAME AS view_name, VIEW_DEFINITION
        FROM information_schema.VIEWS
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME
    """),
    ('=== 6. ROUTINES ===', """
        SELECT ROUTINE_TYPE AS type, ROUTINE_NAME AS name,
               DATA_TYPE AS return_type, ROUTINE_DEFINITION AS body
        FROM information_schema.ROUTINES
        WHERE ROUTINE_SCHEMA = DATABASE()
        ORDER BY ROUTINE_TYPE, ROUTINE_NAME
    """),
    ('=== 7. TRIGGERS ===', """
        SELECT TRIGGER_NAME AS trigger_name, EVENT_MANIPULATION AS event,
               EVENT_OBJECT_TABLE AS `table`, ACTION_TIMING AS timing,
               ACTION_STATEMENT AS body
        FROM information_schema.TRIGGERS
        WHERE TRIGGER_SCHEMA = DATABASE()
        ORDER BY EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION
    """),
]


def _tsv(cursor):
    """Format cursor results as TSV matching mysql CLI output (NULL → 'NULL')."""
    cols = [d[0] for d in cursor.description]
    lines = ['\t'.join(cols)]
    for row in cursor.fetchall():
        lines.append('\t'.join('NULL' if v is None else str(v) for v in row))
    return '\n'.join(lines)


def _run_snapshot():
    host = os.environ.get('MYSQL_HOST')
    user = os.environ.get('MYSQL_USER')
    password = os.environ.get('MYSQL_PASSWORD')
    database = os.environ.get('MYSQL_DATABASE', 'mmrdb')
    if not all([host, user, password]):
        raise ValueError('Missing MySQL env vars: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD')

    conn = mysql.connector.connect(host=host, user=user, password=password, database=database)
    cur = conn.cursor()
    out = []
    try:
        for label, query in _SECTIONS:
            out.append('section\n' + label)
            cur.execute(query)
            out.append(_tsv(cur))
    finally:
        cur.close()
        conn.close()

    return '\n'.join(out) + '\n'


@schema_bp.route('/export-schema', methods=['GET'])
def export_schema():
    """Export schema as TSV — identical to: mysql-mmr < db/queries/schema_snapshot_query.sql"""
    try:
        output = _run_snapshot()
        return Response(
            output,
            mimetype='text/plain',
            headers={'Content-Disposition': 'attachment; filename="schema_snapshot.sql"'}
        )
    except ValueError as e:
        return {'error': str(e)}, 400
    except mysql.connector.Error as e:
        return {'error': f'MySQL error: {e.msg}'}, 500
    except Exception as e:
        return {'error': f'Unexpected error: {str(e)}'}, 500


def _run_ddl_export():
    """Generate executable DDL via SHOW CREATE statements — safe to load into testcontainers."""
    host     = os.environ.get('MYSQL_HOST')
    user     = os.environ.get('MYSQL_USER')
    password = os.environ.get('MYSQL_PASSWORD')
    database = os.environ.get('MYSQL_DATABASE', 'mmrdb')
    if not all([host, user, password]):
        raise ValueError('Missing MySQL env vars: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD')

    conn = mysql.connector.connect(host=host, user=user, password=password, database=database)
    cur  = conn.cursor()
    out  = []

    try:
        from datetime import datetime, timezone
        out.append(f'-- Generated by /api/export-schema-ddl — {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")}')
        out.append('-- MySQL 5.7+ compatible DDL — used by testcontainers for local integration tests')
        out.append('')
        out.append(f'CREATE DATABASE IF NOT EXISTS {database} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;')
        out.append(f'USE {database};')
        out.append('')
        out.append('SET FOREIGN_KEY_CHECKS = 0;')
        out.append('')

        # --- Tables ---
        out.append('-- ---------------------------------------------------------------------------')
        out.append('-- TABLES')
        out.append('-- ---------------------------------------------------------------------------')
        cur.execute("""
            SELECT TABLE_NAME FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE'
            ORDER BY TABLE_NAME
        """)
        tables = [r[0] for r in cur.fetchall()]
        for table in tables:
            cur.execute(f'SHOW CREATE TABLE `{table}`')
            row = cur.fetchone()
            ddl = row[1]
            # Ensure IF NOT EXISTS for idempotent re-runs
            ddl = ddl.replace('CREATE TABLE `', 'CREATE TABLE IF NOT EXISTS `', 1)
            out.append(ddl + ';')
            out.append('')

        out.append('SET FOREIGN_KEY_CHECKS = 1;')
        out.append('')

        # --- Views ---
        cur.execute("""
            SELECT TABLE_NAME FROM information_schema.VIEWS
            WHERE TABLE_SCHEMA = DATABASE() ORDER BY TABLE_NAME
        """)
        views = [r[0] for r in cur.fetchall()]
        if views:
            out.append('-- ---------------------------------------------------------------------------')
            out.append('-- VIEWS')
            out.append('-- ---------------------------------------------------------------------------')
            for view in views:
                cur.execute(f'SHOW CREATE VIEW `{view}`')
                row = cur.fetchone()
                ddl = row[1]
                ddl = ddl.replace('CREATE ', 'CREATE OR REPLACE ', 1)
                out.append('DELIMITER $$')
                out.append(ddl + '$$')
                out.append('DELIMITER ;')
                out.append('')

        # --- Stored procedures ---
        cur.execute("""
            SELECT ROUTINE_NAME FROM information_schema.ROUTINES
            WHERE ROUTINE_SCHEMA = DATABASE() AND ROUTINE_TYPE = 'PROCEDURE'
            ORDER BY ROUTINE_NAME
        """)
        procs = [r[0] for r in cur.fetchall()]
        if procs:
            out.append('-- ---------------------------------------------------------------------------')
            out.append('-- STORED PROCEDURES')
            out.append('-- ---------------------------------------------------------------------------')
            out.append('DELIMITER $$')
            for proc in procs:
                cur.execute(f'SHOW CREATE PROCEDURE `{proc}`')
                row = cur.fetchone()
                ddl = row[2]  # col 2 = Create Procedure
                out.append(f'DROP PROCEDURE IF EXISTS `{proc}`$$')
                out.append(f'CREATE PROCEDURE `{proc}` {ddl.split(None, 3)[3]}$$')
                out.append('')
            out.append('DELIMITER ;')
            out.append('')

        # --- Triggers ---
        cur.execute("""
            SELECT TRIGGER_NAME FROM information_schema.TRIGGERS
            WHERE TRIGGER_SCHEMA = DATABASE()
            ORDER BY EVENT_OBJECT_TABLE, ACTION_TIMING, EVENT_MANIPULATION
        """)
        triggers = [r[0] for r in cur.fetchall()]
        if triggers:
            out.append('-- ---------------------------------------------------------------------------')
            out.append('-- TRIGGERS')
            out.append('-- ---------------------------------------------------------------------------')
            out.append('DELIMITER $$')
            for trigger in triggers:
                cur.execute(f'SHOW CREATE TRIGGER `{trigger}`')
                row = cur.fetchone()
                ddl = row[2]  # col 2 = SQL Original Statement
                out.append(f'DROP TRIGGER IF EXISTS `{trigger}`$$')
                out.append(ddl + '$$')
                out.append('')
            out.append('DELIMITER ;')
            out.append('')

    finally:
        cur.close()
        conn.close()

    return '\n'.join(out) + '\n'


@schema_bp.route('/export-schema-ddl', methods=['GET'])
def export_schema_ddl():
    """Export executable DDL — safe to pipe directly into testcontainers MySQL."""
    try:
        output = _run_ddl_export()
        return Response(
            output,
            mimetype='text/plain',
            headers={'Content-Disposition': 'attachment; filename="schema_integration.sql"'}
        )
    except ValueError as e:
        return {'error': str(e)}, 400
    except mysql.connector.Error as e:
        return {'error': f'MySQL error: {e.msg}'}, 500
    except Exception as e:
        return {'error': f'Unexpected error: {str(e)}'}, 500
