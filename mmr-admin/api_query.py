"""
Data Query tab for mmr-admin.

Allows authenticated admins to run SQL queries directly.
- Super-admins: full SQL access (SELECT, INSERT, UPDATE, DELETE)
- Regular admins: SELECT-only (read-only)

Blueprint: query_bp
Prefix: /api/query
"""

from flask import Blueprint, request, session, render_template
from auth import login_required, require_role
from db import query, execute
from helpers import json_response

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
    return sql.strip().upper().startswith('SELECT')


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
        return json_response({
            'ok': False,
            'error': 'Only SELECT queries allowed for your role. Contact admin@mmrunners.org for data modifications.',
            'sql_snippet': sql[:100],
        }, 403)

    try:
        # Detect query type
        is_select = _is_select_query(sql)

        if is_select:
            # SELECT: use query() → returns list of dicts
            rows = query(sql)
            columns = list(rows[0].keys()) if rows else []
            return json_response({
                'ok': True,
                'rows': rows,
                'count': len(rows),
                'columns': columns,
            })
        else:
            # INSERT/UPDATE/DELETE: use execute() → returns affected row count
            affected = execute(sql)
            return json_response({
                'ok': True,
                'affected': affected,
                'message': f'{affected} row(s) affected',
            })

    except Exception as e:
        error_msg = str(e)[:500]
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
