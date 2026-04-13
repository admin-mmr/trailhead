"""
Data Query tab for mmr-admin.

Allows authenticated admins to run SQL queries directly.
- Super-admins: full SQL access (SELECT, INSERT, UPDATE, DELETE)
- Regular admins: SELECT-only (read-only)

Blueprint: query_bp
Prefix: /api/query
"""

import logging
import uuid
from datetime import datetime
from flask import Blueprint, request, session, render_template
from auth import login_required, require_role
from db import query, execute, db_cursor
from helpers import json_response

logger = logging.getLogger(__name__)

query_bp = Blueprint('query', __name__)


def _is_super_admin(email: str) -> bool:
    """Check if user is a super-admin (hardcoded list)."""
    super_admins = [
        'admin@mmrunners.org',
        'cathy.lin@mmrunners.org',
    ]
    return email in super_admins


def _is_select_query(sql: str) -> bool:
    """Quick check: does the query start with SELECT (case-insensitive)?"""
    upper = sql.strip().upper()
    return upper.startswith('SELECT') or upper.startswith('CALL')


def _is_call_statement(sql: str) -> bool:
    """Check if SQL is a CALL to a stored procedure."""
    return sql.strip().upper().startswith('CALL')


def _log_api_error(error_msg: str, sql_snippet: str, user_email: str) -> None:
    """Log API/query errors to error_context table (best-effort, doesn't fail if logging fails)."""
    try:
        with db_cursor() as cur:
            error_id = str(uuid.uuid4())
            # Change this part in api_query.py (~line 65)
            query_sql = """
                INSERT INTO error_context (
                    ErrorContextID, ErrorCode, ErrorMessage, TechnicalMessage, 
                    TableName, ProblematicValue, Severity
                ) VALUES (%s, %s, %s, %s, %s, %s, %s)
            """
            # Ensure the values tuple matches these 7 columns
            cur.execute(query_sql, (
                error_id,
                'QUERY_ERROR', 
                error_msg[:255], 
                f'Query: {sql_snippet[:490]}', 
                'gmail_transactions', # or generic
                user_email, 
                'ERROR'
            ))
    except Exception as e:
        logger.warning(f'[QUERY] Failed to log error to error_context: {e}')


# ---------------------------------------------------------------------------
# Query Editor UI
# ---------------------------------------------------------------------------

@query_bp.route('/query', methods=['GET'])
@login_required
@require_role('admin')
def query_editor():
    """Render the Query Editor page."""
    user_email = session.get('user', {}).get('email', 'unknown')
    is_super_admin = _is_super_admin(user_email)
    return render_template(
        'query.html',
        is_super_admin=is_super_admin,
        user_email=user_email,
    )


# ---------------------------------------------------------------------------
# Execute Query API
# ---------------------------------------------------------------------------

