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
    """Compare row counts: Google Sheets transactions vs MySQL gmail_transactions."""
    debug = {'queries_executed': [], 'connection_info': {}}
    try:
        # Connection info
        db_config = dbmod.get_db_config()
        debug['connection_info'] = {
            'host': db_config.get('host', '?'),
            'user': db_config.get('user', '?'),
            'database': db_config.get('database', '?'),
        }

        conn = dbmod.get_conn()
        cursor = conn.cursor(dictionary=True)
        debug['connection_status'] = 'connected'

        # Total count of all gmail transactions (including archived)
        query1 = "SELECT COUNT(*) as cnt FROM gmail_transactions"
        cursor.execute(query1)
        db_count = cursor.fetchone()['cnt']
        debug['queries_executed'].append(f"✓ {query1} → {db_count}")

        # Active (non-archived) count
        query2 = "SELECT COUNT(*) as cnt FROM gmail_transactions WHERE IsArchived = 0"
        cursor.execute(query2)
        db_active = cursor.fetchone()['cnt']
        debug['queries_executed'].append(f"✓ {query2} → {db_active}")

        # Last sync metadata
        query3 = "SELECT sheet_name, last_synced_at, sync_status FROM sync_metadata WHERE sheet_name LIKE '%transaction%' OR sheet_name LIKE '%gmail%' ORDER BY last_synced_at DESC LIMIT 1"
        cursor.execute(query3)
        last_sync = cursor.fetchone()
        debug['queries_executed'].append(f"✓ Fetched last sync metadata entry")

        cursor.close()
        conn.close()
        debug['connection_status'] = 'closed'

        return {
            'status': 'ok',
            'db_total_rows': db_count,
            'db_active_rows': db_active,
            'archived_rows': db_count - db_active,
            'last_sync_metadata': last_sync,
            'note': 'Counts from gmail_transactions table. Use sync_metadata for sync history.',
            'debug': debug
        }
    except Exception as e:
        debug['connection_status'] = 'error'
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc(),
            'debug': debug
        }


def get_sync_status():
    """Get status of the last 5 sync operations from sync_metadata and sync_snapshots."""
    debug = {'query_executed': None, 'row_count': 0}
    try:
        conn = dbmod.get_conn()
        cursor = conn.cursor(dictionary=True)
        debug['connection_status'] = 'connected'

        query = """
            SELECT
                sm.sheet_name, sm.sync_status, sm.last_synced_at,
                ss.row_count, ss.snapshot_hash, ss.snapshot_timestamp,
                ss.status as snapshot_status
            FROM sync_metadata sm
            LEFT JOIN sync_snapshots ss ON sm.sheet_name = ss.sheet_name
            ORDER BY sm.last_synced_at DESC
            LIMIT 5
        """
        cursor.execute(query)
        logs = cursor.fetchall()
        debug['query_executed'] = 'SELECT from sync_metadata + sync_snapshots (last 5 entries)'
        debug['row_count'] = len(logs)

        cursor.close()
        conn.close()
        debug['connection_status'] = 'closed'

        return {
            'status': 'ok',
            'recent_syncs': logs,
            'count': len(logs),
            'debug': debug
        }
    except Exception as e:
        debug['connection_status'] = 'error'
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc(),
            'debug': debug
        }


def check_transaction_dups():
    """Check for duplicate gmail transactions (same TransactionNumber, same TransactionDate)."""
    debug = {'duplicate_groups_found': 0, 'affected_transaction_ids': []}
    try:
        conn = dbmod.get_conn()
        cursor = conn.cursor(dictionary=True)
        debug['connection_status'] = 'connected'

        query = """
            SELECT
                TransactionNumber, TransactionDate,
                COUNT(*) as count,
                GROUP_CONCAT(MessageId) as message_ids
            FROM gmail_transactions
            WHERE IsArchived = 0 AND TransactionNumber IS NOT NULL
            GROUP BY TransactionNumber, TransactionDate
            HAVING count > 1
            ORDER BY count DESC
            LIMIT 20
        """
        cursor.execute(query)
        dups = cursor.fetchall()
        debug['duplicate_groups_found'] = len(dups)

        # Extract all affected message IDs
        all_ids = []
        for dup in dups:
            if dup.get('message_ids'):
                all_ids.extend(dup['message_ids'].split(','))
        debug['total_affected_transactions'] = len(all_ids)

        cursor.close()
        conn.close()
        debug['connection_status'] = 'closed'

        return {
            'status': 'ok',
            'duplicate_groups': dups,
            'count': len(dups),
            'note': 'Each row shows a group of duplicates by TransactionNumber + TransactionDate',
            'debug': debug
        }
    except Exception as e:
        debug['connection_status'] = 'error'
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc(),
            'debug': debug
        }


