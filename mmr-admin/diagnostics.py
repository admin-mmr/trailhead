"""
Diagnostic Functions — Safe, sandboxed diagnostic helpers for debugging data sync.
Used by api_python_exec.py for function registry and execution.
"""

from __future__ import annotations

import traceback
from datetime import datetime

import db as dbmod
from api_email_diags import (
    get_gmail_transactions_recent,
    get_gas_webhook_config,
    get_email_send_status,
    analyze_email_flow,
)
from api_sheets_diags import (
    get_sheets_members,
    get_sheets_payments,
    get_sheets_events,
    get_sheets_transactions,
    update_sheets_members,
    update_sheets_payments,
    update_sheets_events,
    compare_sheets_vs_db,
)


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
    try:
        syncs = dbmod.query("""
            SELECT
              sheet_name, sync_status, last_synced_at, error_details,
              IF(sync_status = 'error', 'FAILED', 'OK') as status_summary
            FROM sync_metadata
            ORDER BY last_synced_at DESC
            LIMIT 5
        """)

        snapshots = dbmod.query("""
            SELECT snapshot_type, created_at, row_count, notes
            FROM sync_snapshots
            ORDER BY created_at DESC
            LIMIT 5
        """)

        return {
            'status': 'ok',
            'sync_metadata': syncs,
            'sync_snapshots': snapshots,
            'timestamp': datetime.utcnow().isoformat()
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }


def check_transaction_dups():
    """Check for duplicate gmail_transactions (same MessageId, different rows)."""
    try:
        dups = dbmod.query("""
            SELECT
              MessageId, COUNT(*) as dup_count, GROUP_CONCAT(MessageId SEPARATOR ',') as ids
            FROM gmail_transactions
            WHERE MessageId IS NOT NULL
            GROUP BY MessageId
            HAVING COUNT(*) > 1
            LIMIT 50
        """)

        return {
            'status': 'ok',
            'duplicate_count': len(dups),
            'duplicates': dups,
            'note': f'Found {len(dups)} duplicate MessageIds'
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }


def check_transaction_nulls():
    """Check for transactions with NULL amounts or missing essential fields."""
    try:
        nulls = dbmod.query("""
            SELECT
              COUNT(*) as total,
              SUM(IF(Amount IS NULL, 1, 0)) as null_amount,
              SUM(IF(Sender IS NULL, 1, 0)) as null_sender,
              SUM(IF(TransactionDate IS NULL, 1, 0)) as null_date
            FROM gmail_transactions
        """)

        return {
            'status': 'ok',
            'null_fields': nulls[0] if nulls else {},
            'timestamp': datetime.utcnow().isoformat()
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }


def get_sample_transactions(limit=10):
    """Fetch sample gmail_transactions for inspection."""
    try:
        samples = dbmod.query(f"""
            SELECT MessageId, TransactionNumber, Sender, Amount, Memo, TransactionDate, Notes
            FROM gmail_transactions
            ORDER BY TransactionDate DESC
            LIMIT {min(limit, 100)}
        """)

        return {
            'status': 'ok',
            'count': len(samples),
            'samples': samples,
            'timestamp': datetime.utcnow().isoformat()
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }


def check_webhook_email_config():
    """Check webhook and email configuration."""
    try:
        # Check GAS webhook config
        webhook_config = dbmod.query("SELECT * FROM gas_webhook_config LIMIT 1")

        # Check SMTP config
        smtp_config = dbmod.query("SELECT ConfigKey, ConfigValue FROM config WHERE ConfigKey LIKE '%SMTP%' OR ConfigKey LIKE '%EMAIL%'")

        return {
            'status': 'ok',
            'gas_webhook_config': webhook_config[0] if webhook_config else None,
            'smtp_config': {row['ConfigKey']: row['ConfigValue'] for row in smtp_config},
            'timestamp': datetime.utcnow().isoformat()
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'traceback': traceback.format_exc()
        }