@query_bp.route('/api/query/execute', methods=['POST'])
@login_required
@require_role('admin')
def api_execute_query():
    """
    Execute a SQL query.

    Body: { sql }

    Returns:
    - For SELECT: { ok: true, rows: [...], count: N, columns: [...] }
    - For INSERT/UPDATE/DELETE: { ok: true, affected: N }
    - For error: { ok: false, error: "...", sql_snippet: "..." }
    """
    data = request.json or {}
    sql = data.get('sql', '').strip()

    if not sql:
        return json_response({'ok': False, 'error': 'SQL query required'}, 400)

    user_email = session.get('user', {}).get('email', 'unknown')
    is_super_admin = _is_super_admin(user_email)

    # Enforce SELECT-only for non-super-admins
    if not is_super_admin and not _is_select_query(sql):
        # This line prints to the server's stdout/stderr which is captured by Azure logs
        logger.warning(f"[PERMISSION DENIED] User: {user_email} | Role: Admin | Action: Blocked {sql[:100]}")
        return json_response({
            'ok': False,
            'error': 'Only SELECT queries allowed for your role. Contact admin@mmrunners.org for data modifications.',
            'sql_snippet': sql[:100],
        }, 403)
    try:
        # Detect query type
        is_select = _is_select_query(sql)
        is_call = _is_call_statement(sql)
        query_type = 'CALL' if is_call else ('SELECT' if is_select else 'INSERT/UPDATE/DELETE')
        logger.info(f'[QUERY] Executing {query_type} from {user_email}')
        logger.debug(f'[QUERY] SQL: {sql[:200]}...')

        if is_call:
            # CALL stored procedure: use execute() so the transaction is committed.
            # Must be checked BEFORE is_select — _is_select_query() also matches CALL
            # (legacy behaviour), so is_call must take priority.
            # query() never commits; CALLs that write would be silently rolled back.
            affected = execute(sql)
            logger.info(f'[QUERY] CALL completed (affected={affected})')
            return json_response({
                'ok': True,
                'rows': [],
                'count': 0,
                'columns': [],
                'affected': affected,
                'message': 'Stored procedure executed successfully',
            })
        elif is_select:
            # Pure SELECT: use query() → returns list of dicts (read-only, no commit needed)
            rows = query(sql)
            columns = list(rows[0].keys()) if rows else []
            logger.info(f'[QUERY] SELECT returned {len(rows)} rows')
            return json_response({
                'ok': True,
                'rows': rows,
                'count': len(rows),
                'columns': columns,
            })
        else:
            # INSERT/UPDATE/DELETE: use execute() → returns affected row count
            affected = execute(sql)
            logger.info(f'[QUERY] Non-SELECT affected {affected} rows')
            return json_response({
                'ok': True,
                'affected': affected,
                'message': f'{affected} row(s) affected',
            })

    except Exception as e:
        error_msg = str(e)[:500]
        logger.exception(f'[QUERY] Exception executing {query_type} from {user_email}: {error_msg}')
        _log_api_error(error_msg, sql[:100], user_email)
        return json_response({
            'ok': False,
            'error': error_msg,
            'sql_snippet': sql[:100],
        }, 400)


# ---------------------------------------------------------------------------
# Config Info (helper to show current config)
# ---------------------------------------------------------------------------

@query_bp.route('/api/query/config', methods=['GET'])
@login_required
@require_role('admin')
def api_config_info():
    """Return current config table for quick reference."""
    try:
        rows = query("SELECT ConfigKey, ConfigValue FROM config LIMIT 50")
        return json_response({'ok': True, 'data': rows})
    except Exception as e:
        return json_response({'ok': False, 'error': str(e)}, 500)


# ---------------------------------------------------------------------------
# Diagnostics
# ---------------------------------------------------------------------------

@query_bp.route('/api/query/diag', methods=['GET'])
@login_required
def api_query_diagnostics():
    """Diagnostic endpoint to check database connection and configuration."""
    from db import get_db_config
    import os

    cfg = get_db_config()
    db_url = os.environ.get('DATABASE_URL', 'NOT SET')

    logger.info(f'[DIAG] Database URL: {db_url[:50]}...' if len(db_url) > 50 else f'[DIAG] Database URL: {db_url}')
    logger.info(f'[DIAG] DB Config: {cfg["user"]}@{cfg["host"]}/{cfg["database"]}')

    diag = {
        'ok': True,
        'database_url_set': bool(db_url and db_url != 'NOT SET'),
        'db_config': {
            'host': cfg.get('host'),
            'user': cfg.get('user'),
            'database': cfg.get('database'),
            'ssl_disabled': cfg.get('ssl_disabled'),
        },
        'test_connection': None,
        'test_error': None,
    }

    # Try to test the connection
    try:
        from db import query
        result = query("SELECT 1 as test")
        diag['test_connection'] = 'OK' if result else 'No result'
    except Exception as e:
        diag['test_error'] = str(e)[:200]
        diag['ok'] = False

    return json_response(diag)