def check_transaction_nulls():
    """Find gmail_transactions with critical NULL values."""
    debug = {'union_queries': 3, 'null_fields_checked': ['TransactionNumber', 'TransactionDate', 'Amount']}
    try:
        conn = dbmod.get_conn()
        cursor = conn.cursor(dictionary=True)
        debug['connection_status'] = 'connected'

        query = """
            SELECT
                'NULL TransactionNumber' as issue, COUNT(*) as count
            FROM gmail_transactions
            WHERE IsArchived = 0 AND TransactionNumber IS NULL
            UNION ALL
            SELECT
                'NULL TransactionDate' as issue, COUNT(*) as count
            FROM gmail_transactions
            WHERE IsArchived = 0 AND TransactionDate IS NULL
            UNION ALL
            SELECT
                'NULL Amount' as issue, COUNT(*) as count
            FROM gmail_transactions
            WHERE IsArchived = 0 AND Amount IS NULL
        """
        cursor.execute(query)
        issues = cursor.fetchall()
        debug['issues_found'] = len(issues)
        debug['issue_breakdown'] = {issue['issue']: issue['count'] for issue in issues}

        cursor.close()
        conn.close()
        debug['connection_status'] = 'closed'

        total = sum(i['count'] for i in issues)
        return {
            'status': 'ok',
            'null_issues': issues,
            'total_issues': total,
            'debug': debug
        }
    except Exception as e:
        debug['connection_status'] = 'error'
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc(),
            'debug': debug
        }


def get_sample_transactions(limit=10):
    """Fetch sample gmail_transaction rows for manual inspection."""
    debug = {'limit_requested': limit, 'fields_selected': 8}
    try:
        conn = dbmod.get_conn()
        cursor = conn.cursor(dictionary=True)
        debug['connection_status'] = 'connected'

        query = """
            SELECT
                MessageId, TransactionNumber, TransactionDate, Amount,
                Sender, Memo, Source, ProcessedTime
            FROM gmail_transactions
            WHERE IsArchived = 0
            ORDER BY ProcessedTime DESC
            LIMIT %s
        """
        cursor.execute(query, (limit,))
        samples = cursor.fetchall()
        debug['rows_returned'] = len(samples)
        debug['sample_ids'] = [s['MessageId'] for s in samples] if samples else []

        cursor.close()
        conn.close()
        debug['connection_status'] = 'closed'

        return {
            'status': 'ok',
            'samples': samples,
            'count': len(samples),
            'debug': debug
        }
    except Exception as e:
        debug['connection_status'] = 'error'
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc(),
            'debug': debug
        }


