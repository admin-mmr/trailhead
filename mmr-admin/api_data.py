"""
Data browser, user settings, processing log, DB connection, and version routes.

Blueprint: data_bp
Routes: /api/tables, /api/tables/<name>, /api/user-settings/<name>,
        /api/log, /api/connection/*, /api/version
"""
from __future__ import annotations

import json
import os
import subprocess

from flask import Blueprint, request, session

from auth import login_required
from db import query, execute, get_conn, get_db_config, update_db_config, PRESETS
from helpers import json_response

import mysql.connector

data_bp = Blueprint('data', __name__)


# ---------------------------------------------------------------------------
# Version info (cached at import time)
# ---------------------------------------------------------------------------

def _load_version_info() -> dict:
    """
    Load version info. Priority:
    1. VERSION file (written by CI at deploy time)
    2. Live git info (local dev)
    3. Fallback unknown
    """
    version_file = os.path.join(os.path.dirname(__file__), 'VERSION')
    if os.path.exists(version_file):
        try:
            with open(version_file) as f:
                return json.loads(f.read().strip())
        except Exception:
            pass

    try:
        sha = subprocess.check_output(
            ['git', 'rev-parse', '--short', 'HEAD'],
            stderr=subprocess.DEVNULL, cwd=os.path.dirname(__file__),
        ).decode().strip()
        ts = subprocess.check_output(
            ['git', 'log', '-1', '--format=%cI'],
            stderr=subprocess.DEVNULL, cwd=os.path.dirname(__file__),
        ).decode().strip()
        return {'commit': sha, 'deployed_at': ts, 'source': 'git'}
    except Exception:
        pass

    return {'commit': 'unknown', 'deployed_at': None}


_VERSION_INFO = _load_version_info()


@data_bp.route('/api/version')
def api_version():
    """Return app version (commit SHA + deploy timestamp). No auth required."""
    return json_response({'ok': True, **_VERSION_INFO})


# ---------------------------------------------------------------------------
# Database connection settings
# ---------------------------------------------------------------------------

@data_bp.route('/api/connection/config')
@login_required
def api_connection_config():
    """Get current database connection config (redacted password)."""
    cfg = get_db_config()
    cfg['password'] = '••••' if cfg['password'] else ''
    return json_response({'ok': True, 'config': cfg})


@data_bp.route('/api/connection/presets')
@login_required
def api_connection_presets():
    """Get available connection presets."""
    presets_info = {}
    for name, cfg in PRESETS.items():
        presets_info[name] = {
            'host': cfg['host'],
            'user': cfg['user'],
            'database': cfg['database'],
            'password': '••••' if cfg['password'] else '(from env)',
        }
    return json_response({'ok': True, 'presets': presets_info})


@data_bp.route('/api/connection/set', methods=['POST'])
@login_required
def api_connection_set():
    """Update database connection config."""
    data = request.json or {}

    if 'preset' in data:
        preset_name = data['preset']
        if preset_name not in PRESETS:
            return json_response({'ok': False, 'error': f'Unknown preset: {preset_name}'}, 400)
        new_config = PRESETS[preset_name].copy()
    else:
        new_config = {
            'host': data.get('host', 'localhost'),
            'user': data.get('user', 'root'),
            'password': data.get('password', ''),
            'database': data.get('database', 'mmrdb'),
            'ssl_disabled': data.get('ssl_disabled', False),
        }

    # Test the connection
    try:
        test_conn = mysql.connector.connect(
            host=new_config['host'],
            user=new_config['user'],
            password=new_config['password'],
            database=new_config['database'],
            ssl_disabled=new_config['ssl_disabled'],
            charset='utf8mb4',
            collation='utf8mb4_unicode_ci',
        )
        test_conn.close()
    except Exception as e:
        return json_response({
            'ok': False,
            'error': f'Connection failed: {str(e)[:200]}'
        }, 400)

    update_db_config(new_config)

    return json_response({
        'ok': True,
        'message': f'Connected to {new_config["host"]}/{new_config["database"]}'
    })


# ---------------------------------------------------------------------------
# Processing log
# ---------------------------------------------------------------------------

@data_bp.route('/api/log')
@login_required
def api_log():
    """Recent processing log entries."""
    limit = request.args.get('limit', 50, type=int)
    rows = query("""
        SELECT pl.*, e.event_code, e.event_name
        FROM nyrr_processing_log pl
        LEFT JOIN nyrr_events e ON e.id = pl.nyrr_event_id
        ORDER BY pl.run_timestamp DESC
        LIMIT %s
    """, [limit])
    return json_response({'ok': True, 'data': rows})


# ---------------------------------------------------------------------------
# Generic table browser
# ---------------------------------------------------------------------------

def _load_table_groups() -> dict:
    """Load table_groups.json from same directory as this file."""
    path = os.path.join(os.path.dirname(__file__), 'table_groups.json')
    try:
        with open(path) as f:
            return json.load(f)
    except Exception:
        return {}


