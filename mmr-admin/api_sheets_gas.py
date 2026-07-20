"""
GAS webhook transport for the Sheets diagnostic functions.

Leaf helper split out of api_sheets_diags.py: owns the retry logic for calling
the Google Apps Script webhook. Imported by api_sheets_diags.py (readers) and
api_sheets_write.py (writers/compare). Pure move — retry behavior unchanged.
"""

from __future__ import annotations

from typing import Dict, Any

from config_cache import get_config


def _call_gas_webhook(payload: Dict[str, Any]) -> Dict[str, Any]:
    """
    Call the Google Apps Script webhook to fetch/push Sheets data.

    Args:
        payload: {action: str, ...}

    Returns:
        Response data or empty dict on error
    """
    try:
        import requests

        webhook_url = get_config('SheetsWebhookUrl', '').strip()
        if not webhook_url:
            raise ValueError("SheetsWebhookUrl not configured in Config table")

        max_retries = 3
        timeout = 60

        for attempt in range(max_retries):
            try:
                resp = requests.post(webhook_url, json=payload, timeout=timeout)
                if resp.status_code != 200:
                    raise Exception(f"HTTP {resp.status_code}: {resp.text[:500]}")

                body = resp.json()
                if not body.get('ok'):
                    raise Exception(f"GAS error: {body.get('error', 'unknown')}")

                return body.get('data', {})
            except requests.exceptions.Timeout:
                if attempt < max_retries - 1:
                    continue
                raise

        return {}
    except Exception as e:
        raise
