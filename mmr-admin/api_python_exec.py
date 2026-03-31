"""
Python Execution Engine for MMR Admin Portal

Provides a safe, sandboxed way to execute diagnostic Python functions
in Azure for debugging data sync and import issues.

Functions can be registered and executed via REST API.
"""

from __future__ import annotations

import json
import traceback
from datetime import datetime
from flask import Blueprint, request, jsonify
from auth import login_required
import db as dbmod

py_exec_bp = Blueprint('py_exec', __name__, url_prefix='/api/py-exec')

# ─────────────────────────────────────────────────────────────────────────────
# Function Registry
# ─────────────────────────────────────────────────────────────────────────────

def get_sheet_vs_db_counts():
    """Compare row counts: Google Sheets transactions vs MySQL."""
    try:
        conn = dbmod.get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("SELECT COUNT(*) as cnt FROM transactions")
        db_count = cursor.fetchone()['cnt']

        cursor.execute("SELECT COUNT(*) as cnt FROM transactions WHERE deleted_at IS NULL")
        db_active = cursor.fetchone()['cnt']

        cursor.execute("SELECT COUNT(*) as cnt FROM sync_log WHERE action = 'sheet_fetch' ORDER BY created_at DESC LIMIT 1")
        last_fetch = cursor.fetchone()

        cursor.close()
        conn.close()

        return {
            'status': 'ok',
            'db_total_rows': db_count,
            'db_active_rows': db_active,
            'last_fetch_log': last_fetch,
            'note': 'To get Google Sheets count, check the last sync log entry for "raw_row_count"'
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }


def get_sync_status():
    """Get status of the last 5 sync operations."""
    try:
        conn = dbmod.get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                id, action, status, inserted, updated, errors,
                raw_row_count, started_at, completed_at,
                error_message
            FROM sync_log
            ORDER BY created_at DESC
            LIMIT 5
        """)
        logs = cursor.fetchall()

        cursor.close()
        conn.close()

        return {
            'status': 'ok',
            'recent_syncs': logs,
            'count': len(logs)
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }


def check_transaction_dups():
    """Check for duplicate transactions (same bib_id, same date)."""
    try:
        conn = dbmod.get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                bib_id, transaction_date,
                COUNT(*) as count,
                GROUP_CONCAT(id) as ids
            FROM transactions
            WHERE deleted_at IS NULL
            GROUP BY bib_id, transaction_date
            HAVING count > 1
            ORDER BY count DESC
            LIMIT 20
        """)
        dups = cursor.fetchall()

        cursor.close()
        conn.close()

        return {
            'status': 'ok',
            'duplicate_groups': dups,
            'count': len(dups),
            'note': 'Each row shows a group of duplicates by bib_id + date'
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }


def check_transaction_nulls():
    """Find transactions with critical NULL values."""
    try:
        conn = dbmod.get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                'NULL bib_id' as issue, COUNT(*) as count
            FROM transactions
            WHERE deleted_at IS NULL AND bib_id IS NULL
            UNION ALL
            SELECT
                'NULL transaction_date' as issue, COUNT(*) as count
            FROM transactions
            WHERE deleted_at IS NULL AND transaction_date IS NULL
            UNION ALL
            SELECT
                'NULL amount' as issue, COUNT(*) as count
            FROM transactions
            WHERE deleted_at IS NULL AND amount IS NULL
        """)
        issues = cursor.fetchall()

        cursor.close()
        conn.close()

        return {
            'status': 'ok',
            'null_issues': issues,
            'total_issues': sum(i['count'] for i in issues)
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }


def get_sample_transactions(limit=10):
    """Fetch sample transaction rows for manual inspection."""
    try:
        conn = dbmod.get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("""
            SELECT
                id, bib_id, transaction_date, amount,
                notes, created_at, updated_at
            FROM transactions
            WHERE deleted_at IS NULL
            ORDER BY created_at DESC
            LIMIT %s
        """, (limit,))
        samples = cursor.fetchall()

        cursor.close()
        conn.close()

        return {
            'status': 'ok',
            'samples': samples,
            'count': len(samples)
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }


def test_db_connection():
    """Test database connectivity and return basic stats."""
    try:
        conn = dbmod.get_db_connection()
        cursor = conn.cursor(dictionary=True)

        cursor.execute("SELECT DATABASE() as db_name")
        db_info = cursor.fetchone()

        cursor.execute("""
            SELECT
                table_name,
                (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = t.table_name) as col_count
            FROM information_schema.TABLES t
            WHERE TABLE_SCHEMA = DATABASE()
        """)
        tables = cursor.fetchall()

        cursor.close()
        conn.close()

        return {
            'status': 'ok',
            'connected': True,
            'database': db_info['db_name'],
            'tables': tables,
            'timestamp': datetime.utcnow().isoformat()
        }
    except Exception as e:
        return {
            'status': 'error',
            'connected': False,
            'error': str(e),
            'traceback': traceback.format_exc()
        }


# Function registry: maps function name to callable
FUNCTIONS = {
    'get_sheet_vs_db_counts': get_sheet_vs_db_counts,
    'get_sync_status': get_sync_status,
    'check_transaction_dups': check_transaction_dups,
    'check_transaction_nulls': check_transaction_nulls,
    'get_sample_transactions': get_sample_transactions,
    'test_db_connection': test_db_connection,
}

# ─────────────────────────────────────────────────────────────────────────────
# API Routes
# ─────────────────────────────────────────────────────────────────────────────

@py_exec_bp.route('/list', methods=['GET'])
@login_required
def list_functions():
    """Return list of available diagnostic functions."""
    functions = []
    for name, func in FUNCTIONS.items():
        functions.append({
            'name': name,
            'description': (func.__doc__ or '').strip()
        })
    return jsonify({'functions': functions})


@py_exec_bp.route('/run/<fn_name>', methods=['POST'])
@login_required
def run_function(fn_name):
    """Execute a diagnostic function and return results."""
    if fn_name not in FUNCTIONS:
        return jsonify({
            'error': f'Function "{fn_name}" not found',
            'available': list(FUNCTIONS.keys())
        }), 404

    try:
        func = FUNCTIONS[fn_name]

        # Get any kwargs from request body
        data = request.get_json() or {}
        kwargs = data.get('kwargs', {})

        # Execute function
        result = func(**kwargs)

        # Ensure result is JSON-serializable
        result['executed_at'] = datetime.utcnow().isoformat()
        result['function'] = fn_name

        return jsonify(result)

    except Exception as e:
        return jsonify({
            'status': 'error',
            'function': fn_name,
            'error': str(e),
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat()
        }), 500


@py_exec_bp.route('/health', methods=['GET'])
@login_required
def health_check():
    """Quick health check: DB connection + function count."""
    try:
        conn = dbmod.get_db_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        cursor.close()
        conn.close()

        return jsonify({
            'status': 'healthy',
            'db_connected': True,
            'function_count': len(FUNCTIONS),
            'timestamp': datetime.utcnow().isoformat()
        })
    except Exception as e:
        return jsonify({
            'status': 'error',
            'db_connected': False,
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }), 500
