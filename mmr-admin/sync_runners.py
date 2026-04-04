"""
sync_runners.py — Simplified sync job runners using generic_sync_runner.

Each function wraps generic_sync_runner with appropriate database and webhook
helpers, matching the SYNC_CONFIG keys.

Used by api_sheets_sync.py Flask routes.
"""

from __future__ import annotations

import logging
from typing import Any, Dict

from db import query, execute
from sync_jobs import update_job

# Import the generic runner and config
try:
    from sync_config import generic_sync_runner, SYNC_CONFIG
except ImportError:
    # Fallback for development/testing
    from basecamp.python.sync_config import generic_sync_runner, SYNC_CONFIG

logger = logging.getLogger(__name__)


# ─────────────────────────────────────────────────────────────────────────────
# Google Apps Script Webhook Wrapper
# ─────────────────────────────────────────────────────────────────────────────

def _call_gas_webhook(payload: Dict) -> Dict:
    """
    Call the Google Apps Script webhook to fetch/push Sheets data.

    Args:
        payload: {action: str, ...}

    Returns:
        Response data or empty dict on error
    """
    import requests
    from config_cache import get_config as _get_config_cached

    webhook_url = _get_config_cached('SheetsWebhookUrl', '')
    if not webhook_url:
        logger.warning("SheetsWebhookUrl not configured — skipping webhook call")
        return {}

    max_retries = 3
    timeout = 60

    for attempt in range(max_retries):
        try:
            logger.info(f"GAS webhook POST action={payload.get('action')} ...")
            resp = requests.post(webhook_url, json=payload, timeout=timeout)
            logger.info(f"GAS webhook response: status={resp.status_code}")

            if resp.status_code != 200:
                raise Exception(f"HTTP {resp.status_code}: {resp.text[:500]}")
            if not resp.text.strip():
                raise Exception(f"GAS returned empty body")

            body = resp.json()
            if not body.get('ok'):
                raise Exception(f"GAS error: {body.get('error', body)}")

            return body.get('data', {})

        except requests.exceptions.Timeout as e:
            if attempt < max_retries - 1:
                logger.warning(f"GAS webhook timeout (attempt {attempt + 1}/{max_retries}), retrying...")
                continue
            else:
                logger.error(f"GAS webhook timeout after {max_retries} attempts")
                return {}

        except Exception as e:
            logger.error(f"GAS webhook error: {str(e)}")
            if attempt < max_retries - 1:
                continue
            return {}

    return {}


# ─────────────────────────────────────────────────────────────────────────────
# Simplified Sync Job Runners
# ─────────────────────────────────────────────────────────────────────────────

def sync_export_members(job_id: str):
    """Sync members: MySQL → Google Sheets."""
    logger.info(f"[{job_id}] Starting export_members")
    result = generic_sync_runner(
        job_id=job_id,
        config_key='export_members',
        db_query=query,
        db_execute=execute,
        gas_webhook=_call_gas_webhook,
        update_job=update_job,
        direction='mysql_to_sheet'
    )
    logger.info(f"[{job_id}] Result: {result}")
    update_job(job_id, **result)


def sync_export_payments(job_id: str):
    """Sync payments: MySQL → Google Sheets."""
    logger.info(f"[{job_id}] Starting export_payments")
    result = generic_sync_runner(
        job_id=job_id,
        config_key='export_payments',
        db_query=query,
        db_execute=execute,
        gas_webhook=_call_gas_webhook,
        update_job=update_job,
        direction='mysql_to_sheet'
    )
    logger.info(f"[{job_id}] Result: {result}")
    update_job(job_id, **result)


def sync_export_submissions(job_id: str):
    """Sync submissions: MySQL → Google Sheets."""
    logger.info(f"[{job_id}] Starting export_submissions")
    result = generic_sync_runner(
        job_id=job_id,
        config_key='export_submissions',
        db_query=query,
        db_execute=execute,
        gas_webhook=_call_gas_webhook,
        update_job=update_job,
        direction='mysql_to_sheet'
    )
    logger.info(f"[{job_id}] Result: {result}")
    update_job(job_id, **result)