def send_test_email():
    """Send a test email to verify SMTP configuration."""
    try:
        import smtplib
        from email.mime.text import MIMEText
        from email.mime.multipart import MIMEMultipart

        # Get SMTP config
        smtp_server = dbmod.query("SELECT ConfigValue FROM config WHERE ConfigKey = 'SMTP_SERVER'")
        smtp_port = dbmod.query("SELECT ConfigValue FROM config WHERE ConfigKey = 'SMTP_PORT'")
        smtp_user = dbmod.query("SELECT ConfigValue FROM config WHERE ConfigKey = 'SMTP_USER'")
        smtp_pass = dbmod.query("SELECT ConfigValue FROM config WHERE ConfigKey = 'SMTP_PASSWORD'")
        from_email = dbmod.query("SELECT ConfigValue FROM config WHERE ConfigKey = 'FROM_EMAIL'")
        to_email = dbmod.query("SELECT ConfigValue FROM config WHERE ConfigKey = 'TEST_EMAIL'")

        if not all([smtp_server, smtp_port, smtp_user, smtp_pass, from_email, to_email]):
            return {
                'status': 'error',
                'error': 'Missing SMTP configuration',
                'missing': [k for k, v in [
                    ('SMTP_SERVER', smtp_server),
                    ('SMTP_PORT', smtp_port),
                    ('SMTP_USER', smtp_user),
                    ('SMTP_PASSWORD', smtp_pass),
                    ('FROM_EMAIL', from_email),
                    ('TEST_EMAIL', to_email),
                ] if not v]
            }

        # Create message
        msg = MIMEMultipart()
        msg['From'] = from_email[0]['ConfigValue']
        msg['To'] = to_email[0]['ConfigValue']
        msg['Subject'] = 'MMR Admin Test Email'
        msg.attach(MIMEText('This is a test email from the MMR Admin Portal.', 'plain'))

        # Send
        with smtplib.SMTP(smtp_server[0]['ConfigValue'], int(smtp_port[0]['ConfigValue'])) as server:
            server.starttls()
            server.login(smtp_user[0]['ConfigValue'], smtp_pass[0]['ConfigValue'])
            server.send_message(msg)

        return {
            'status': 'ok',
            'message': f'Test email sent to {to_email[0]["ConfigValue"]}',
            'timestamp': datetime.utcnow().isoformat()
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc()
        }


def test_db_connection():
    """Test database connection and return basic info."""
    try:
        conn = dbmod.get_conn()
        cursor = conn.cursor(dictionary=True)

        # Get version
        cursor.execute("SELECT VERSION() as version")
        version = cursor.fetchone()

        # Get database name
        cursor.execute("SELECT DATABASE() as database")
        database = cursor.fetchone()

        # Get table count
        cursor.execute("SELECT COUNT(*) as count FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = DATABASE()")
        table_count = cursor.fetchone()

        cursor.close()
        conn.close()

        return {
            'status': 'ok',
            'mysql_version': version['version'] if version else 'Unknown',
            'database': database['database'] if database else 'Unknown',
            'table_count': table_count['count'] if table_count else 0,
            'timestamp': datetime.utcnow().isoformat()
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc()
        }


def dump_schema():
    """Dump MySQL schema (CREATE TABLE statements) for inspection."""
    try:
        conn = dbmod.get_conn()
        cursor = conn.cursor(dictionary=True)

        # Get all table names
        cursor.execute("""
            SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = DATABASE()
            ORDER BY TABLE_NAME
        """)
        tables = cursor.fetchall()

        schema = {}
        for table_row in tables:
            table_name = table_row['TABLE_NAME']
            cursor.execute(f"SHOW CREATE TABLE {table_name}")
            create_stmt = cursor.fetchone()
            if create_stmt:
                schema[table_name] = create_stmt.get('Create Table', '')

        cursor.close()
        conn.close()

        return {
            'status': 'ok',
            'table_count': len(schema),
            'schema': schema,
            'timestamp': datetime.utcnow().isoformat()
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'traceback': traceback.format_exc()
        }


# Registry of all diagnostic functions
FUNCTIONS = {
    'get_sheet_vs_db_counts': get_sheet_vs_db_counts,
    'get_sync_status': get_sync_status,
    'check_transaction_dups': check_transaction_dups,
    'check_transaction_nulls': check_transaction_nulls,
    'get_sample_transactions': get_sample_transactions,
    'test_db_connection': test_db_connection,
    'check_webhook_email_config': check_webhook_email_config,
    'send_test_email': send_test_email,
    'get_gmail_transactions_recent': get_gmail_transactions_recent,
    'get_gas_webhook_config': get_gas_webhook_config,
    'get_email_send_status': get_email_send_status,
    'analyze_email_flow': analyze_email_flow,
    'get_sheets_members': get_sheets_members,
    'get_sheets_payments': get_sheets_payments,
    'get_sheets_events': get_sheets_events,
    'get_sheets_transactions': get_sheets_transactions,
    'update_sheets_members': update_sheets_members,
    'update_sheets_payments': update_sheets_payments,
    'update_sheets_events': update_sheets_events,
    'compare_sheets_vs_db': compare_sheets_vs_db,
    'dump_schema': dump_schema,
}
