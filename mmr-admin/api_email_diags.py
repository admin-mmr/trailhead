"""
Email Pipeline Diagnostic Functions for MMR Admin

Provides diagnostic functions to trace email flow from webhook POST through GAS to database logging.
This is a leaf module — it only imports db and standard library.
"""

from __future__ import annotations

import traceback
from datetime import datetime
import db as dbmod


def get_gmail_transactions_recent(limit=20):
    """Query recent gmail_transactions records to understand what's being logged."""
    debug = {'queries': []}
    try:
        query = """
            SELECT
                MessageId, Timestamp, Sender, Subject, Amount, TransactionNumber,
                Source, PaymentID, UpdatedAt
            FROM gmail_transactions
            ORDER BY TimeStamp DESC
            LIMIT %s
        """
        rows = dbmod.query(query, (limit,))
        debug['queries'].append(f"✓ Selected {len(rows)} recent gmail_transactions records")
        debug['row_count'] = len(rows)
        debug['sample_columns'] = [
            'MessageId', 'Timestamp', 'Sender', 'Subject', 'Source', 'UpdatedAt'
        ] if rows else []

        return {
            'status': 'ok',
            'function': 'get_gmail_transactions_recent',
            'rows': rows,
            'debug': debug,
            'note': 'gmail_transactions = emails RECEIVED from Gmail. For SENT emails via GAS webhook, see get_email_send_status().',
            'executed_at': datetime.utcnow().isoformat(),
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'debug': debug,
            'function': 'get_gmail_transactions_recent',
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat(),
        }


def get_gas_webhook_config():
    """Verify GAS webhook URL is configured in MySQL Config table."""
    debug = {'checks': {}}
    try:
        # Check if webhook URL exists in Config table
        query = "SELECT ConfigKey, ConfigValue FROM Config WHERE ConfigKey = %s"
        result = dbmod.query(query, ('SheetsWebhookUrl',))

        if result:
            webhook_url = result[0].get('ConfigValue', '')
            debug['checks']['webhook_configured'] = True
            debug['checks']['webhook_url_prefix'] = webhook_url[:60] + '...' if len(webhook_url) > 60 else webhook_url
            debug['checks']['url_length'] = len(webhook_url)
            return {
                'status': 'ok',
                'function': 'get_gas_webhook_config',
                'configured': True,
                'webhook_url_preview': webhook_url[:80] + '...',
                'debug': debug,
                'executed_at': datetime.utcnow().isoformat(),
            }
        else:
            debug['checks']['webhook_configured'] = False
            return {
                'status': 'warning',
                'function': 'get_gas_webhook_config',
                'configured': False,
                'message': 'SheetsWebhookUrl not found in Config table. Webhook emails will fail.',
                'debug': debug,
                'executed_at': datetime.utcnow().isoformat(),
            }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'debug': debug,
            'function': 'get_gas_webhook_config',
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat(),
        }


def get_email_send_status():
    """Check activity_log for records of emails sent via webhook (action='email_send')."""
    debug = {'queries': [], 'tables_checked': []}
    try:
        # Check activity_log for email send actions
        query_activity = """
            SELECT
                LogID, MemberID, Email, Action, Timestamp, State, ErrorCode, ErrorMessage
            FROM activity_log
            WHERE Action LIKE '%email%' OR Action LIKE '%webhook%'
            ORDER BY Timestamp DESC
            LIMIT 50
        """
        activity_rows = dbmod.query(query_activity, ())
        debug['queries'].append(f"✓ Queried activity_log: found {len(activity_rows)} email/webhook-related records")
        debug['tables_checked'].append('activity_log')

        # Also check Config table to see all config values (might reveal email-related settings)
        query_config = "SELECT ConfigKey, ConfigValue FROM Config WHERE ConfigKey LIKE '%[Ee]mail%' OR ConfigKey LIKE '%[Ww]ebhook%'"
        config_rows = dbmod.query(query_config, ())
        debug['queries'].append(f"✓ Queried Config table: found {len(config_rows)} email/webhook config entries")
        debug['tables_checked'].append('Config')

        return {
            'status': 'ok',
            'function': 'get_email_send_status',
            'activity_log_records': activity_rows,
            'email_config_values': config_rows,
            'note': 'GAS webhook responses are logged to application logs, not DB. Use cloud logs to see webhook POST/response details.',
            'debug': debug,
            'executed_at': datetime.utcnow().isoformat(),
        }
    except Exception as e:
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'debug': debug,
            'function': 'get_email_send_status',
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat(),
        }


