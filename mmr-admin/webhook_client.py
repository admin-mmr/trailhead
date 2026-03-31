"""
Webhook client for sending emails via GAS webhook.

Replaces email_client.py which used Azure Communication Services.
Now all emails are sent to GAS, which logs them and sends via Gmail.

Depends on: MySQL config table for SheetsWebhookUrl
"""

import os
import logging
import json
import requests
from typing import Optional, Dict, Any
from datetime import datetime

logger = logging.getLogger(__name__)


def get_sheets_webhook_url() -> str:
    """
    Get the GAS webhook URL from MySQL config table.

    This should be set via:
      INSERT INTO Config (Key, Value) VALUES ('SheetsWebhookUrl', 'https://script.google.com/...')

    Falls back to env var for testing.
    """
    # Try env first (for testing)
    env_url = os.environ.get('SHEETS_WEBHOOK_URL')
    if env_url:
        return env_url

    # Otherwise, fetch from MySQL config table
    try:
        from db import get_db_connection
        conn = get_db_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute('SELECT ConfigValue FROM Config WHERE ConfigKey = %s', ('SheetsWebhookUrl',))
        row = cursor.fetchone()
        cursor.close()
        conn.close()

        if row and row.get('ConfigValue'):
            return row['ConfigValue']
    except Exception as e:
        logger.warning(f'[webhook_client] Failed to fetch webhook URL from MySQL: {e}')

    raise ValueError('SHEETS_WEBHOOK_URL not found in MySQL config or environment')