@data_bp.route('/api/tables')
@login_required
def api_tables():
    """List all tables in the database, annotated with group membership."""
    rows = query("""
        SELECT TABLE_NAME, TABLE_ROWS, DATA_LENGTH, CREATE_TIME, UPDATE_TIME
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
        ORDER BY TABLE_NAME
    """)

    groups = _load_table_groups()
    # Build reverse lookup: table_name -> group
    table_to_group = {
        tbl: grp
        for grp, tables in groups.items()
        for tbl in tables
    }

    for row in rows:
        row['group'] = table_to_group.get(row['TABLE_NAME'], 'Ungrouped')

    return json_response({'ok': True, 'data': rows, 'groups': groups})


@data_bp.route('/api/tables/<table_name>')
@login_required
def api_table_data(table_name):
    """Browse any table with pagination."""
    # Whitelist table names to prevent SQL injection
    allowed = query("""
        SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_SCHEMA = DATABASE()
    """)
    allowed_names = {r['TABLE_NAME'] for r in allowed}
    if table_name not in allowed_names:
        return json_response({'ok': False, 'error': 'Invalid table'}, 400)

    page = request.args.get('page', 1, type=int)
    per_page = request.args.get('per_page', 50, type=int)
    per_page = min(per_page, 500)
    offset = (page - 1) * per_page
    sort = request.args.get('sort', '')
    order = 'DESC' if request.args.get('order', 'asc').lower() == 'desc' else 'ASC'

    # Get columns for this table
    cols = query("""
        SELECT COLUMN_NAME, DATA_TYPE, COLUMN_KEY
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = %s
        ORDER BY ORDINAL_POSITION
    """, [table_name])
    col_names = [c['COLUMN_NAME'] for c in cols]

    # Build server-side column filters
    where_clauses = []
    where_params = []
    for col in col_names:
        fval = request.args.get(f'filter[{col}]', '').strip()
        if fval:
            where_clauses.append(f"CAST(`{col}` AS CHAR) LIKE %s")
            where_params.append(f'%{fval}%')

    where_sql = ""
    if where_clauses:
        where_sql = " WHERE " + " AND ".join(where_clauses)

    # Validate sort column
    order_clause = ""
    if sort and sort in col_names:
        order_clause = f" ORDER BY `{sort}` {order}"
    elif 'id' in col_names:
        order_clause = f" ORDER BY `id` DESC"

    # Count (with filters applied)
    count_rows = query(
        f"SELECT COUNT(*) AS cnt FROM `{table_name}`{where_sql}",
        where_params,
    )
    total = count_rows[0]['cnt'] if count_rows else 0

    # Fetch page (with filters applied)
    rows = query(
        f"SELECT * FROM `{table_name}`{where_sql}{order_clause} LIMIT %s OFFSET %s",
        where_params + [per_page, offset],
    )

    return json_response({
        'ok': True,
        'table': table_name,
        'columns': cols,
        'data': rows,
        'pagination': {
            'page': page,
            'per_page': per_page,
            'total': total,
            'pages': max(1, (total + per_page - 1) // per_page),
        },
    })


# ---------------------------------------------------------------------------
# User settings (per-user column visibility)
# ---------------------------------------------------------------------------

@data_bp.route('/api/user-settings/<table_name>', methods=['GET'])
@login_required
def api_get_user_settings(table_name):
    """Get user's saved column visibility for a table."""
    user = session.get('user', {})
    email = user.get('email', '')
    if not email:
        return json_response({'ok': True, 'visible_columns': None})

    try:
        rows = query(
            "SELECT visible_columns FROM viewer_user_settings WHERE email = %s AND table_name = %s",
            [email, table_name],
        )
        if rows and rows[0]['visible_columns']:
            cols = rows[0]['visible_columns']
            if isinstance(cols, str):
                cols = json.loads(cols)
            return json_response({'ok': True, 'visible_columns': cols})
    except Exception as e:
        print(f'Warning: Could not load user settings: {e}')

    return json_response({'ok': True, 'visible_columns': None})


@data_bp.route('/api/user-settings/<table_name>', methods=['PUT'])
@login_required
def api_save_user_settings(table_name):
    """Save user's column visibility for a table."""
    user = session.get('user', {})
    email = user.get('email', '')
    if not email:
        return json_response({'ok': False, 'error': 'Not authenticated'}, 401)

    data = request.json or {}
    visible_columns = data.get('visible_columns', [])

    try:
        execute(
            """INSERT INTO viewer_user_settings (email, table_name, visible_columns)
               VALUES (%s, %s, %s)
               ON DUPLICATE KEY UPDATE visible_columns = VALUES(visible_columns), updated_at = NOW()""",
            [email, table_name, json.dumps(visible_columns)],
        )
        return json_response({'ok': True})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)}, 500)
