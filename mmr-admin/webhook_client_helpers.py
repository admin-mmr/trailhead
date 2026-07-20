"""
High-level email helpers for webhook_client.py — each wraps send_email_webhook
with a specific email template.

Extracted from webhook_client.py to keep that module under the code-health line
limit. These functions are re-imported into webhook_client so callers keep
`from webhook_client import send_payment_approved_email` (etc.) working unchanged.
"""

from typing import Optional


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
    from webhook_client import send_email_webhook
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
    from webhook_client import send_email_webhook
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
    from webhook_client import send_email_webhook
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
    from webhook_client import send_email_webhook

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
    from webhook_client import send_email_webhook

    result = send_email_webhook(
        to=to,
        subject=subject,
        html_content=html_content,
        text_content=text_content,
        cc=cc,
        email_type='generic',
    )

    return result['success']