def sync_export_transaction_meta(job_id: str):
    """Sync transaction metadata: MySQL → Google Sheets (Notes, UpdatedAt only)."""
    logger.info(f"[{job_id}] Starting export_transaction_meta")
    result = generic_sync_runner(
        job_id=job_id,
        config_key='export_transaction_meta',
        db_query=query,
        db_execute=execute,
        gas_webhook=_call_gas_webhook,
        update_job=update_job,
        direction='mysql_to_sheet'
    )
    logger.info(f"[{job_id}] Result: {result}")
    update_job(job_id, **result)


def sync_import_members(job_id: str):
    """Import members (insert-only): Google Sheets Main → MySQL members."""
    logger.info(f"[{job_id}] Starting import_members (insert-only mode)")
    result = generic_sync_runner(
        job_id=job_id,
        config_key='import_members',
        db_query=query,
        db_execute=execute,
        gas_webhook=_call_gas_webhook,
        update_job=update_job,
        direction='sheet_to_mysql'
    )
    logger.info(f"[{job_id}] Result: {result}")
    update_job(job_id, **result)


def sync_import_transactions(job_id: str):
    """Import transactions (upsert): Google Sheets → MySQL."""
    logger.info(f"[{job_id}] Starting import_transactions")
    result = generic_sync_runner(
        job_id=job_id,
        config_key='import_transactions',
        db_query=query,
        db_execute=execute,
        gas_webhook=_call_gas_webhook,
        update_job=update_job,
        direction='sheet_to_mysql'
    )
    logger.info(f"[{job_id}] Result: {result}")
    update_job(job_id, **result)


def full_sync_all_operations(job_id: str):
    """
    Full Sync: Run all 5 operations in sequence.

    Operations:
      1. Export Members (MySQL → Google Sheets, SQL Members tab)
      2. Export Payments (MySQL → Google Sheets, SQL Payments tab)
      3. Export Submissions (MySQL → Google Sheets, SQL Submissions tab)
      4. Export Transactions metadata (MySQL → Google Sheets, SQL Transactions tab, Notes & UpdatedAt only)
      5. Import Transactions (Google Sheets → MySQL, gmail_transactions table)

    Each operation updates the job status with progress and messages.
    """
    operations = [
        ('export_members', 'Export Members'),
        ('export_payments', 'Export Payments'),
        ('export_submissions', 'Export Submissions'),
        ('export_transaction_meta', 'Export Transactions'),
        ('import_transactions', 'Import Transactions'),
    ]

    logger.info(f"[{job_id}] Starting Full Sync (5 operations)")

    for idx, (config_key, op_name) in enumerate(operations):
        progress = int((idx / len(operations)) * 100)
        update_job(job_id, message=f"[{idx + 1}/5] Running {op_name}...", progress=progress)
        logger.info(f"[{job_id}] [{idx + 1}/5] Starting {op_name}")

        try:
            result = generic_sync_runner(
                job_id=job_id,
                config_key=config_key,
                db_query=query,
                db_execute=execute,
                gas_webhook=_call_gas_webhook,
                update_job=update_job,
                direction=None  # Use direction from config
            )
            logger.info(f"[{job_id}] [{idx + 1}/5] {op_name} result: {result}")
        except Exception as e:
            logger.error(f"[{job_id}] [{idx + 1}/5] {op_name} failed: {e}")
            update_job(job_id, status='error', message=f"❌ {op_name} failed: {e}")
            return

    update_job(
        job_id,
        status='done',
        message='✅ Full Sync Complete: All 5 operations succeeded',
        progress=100
    )
    logger.info(f"[{job_id}] Full Sync completed successfully")
