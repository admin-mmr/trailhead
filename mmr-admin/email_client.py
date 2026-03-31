"""
Email client for mmr-admin using Azure Communication Services.

Sends beautiful HTML emails with CC to admin@mmrunners.org for all member notifications.
"""

import os
import logging
from typing import Optional, Dict, Any
from azure.communication.email import EmailClient

logger = logging.getLogger(__name__)


def get_email_client() -> EmailClient:
    """Get or create Azure Communication Services email client."""
    connection_string = os.environ.get('AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING')
    if not connection_string:
        raise ValueError('AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING not set in environment')
    return EmailClient.from_connection_string(connection_string)


def _get_sender_from_connection_string(connection_string: str) -> str:
    """
    Extract sender email from Azure Communication Services connection string.

    Azure provides a default test sender in format:
    DoNotReply@<resource-guid>.<region>.azurecomm.net

    Connection string format: endpoint=https://<resource-guid>.communication.azure.com/;access_key=...
    We extract the resource GUID and region to build the test sender email.
    """
    try:
        # Extract endpoint URL
        for part in connection_string.split(';'):
            if part.startswith('endpoint='):
                endpoint = part.replace('endpoint=', '').strip()
                # Extract resource GUID from https://resource-guid.communication.azure.com/
                if 'https://' in endpoint and 'communication.azure.com' in endpoint:
                    resource_guid = endpoint.split('https://')[1].split('.communication.azure.com')[0]
                    # Azure test sender format: DoNotReply@<guid>.us1.azurecomm.net
                    # Default to us1 region if not specified in connection string
                    return f'DoNotReply@{resource_guid}.us1.azurecomm.net'
    except Exception as e:
        logger.warning(f'Failed to extract sender from connection string: {e}')

    # Fallback (should rarely reach here if connection string is valid)
    return 'DoNotReply@example.azurecomm.net'


def send_email(
    to: str,
    subject: str,
    html_content: str,
    text_content: Optional[str] = None,
    cc: Optional[str] = 'admin@mmrunners.org',
) -> Dict[str, Any]:
    """
    Send an email via Azure Communication Services.

    Args:
        to: Recipient email address
        subject: Email subject
        html_content: HTML email body
        text_content: Plain text fallback (auto-generated if not provided)
        cc: CC recipient(s) — can be single email or comma-separated

    Returns:
        Dict with keys: success (bool), status (str), message (str), error (str or None)
    """
    result_data = {
        'success': False,
        'to': to,
        'cc': cc,
        'subject': subject[:50],
        'status': None,
        'message': None,
        'error': None,
        'timestamp': None,
    }

    try:
        from datetime import datetime
        result_data['timestamp'] = datetime.utcnow().isoformat()

        # Check if connection string is set
        connection_string = os.environ.get('AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING')
        if not connection_string:
            error_msg = 'AZURE_COMMUNICATION_SERVICES_CONNECTION_STRING not set'
            logger.error(f'[email] {error_msg}')
            result_data['error'] = error_msg
            result_data['message'] = f'❌ Config error: {error_msg}'
            return result_data

        client = get_email_client()

        # Use Azure-provided test sender (verified by default)
        sender = 'DoNotReply@6e248907-c5ac-4a28-8297-f9834526aecd.us1.azurecomm.net'
        logger.info(f'[email] Using sender: {sender}')

        # Build CC list
        cc_recipients = []
        if cc:
            cc_list = [e.strip() for e in cc.split(',')]
            cc_recipients = [{'address': e} for e in cc_list]

        # Build recipients (Azure SDK requires 'cc' only if non-empty)
        recipients: Dict[str, Any] = {'to': [{'address': to}]}
        if cc_recipients:
            recipients['cc'] = cc_recipients

        # Build message
        message = {
            'senderAddress': sender,
            'recipients': recipients,
            'content': {
                'subject': subject,
                'html': html_content,
                'plainText': text_content or _strip_html(html_content),
            },
        }

        # Send via Azure
        logger.info(f'[email] sending to {to}, cc={cc}, subject={subject[:50]}...')
        poller = client.begin_send(message)
        email_result = poller.result()

        result_data['success'] = True
        result_data['status'] = email_result.status if hasattr(email_result, 'status') else 'Sent'
        result_data['message'] = f"✅ Email sent to {to} (status: {result_data['status']})"

        logger.info(
            f'[email] SUCCESS: to={to}, cc={cc}, subject={subject[:50]}... | '
            f'status={result_data["status"]}'
        )
        return result_data

    except Exception as e:
        result_data['error'] = str(e)
        result_data['message'] = f"❌ Failed to send to {to}: {e}"
        logger.error(f'[email] FAILED: to={to}, cc={cc}, error={e}', exc_info=True)
        return result_data


def _strip_html(html: str) -> str:
    """
    Simple HTML-to-text conversion for plain text fallback.
    Remove HTML tags and decode common entities.
    """
    import re
    import html as html_module

    # Remove script and style tags
    text = re.sub(r'<script[^>]*>.*?</script>', '', html, flags=re.DOTALL | re.IGNORECASE)
    text = re.sub(r'<style[^>]*>.*?</style>', '', text, flags=re.DOTALL | re.IGNORECASE)

    # Remove HTML tags
    text = re.sub(r'<[^>]+>', '', text)

    # Decode HTML entities
    text = html_module.unescape(text)

    # Clean up whitespace
    text = re.sub(r'\s+', ' ', text).strip()

    return text


# ─────────────────────────────────────────────────────────────────────────────
# Payment-related emails
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

    return send_email(
        to=to,
        subject=f'🎉 Your MMR {payment_intent} is confirmed!',
        html_content=html,
    )


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

    return send_email(
        to=to,
        subject=f'MMR Payment Could Not Be Verified — Ref {reference_id}',
        html_content=html,
    )


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

    return send_email(
        to=to,
        subject=f'Welcome to Misty Mountain Runners! 🎉 Your Member ID: {member_id}',
        html_content=html,
    )


# ─────────────────────────────────────────────────────────────────────────────
# Admin notification emails (to admin, about their actions)
# ─────────────────────────────────────────────────────────────────────────────


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
    return send_email(
        to=admin_email,
        cc=None,  # Don't CC ourselves when notifying admin
        subject=subject,
        html_content=html_content,
    )