def analyze_email_flow():
    """
    Comprehensive analysis of email pipeline:
    - GAS webhook configuration
    - Recent gmail_transactions (received emails)
    - Activity log email records
    - Table schema info
    """
    debug = {
        'pipeline_checks': [],
        'summary': {}
    }
    try:
        # 1. Check webhook config
        webhook_result = get_gas_webhook_config()
        webhook_ok = webhook_result['status'] == 'ok' and webhook_result.get('configured')
        debug['pipeline_checks'].append({
            'component': 'GAS Webhook URL Config',
            'status': '✓' if webhook_ok else '✗',
            'details': webhook_result.get('message') or 'Configured'
        })

        # 2. Check gmail_transactions table stats
        query_gmail_stats = "SELECT COUNT(*) as total, MAX(Timestamp) as latest FROM gmail_transactions WHERE PaymentID IS NOT NULL"
        gmail_stats = dbmod.query(query_gmail_stats)
        gmail_count = gmail_stats[0].get('total', 0) if gmail_stats else 0
        gmail_latest = gmail_stats[0].get('latest') if gmail_stats else None
        debug['pipeline_checks'].append({
            'component': 'Gmail Transactions (received)',
            'status': '✓' if gmail_count > 0 else '⚠',
            'total_records': gmail_count,
            'latest': str(gmail_latest) if gmail_latest else 'None'
        })

        # 3. Check for email send logs in activity_log
        query_activity_email = """
            SELECT COUNT(*) as email_actions
            FROM activity_log
            WHERE Action LIKE '%email%' AND Timestamp >= DATE_SUB(NOW(), INTERVAL 7 DAY)
        """
        activity_email = dbmod.query(query_activity_email)
        email_actions = activity_email[0].get('email_actions', 0) if activity_email else 0
        debug['pipeline_checks'].append({
            'component': 'Email Actions (last 7 days)',
            'status': '✓' if email_actions > 0 else '⚠',
            'count': email_actions,
            'source': 'activity_log'
        })

        # 4. Check Config table for email settings
        query_config = "SELECT COUNT(*) as config_count FROM Config WHERE ConfigKey LIKE '%email%' OR ConfigKey LIKE '%webhook%'"
        config_check = dbmod.query(query_config)
        config_count = config_check[0].get('config_count', 0) if config_check else 0
        debug['pipeline_checks'].append({
            'component': 'Email/Webhook Config Entries',
            'status': '✓' if config_count > 0 else '⚠',
            'count': config_count
        })

        # Summary
        all_ok = webhook_ok and gmail_count > 0 and config_count > 0
        debug['summary']['pipeline_status'] = '✓ HEALTHY' if all_ok else '⚠ NEEDS REVIEW'
        debug['summary']['webhook_configured'] = webhook_ok
        debug['summary']['has_email_data'] = gmail_count > 0
        debug['summary']['has_config'] = config_count > 0
        debug['summary']['recommendation'] = (
            'All email pipeline components configured.' if all_ok
            else 'Missing components in email pipeline. See pipeline_checks for details.'
        )

        return {
            'status': 'ok',
            'function': 'analyze_email_flow',
            'pipeline_checks': debug['pipeline_checks'],
            'summary': debug['summary'],
            'note': 'For GAS webhook response details (success/error), check Azure Application Logs or GAS console.',
            'debug': debug,
            'executed_at': datetime.utcnow().isoformat(),
        }
    except Exception as e:
        debug['summary']['error'] = str(e)
        return {
            'status': 'error',
            'error': str(e),
            'error_type': type(e).__name__,
            'debug': debug,
            'function': 'analyze_email_flow',
            'traceback': traceback.format_exc(),
            'executed_at': datetime.utcnow().isoformat(),
        }