def send_email_webhook(
    to: str,
    subject: str,
    html_content: str,
    text_content: Optional[str] = None,
    cc: Optional[str] = 'admin@mmrunners.org',
    email_type: Optional[str] = None,
    member_id: Optional[str] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Send an email via GAS webhook (replaces Azure SDK).

    Args:
        to: Recipient email address
        subject: Email subject
        html_content: HTML email body
        text_content: Plain text fallback (auto-generated if not provided)
        cc: CC recipient(s) — can be single email or comma-separated
        email_type: Email category (e.g., 'payment_approved', 'membership_activated')
        member_id: Member ID for logging
        metadata: Additional metadata to log

    Returns:
        Dict with keys: success (bool), status (str), message (str), error (str or None), email_id (str)
    """
    result_data = {
        'success': False,
        'to': to,
        'cc': cc,
        'subject': subject[:50],
        'status': None,
        'message': None,
        'error': None,
        'email_id': None,
        'timestamp': datetime.utcnow().isoformat(),
    }

    try:
        webhook_url = get_sheets_webhook_url()
        logger.info(f'[webhook_client] Using webhook URL: {webhook_url[:60]}...')

        # Build payload
        payload = {
            'action': 'email_send',
            'to': to,
            'subject': subject,
            'html_content': html_content,
        }

        if text_content:
            payload['text_content'] = text_content

        if cc:
            payload['cc'] = cc

        if email_type:
            payload['email_type'] = email_type

        if member_id:
            payload['member_id'] = member_id

        if metadata:
            payload['metadata'] = metadata

        # Send POST to GAS webhook
        logger.info(
            f'[webhook_client] Sending email via webhook to {to}, '
            f'subject={subject[:50]}..., email_type={email_type}'
        )

        response = requests.post(
            webhook_url,
            json=payload,
            timeout=30,
        )

        response.raise_for_status()

        # Parse response
        webhook_response = response.json()

        if webhook_response.get('ok'):
            result_data['success'] = True
            result_data['status'] = webhook_response.get('status', 'sent')
            result_data['email_id'] = webhook_response.get('email_id')
            result_data['message'] = (
                f"✅ Email sent to {to} via webhook "
                f"(ID: {webhook_response.get('email_id')})"
            )

            logger.info(
                f'[webhook_client] SUCCESS: to={to}, cc={cc}, '
                f'subject={subject[:50]}..., email_id={result_data["email_id"]}'
            )
        else:
            error_msg = webhook_response.get('error', 'Unknown error')
            result_data['error'] = error_msg
            result_data['message'] = f"❌ Webhook returned error: {error_msg}"

            logger.error(
                f'[webhook_client] FAILED: to={to}, cc={cc}, '
                f'webhook_error={error_msg}'
            )

        return result_data

    except requests.exceptions.RequestException as e:
        result_data['error'] = str(e)
        result_data['message'] = f"❌ Webhook request failed: {e}"
        logger.error(
            f'[webhook_client] Request failed: to={to}, cc={cc}, error={e}',
            exc_info=True,
        )
        return result_data

    except Exception as e:
        result_data['error'] = str(e)
        result_data['message'] = f"❌ Failed to send email: {e}"
        logger.error(
            f'[webhook_client] Unexpected error: to={to}, cc={cc}, error={e}',
            exc_info=True,
        )
        return result_data


# ─────────────────────────────────────────────────────────────────────────────
# High-level email functions — wrap send_email_webhook with templates
# ─────────────────────────────────────────────────────────────────────────────


def send_payment_approved_email(
    to: str,
    first_name: str,
    member_id: str,
    payment_intent: str,
    expires_at: str,
    amount: float,
) -> bool:
    """
    Send payment approved email when admin approves a manual match.

    Args:
        to: Member email
        first_name: Member's first name
        member_id: Member ID
        payment_intent: Payment type (e.g., "Individual Membership", "Family Upgrade")
        expires_at: ISO date string of new expiration
        amount: Payment amount
    """
    from email_templates import payment_approved_html

    html = payment_approved_html(
        first_name=first_name,
        member_id=member_id,
        payment_intent=payment_intent,
        expires_at=expires_at,
        amount=amount,
    )

    result = send_email_webhook(
        to=to,
        subject=f'🎉 Your MMR {payment_intent} is confirmed!',
        html_content=html,
        email_type='payment_approved',
        member_id=member_id,
        metadata={'payment_intent': payment_intent, 'amount': amount},
    )

    return result['success']


def send_payment_rejected_email(
    to: str,
    first_name: str,
    member_id: str,
    reason: str,
    reference_id: str,
) -> bool:
    """
    Send payment rejected email.

    Args:
        to: Member email
        first_name: Member's first name
        member_id: Member ID
        reason: Reason for rejection
        reference_id: Payment reference ID
    """
    from email_templates import payment_rejected_html

    html = payment_rejected_html(
        first_name=first_name,
        member_id=member_id,
        reason=reason,
        reference_id=reference_id,
    )

    result = send_email_webhook(
        to=to,
        subject=f'MMR Payment Could Not Be Verified — Ref {reference_id}',
        html_content=html,
        email_type='payment_rejected',
        member_id=member_id,
        metadata={'reason': reason, 'reference_id': reference_id},
    )

    return result['success']


def send_membership_activated_email(
    to: str,
    first_name: str,
    member_id: str,
    plan_label: str,
    expires_at: str,
) -> bool:
    """
    Send membership activated email (same as welcome, but from admin action).

    Args:
        to: Member email
        first_name: Member's first name
        member_id: Member ID
        plan_label: Membership plan (e.g., "Individual Membership", "Family")
        expires_at: ISO date string of expiration
    """
    from email_templates import membership_activated_html

    html = membership_activated_html(
        first_name=first_name,
        member_id=member_id,
        plan_label=plan_label,
        expires_at=expires_at,
    )

    result = send_email_webhook(
        to=to,
        subject=f'Welcome to Misty Mountain Runners! 🎉 Your Member ID: {member_id}',
        html_content=html,
        email_type='membership_activated',
        member_id=member_id,
        metadata={'plan_label': plan_label},
    )

    return result['success']


def send_admin_notification_email(
    admin_email: str,
    subject: str,
    html_content: str,
) -> bool:
    """
    Send a notification email to an admin about an action they took.

    Args:
        admin_email: Admin email address
        subject: Email subject
        html_content: HTML body
    """
    result = send_email_webhook(
        to=admin_email,
        cc=None,  # Don't CC ourselves when notifying admin
        subject=subject,
        html_content=html_content,
        email_type='admin_notification',
    )

    return result['success']


def send_generic_email(
    to: str,
    subject: str,
    html_content: str,
    text_content: Optional[str] = None,
    cc: Optional[str] = 'admin@mmrunners.org',
) -> bool:
    """
    Send a generic email (used by api_sheets_sync and api_python_exec).

    Args:
        to: Recipient email
        subject: Email subject
        html_content: HTML body
        text_content: Plain text fallback
        cc: CC recipient

    Returns:
        True if successful, False otherwise
    """
    result = send_email_webhook(
        to=to,
        subject=subject,
        html_content=html_content,
        text_content=text_content,
        cc=cc,
        email_type='generic',
    )

    return result['success']
