#!/usr/bin/env python3
"""
Schema export endpoint — runs the same queries as db/queries/schema_snapshot_query.sql.

Both methods produce identical TSV output:
    curl https://<host>/api/export-schema > db/schema_snapshot.sql
    mysql-mmr < db/queries/schema_snapshot_query.sql > db/schema_snapshot.sql
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
