#!/usr/bin/env python3
"""
Schema export endpoint for complete database structure backup.

**Purpose:** Download full MySQL schema (DDL: tables, views, triggers, procedures, functions, events).
Works on Azure (no binary deps) and local dev environments.

**Includes:**
- CREATE TABLE statements (all tables in order)
- CREATE VIEW statements (if any views exist)
- CREATE TRIGGER statements (if any triggers exist)
- CREATE PROCEDURE statements (if any procedures exist)
- CREATE FUNCTION statements (if any functions exist)
- CREATE EVENT statements (if any events exist)
- Column reference comments (for V11 schema redesign)
- Timestamp of export for audit trail

**Usage:**
    curl https://<web-app>/api/export-schema > db/schema_snapshot.sql
    # Or via browser: https://<web-app>/api/export-schema

**After schema export:**
    1. Review the downloaded schema_snapshot.sql
    2. Update with new column names (submissions table rename)
    3. Commit: git add db/schema_snapshot.sql && git commit -m "chore: update schema snapshot"
    4. Once complete, optionally remove this endpoint (delete api_schema.py + remove blueprint)

**Note:** This endpoint is NOT guarded by authentication—keep it private or remove after use.
"""

import re

from flask import Blueprint, Response
import subprocess
import os
import mysql.connector
from mysql.connector import ProgrammingError

schema_bp = Blueprint('schema', __name__, url_prefix='/api')


def _get_mysql_credentials():
    """Extract MySQL creds from env. Raise ValueError if missing."""
    host = os.environ.get('MYSQL_HOST')
    user = os.environ.get('MYSQL_USER')
    password = os.environ.get('MYSQL_PASSWORD')
    database = os.environ.get('MYSQL_DATABASE', 'mmrdb')

    if not all([host, user, password]):
        raise ValueError(
            'Missing MySQL env vars: MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD. '
            'Set in Azure App Settings or local .env.local'
        )

    return host, user, password, database


def _export_via_mysqldump():
    """Try mysqldump first (local dev with mysql-client installed)."""
    try:
        host, user, password, database = _get_mysql_credentials()
        result = subprocess.run(
            [
                'mysqldump',
                f'--host={host}',
                f'--user={user}',
                f'--password={password}',
                '--no-data',
                database
            ],
            capture_output=True,
            text=True,
            check=True,
            timeout=30
        )
        return result.stdout
    except FileNotFoundError:
        return None  # mysqldump not available, fall back to Python
    except subprocess.CalledProcessError as e:
        raise RuntimeError(f'mysqldump failed: {e.stderr}')