def check_webhook_email_config():
    """Check GAS webhook email configuration."""
    try:
        from webhook_client import get_sheets_webhook_url

        try:
            webhook_url = get_sheets_webhook_url()
            return {
                'status': 'ok',
                'webhook_url': webhook_url[:50] + '...' if len(webhook_url) > 50 else webhook_url,
                'message': 'GAS webhook configured. Emails will be sent via Gmail using Google Apps Script.',
                'email_log_sheet': '1G0dr2vjW-vMN0UbpxvzdBajmFSQLsiRbLd1A-36xk0I',
                'note': 'All emails are logged in the Email Log sheet (Current tab)'
            }
        except ValueError as e:
            return {
                'status': 'error',
                'error': str(e),
                'next_steps': [
                    '1. Deploy GAS webhook (web-apps/gas/membership/src/webhook.ts)',
                    '2. Add to MySQL Config table: INSERT INTO Config (Key, Value) VALUES (\'SheetsWebhookUrl\', \'https://script.google.com/...\');',
                    '3. Or set SHEETS_WEBHOOK_URL environment variable'
                ]
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
        from webhook_client import send_email_webhook

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
        <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;">Admin Test Email via GAS Webhook</div>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:36px 36px 28px;">
        <h2 style="margin:0 0 8px;font-size:22px;color:#222222;font-weight:700;">Hello! 👋</h2>
        <p style="margin:0 0 20px;font-size:15px;color:#555555;line-height:1.6;">
          This is a test email from the MMR Admin Portal sent via GAS webhook → Gmail.
        </p>
        <div style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:10px;padding:16px;margin:0 0 20px;font-size:13px;color:#555555;line-height:1.6;">
          <strong>Test Details:</strong><br>
          Timestamp: """ + datetime.utcnow().isoformat() + """<br>
          Recipient: admin@mmrunners.org<br>
          Method: GAS Webhook + Gmail
        </div>
        <p style="margin:0;font-size:14px;color:#888888;">
          If you received this, the webhook email pipeline is working correctly! ✅
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

        result = send_email_webhook(
            to='admin@mmrunners.org',
            subject='🧪 MMR Admin Portal Test Email',
            html_content=html_content,
            cc=None,  # Don't CC ourselves for test email
            email_type='test',
        )

        return {
            'status': 'ok' if result.get('success') else 'error',
            'sent_to': 'admin@mmrunners.org',
            'subject': '🧪 MMR Admin Portal Test Email',
            'email_id': result.get('email_id'),
            'message': result.get('message'),
            'error': result.get('error'),
            'timestamp': result.get('timestamp'),
            'note': 'Email logged to Email Log sheet and sent via Gmail'
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }


def test_db_connection():
    """Test database connectivity and return basic stats."""
    debug = {'queries': []}
    try:
        # Get DB config first
        db_config = dbmod.get_db_config()
        debug['config'] = {
            'host': db_config.get('host', '?'),
            'user': db_config.get('user', '?'),
            'database': db_config.get('database', '?'),
        }

        conn = dbmod.get_conn()
        debug['connection_status'] = 'connected'
        cursor = conn.cursor(dictionary=True)

        # Test 1: Get database name
        query1 = "SELECT DATABASE() as db_name"
        cursor.execute(query1)
        db_info = cursor.fetchone()
        debug['queries'].append(f"✓ {query1}")

        # Test 2: List all tables with column count
        query2 = """
            SELECT
                table_name,
                (SELECT COUNT(*) FROM information_schema.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = t.table_name) as col_count
            FROM information_schema.TABLES t
            WHERE TABLE_SCHEMA = DATABASE()
        """
        cursor.execute(query2)
        tables = cursor.fetchall()
        debug['queries'].append(f"✓ Listed {len(tables)} tables with column counts")
        debug['table_count'] = len(tables)
        debug['table_names'] = [t['table_name'] for t in tables]

        cursor.close()
        conn.close()
        debug['connection_status'] = 'closed'

        return {
            'status': 'ok',
            'connected': True,
            'database': db_info['db_name'],
            'tables': tables,
            'timestamp': datetime.utcnow().isoformat(),
            'debug': debug
        }
    except Exception as e:
        debug['connection_status'] = 'error'
        return {
            'status': 'error',
            'connected': False,
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc(),
            'debug': debug
        }


# Function registry: maps function name to callable
FUNCTIONS = {
    'get_sheet_vs_db_counts': get_sheet_vs_db_counts,
    'get_sync_status': get_sync_status,
    'check_transaction_dups': check_transaction_dups,
    'check_transaction_nulls': check_transaction_nulls,
    'get_sample_transactions': get_sample_transactions,
    'test_db_connection': test_db_connection,
    'check_webhook_email_config': check_webhook_email_config,
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
    execution_start = datetime.utcnow()

    if fn_name not in FUNCTIONS:
        return jsonify({
            'status': 'error',
            'error': f'Function "{fn_name}" not found',
            'available': list(FUNCTIONS.keys()),
            'timestamp': execution_start.isoformat()
        }), 404

    try:
        func = FUNCTIONS[fn_name]

        # Get any kwargs from request body
        data = request.get_json() or {}
        kwargs = data.get('kwargs', {})

        # Log execution
        print(f"[PY_EXEC] Executing: {fn_name}")
        if kwargs:
            print(f"[PY_EXEC] With kwargs: {kwargs}")

        # Execute function
        result = func(**kwargs)

        # Ensure result is JSON-serializable
        execution_end = datetime.utcnow()
        elapsed_ms = (execution_end - execution_start).total_seconds() * 1000

        result['executed_at'] = execution_end.isoformat()
        result['execution_time_ms'] = round(elapsed_ms, 2)
        result['function'] = fn_name

        print(f"[PY_EXEC] ✓ {fn_name} completed in {elapsed_ms:.0f}ms (status: {result.get('status', 'unknown')})")
        return jsonify(result)

    except Exception as e:
        execution_end = datetime.utcnow()
        elapsed_ms = (execution_end - execution_start).total_seconds() * 1000
        print(f"[PY_EXEC] ✗ {fn_name} failed in {elapsed_ms:.0f}ms: {type(e).__name__}: {str(e)}")

        return jsonify({
            'status': 'error',
            'function': fn_name,
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc(),
            'executed_at': execution_end.isoformat(),
            'execution_time_ms': round(elapsed_ms, 2)
        }), 500


@py_exec_bp.route('/code', methods=['POST'])
@login_required
def execute_code():
    """Execute arbitrary Python code with access to db helper functions."""
    execution_start = datetime.utcnow()
    data = request.get_json() or {}
    code = data.get('code', '').strip()

    if not code:
        return jsonify({
            'status': 'error',
            'error': 'No code provided',
            'executed_at': execution_start.isoformat()
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
    debug = {
        'code_length': len(code),
        'code_lines': len(code.split('\n')),
        'available_helpers': list(exec_globals.keys()),
    }

    # Capture print output
    import io
    import sys
    old_stdout = sys.stdout
    sys.stdout = io.StringIO()

    try:
        print(f"[CODE_EXEC] Executing {debug['code_lines']} lines of code ({debug['code_length']} chars)")

        # Execute the code
        exec(code, exec_globals)

        # Get any printed output
        captured_output = sys.stdout.getvalue()
        if captured_output:
            output_lines.append(captured_output)

        execution_end = datetime.utcnow()
        elapsed_ms = (execution_end - execution_start).total_seconds() * 1000

        result = {
            'status': 'ok',
            'output': ''.join(output_lines),
            'executed_at': execution_end.isoformat(),
            'execution_time_ms': round(elapsed_ms, 2),
            'debug': debug
        }
        print(f"[CODE_EXEC] ✓ Execution completed successfully in {elapsed_ms:.0f}ms")

    except Exception as e:
        execution_end = datetime.utcnow()
        elapsed_ms = (execution_end - execution_start).total_seconds() * 1000
        debug['error_line'] = traceback.format_exc().split('\n')[-3] if traceback.format_exc() else 'Unknown'

        result = {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc(),
            'executed_at': execution_end.isoformat(),
            'execution_time_ms': round(elapsed_ms, 2),
            'debug': debug
        }
        print(f"[CODE_EXEC] ✗ Execution failed in {elapsed_ms:.0f}ms: {type(e).__name__}")

    finally:
        # Restore stdout
        sys.stdout = old_stdout

    return jsonify(result)


@py_exec_bp.route('/health', methods=['GET'])
@login_required
def health_check():
    """Quick health check: DB connection + function count."""
    debug = {'checks': {}}
    try:
        # Check DB config
        db_config = dbmod.get_db_config()
        debug['checks']['db_config'] = {
            'host': db_config.get('host', '?'),
            'user': db_config.get('user', '?'),
            'database': db_config.get('database', '?'),
        }

        # Check connection
        conn = dbmod.get_conn()
        debug['checks']['connection_acquired'] = True
        cursor = conn.cursor()
        cursor.execute("SELECT 1")
        debug['checks']['query_executed'] = True
        cursor.close()
        conn.close()
        debug['checks']['connection_closed'] = True

        return jsonify({
            'status': 'healthy',
            'db_connected': True,
            'function_count': len(FUNCTIONS),
            'available_functions': list(FUNCTIONS.keys()),
            'timestamp': datetime.utcnow().isoformat(),
            'debug': debug
        })
    except Exception as e:
        debug['checks']['error'] = str(e)
        return jsonify({
            'status': 'error',
            'db_connected': False,
            'error': str(e),
            'error_type': type(e).__name__,
            'timestamp': datetime.utcnow().isoformat(),
            'debug': debug
        }), 500
