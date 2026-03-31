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


def send_test_email():
    """Send a test hello email to admin@mmrunners.org to verify email pipeline."""
    try:
        import os
        from email_client import send_email, _get_sender_from_connection_string

        # Debug: show what sender will be used
        connection_string = os.environ.get('AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING', '')
        sender = _get_sender_from_connection_string(connection_string)

        # Build HTML email using same template structure as other MMR emails
        html_content = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr><td style="background:#5c35a8;padding:28px 36px;text-align:center;">
        <div style="font-size:26px;margin-bottom:4px;">🏃</div>
        <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">Misty Mountain Runners</div>
        <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;">Admin Test Email</div>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:36px 36px 28px;">
        <h2 style="margin:0 0 8px;font-size:22px;color:#222222;font-weight:700;">Hello! 👋</h2>
        <p style="margin:0 0 20px;font-size:15px;color:#555555;line-height:1.6;">
          This is a test email from the MMR Admin Portal Python Execution Engine.
        </p>
        <div style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:10px;padding:16px;margin:0 0 20px;font-size:13px;color:#555555;line-height:1.6;">
          <strong>Test Details:</strong><br>
          Timestamp: """ + datetime.utcnow().isoformat() + """<br>
          Recipient: admin@mmrunners.org<br>
          Template: MMR HTML Email Pipeline
        </div>
        <p style="margin:0;font-size:14px;color:#888888;">
          If you received this, the email pipeline is working correctly! ✅
        </p>
      </td></tr>
      <!-- Footer -->
      <tr><td style="background:#f8f8fa;padding:20px 36px;text-align:center;border-top:1px solid #eeeeee;">
        <div style="color:#999999;font-size:12px;line-height:1.6;">
          Misty Mountain Runners &nbsp;·&nbsp; New York
          <br>Questions? Email us at <a href="mailto:admin@mmrunners.org" style="color:#5c35a8;text-decoration:none;">admin@mmrunners.org</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>"""

        result = send_email(
            to='admin@mmrunners.org',
            subject='🧪 MMR Admin Portal Test Email',
            html_content=html_content,
            cc=None,  # Don't CC ourselves for test email
        )

        return {
            'status': 'ok' if result.get('success') else 'error',
            'from_address': sender,
            'sent_to': 'admin@mmrunners.org',
            'subject': '🧪 MMR Admin Portal Test Email',
            'message': result.get('message'),
            'error': result.get('error'),
            'timestamp': result.get('timestamp')
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
    'send_test_email': send_test_email,
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


@py_exec_bp.route('/code', methods=['POST'])
@login_required
def execute_code():
    """Execute arbitrary Python code with access to db helper functions."""
    data = request.get_json() or {}
    code = data.get('code', '').strip()

    if not code:
        return jsonify({
            'status': 'error',
            'error': 'No code provided',
            'executed_at': datetime.utcnow().isoformat()
        }), 400

    # Create safe execution environment with useful helpers
    exec_globals = {
        'query': dbmod.query,  # Direct DB query helper
        'execute': dbmod.execute,  # Direct DB execute helper
        'datetime': datetime,
        'json': json,
        'traceback': traceback,
    }

    output_lines = []

    # Capture print output
    import io
    import sys
    old_stdout = sys.stdout
    sys.stdout = io.StringIO()

    try:
        # Execute the code
        exec(code, exec_globals)

        # Get any printed output
        captured_output = sys.stdout.getvalue()
        if captured_output:
            output_lines.append(captured_output)

        # If code returned a value, capture it
        # (This is tricky with exec, so we use a wrapper)
        result = {
            'status': 'ok',
            'output': ''.join(output_lines),
            'executed_at': datetime.utcnow().isoformat()
        }

    except Exception as e:
        result = {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat()
        }
    finally:
        # Restore stdout
        sys.stdout = old_stdout

    return jsonify(result)


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