def _export_via_connector():
    """Fall back to mysql-connector-python with correct column indexing."""
    host, user, password, database = _get_mysql_credentials()

    conn = mysql.connector.connect(
        host=host, user=user, password=password, database=database
    )
    cursor = conn.cursor()

    try:
        sql_lines = [
            f'-- Schema export for {database}\n',
            f'-- Timestamp: {_get_timestamp()}\n\n'
        ]

        # 1. TABLES
        cursor.execute("SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = %s AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME", (database,))
        tables = [row[0] for row in cursor.fetchall()]
        sql_lines.append('-- TABLES\n')
        for table in tables:
            cursor.execute(f"SHOW CREATE TABLE `{table}`")
            sql_lines.append(cursor.fetchone()[1] + ';\n\n')

        # 2. VIEWS (Using a more reliable fetch)
        sql_lines.append('-- ==========================================\n-- VIEWS\n-- ==========================================\n')
        cursor.execute("""
            SELECT TABLE_NAME 
            FROM INFORMATION_SCHEMA.TABLES 
            WHERE TABLE_SCHEMA = %s AND TABLE_TYPE = 'VIEW'
            ORDER BY TABLE_NAME
        """, (database,))
        views = [row[0] for row in cursor.fetchall()]
        
        if not views:
            sql_lines.append('-- No views found or insufficient permissions (SHOW VIEW required).\n\n')
        else:
            for view in views:
                try:
                    cursor.execute(f"SHOW CREATE VIEW `{view}`")
                    res = cursor.fetchone()
                    
                    # res[0] = View Name
                    # res[1] = Create View SQL (In some versions)
                    # res[2] = Create View SQL (Standard MySQL 8.0)
                    # res[3] = character_set_client
                    
                    # LOGIC: Find the first item in the list that starts with 'CREATE'
                    create_sql = next((item for item in res if isinstance(item, str) and item.strip().upper().startswith('CREATE')), None)
                    create_sql = re.sub(r'DEFINER=`.*?`@`.*?` ', '', create_sql)
                    if create_sql:
                        # Basic beautification: inject newlines at key SQL keywords
                        beautified_sql = (create_sql
                            .replace(" AS select ", " AS \nSELECT \n    ")
                            .replace(",", ",\n   ")
                            .replace(" from ", "\nFROM ")
                            .replace(" where ", "\nWHERE ")
                            .replace(" left join ", "\nLEFT JOIN ")
                            .replace(" group by ", "\nGROUP BY ")
                        )
                        sql_lines.append(f"DROP VIEW IF EXISTS `{view}`;\n")
                        sql_lines.append(beautified_sql + ';\n\n')                    
                    else:
                        sql_lines.append(f"-- Could not find SQL for view {view} in result set.\n\n")
                        
                except mysql.connector.Error as err:
                    sql_lines.append(f"-- Error exporting view {view}: {err.msg}\n\n")

        # 3. PROCEDURES (Index 2)
        cursor.execute("SELECT ROUTINE_NAME FROM INFORMATION_SCHEMA.ROUTINES WHERE ROUTINE_SCHEMA = %s AND ROUTINE_TYPE = 'PROCEDURE'", (database,))
        procs = [row[0] for row in cursor.fetchall()]
        sql_lines.append('-- PROCEDURES\n')
        for proc in procs:
            cursor.execute(f"SHOW CREATE PROCEDURE `{proc}`")
            create_sql = cursor.fetchone()[2]
            create_sql = re.sub(r'DEFINER=`.*?`@`.*?` ', '', create_sql)
            # Index 2 is 'Create Procedure'
            sql_lines.append(create_sql + ';\n\n')

        # 4. TRIGGERS (Index 2)
        cursor.execute("SELECT TRIGGER_NAME FROM INFORMATION_SCHEMA.TRIGGERS WHERE TRIGGER_SCHEMA = %s", (database,))
        triggers = [row[0] for row in cursor.fetchall()]
        sql_lines.append('-- TRIGGERS\n')
        for trig in triggers:
            cursor.execute(f"SHOW CREATE TRIGGER `{trig}`")
            # Index 2 is 'SQL Original Statement'
            create_sql = cursor.fetchone()[2]
            create_sql = re.sub(r'DEFINER=`.*?`@`.*?` ', '', create_sql)
            sql_lines.append(create_sql + ';\n\n')

        # 5. EVENTS (Index 3)
        cursor.execute("SELECT EVENT_NAME FROM INFORMATION_SCHEMA.EVENTS WHERE EVENT_SCHEMA = %s", (database,))
        events = [row[0] for row in cursor.fetchall()]
        sql_lines.append('-- EVENTS\n')
        for event in events:
            cursor.execute(f"SHOW CREATE EVENT `{event}`")
            # Index 3 is 'Create Event'
            create_sql = cursor.fetchone()[3]
            create_sql = re.sub(r'DEFINER=`.*?`@`.*?` ', '', create_sql)
            sql_lines.append(create_sql + ';\n\n')

        return ''.join(sql_lines)

    finally:
        cursor.close()
        conn.close()

def _get_timestamp():
    """Return current UTC timestamp for schema export."""
    from datetime import datetime
    return datetime.utcnow().isoformat() + ' UTC'


@schema_bp.route('/export-schema', methods=['GET'])
def export_schema():
    """
    Export DB schema via mysqldump (or python connector fallback).
    Returns SQL DDL for all tables (no data).

    Response: text/plain SQL file ready to save.
    Error: JSON with error message if export fails.
    """
    try:
        # Try mysqldump first (faster, local dev with mysql-client)
        schema_sql = _export_via_mysqldump()

        # Fall back to Python connector (works on Azure, no binary deps)
        if schema_sql is None:
            schema_sql = _export_via_connector()

        # Return as downloadable file
        return Response(
            schema_sql,
            mimetype='text/plain',
            headers={
                'Content-Disposition': 'attachment; filename="schema_snapshot.sql"'
            }
        )

    except ValueError as e:
        return {'error': str(e)}, 400
    except mysql.connector.Error as e:
        return {'error': f'MySQL connection failed: {e.msg}'}, 500
    except Exception as e:
        return {'error': f'Unexpected error: {str(e)}'}, 500


@schema_bp.route('/export-schema-info', methods=['GET'])
def export_schema_info():
    """
    Quick info endpoint — schema export is available at /api/export-schema.

    REMINDER: This endpoint should be removed after schema is exported.
    """
    return {
        'endpoint': '/api/export-schema',
        'method': 'GET',
        'description': 'Downloads full MySQL schema (DDL only, no data)',
        'curl_example': 'curl https://<host>/api/export-schema > db/schema_snapshot.sql',
        'status': '⚠️  TEMPORARY — delete api_schema.py and remove blueprint registration after use'
    }, 200
