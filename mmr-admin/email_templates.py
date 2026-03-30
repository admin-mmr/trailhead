"""
HTML email templates for mmr-admin payment notifications.

All templates use the MMR brand colors and include CC to admin@mmrunners.org.
"""

import os
from datetime import datetime

# Brand config
BRAND_COLOR = '#5c35a8'  # MMR purple
ADMIN_EMAIL = 'admin@mmrunners.org'
APP_URL = os.environ.get('APP_BASE_URL', 'https://mmrunners.org')
PORTAL = f'{APP_URL}/portal'


def _format_date(iso_date: str) -> str:
    """Format ISO date string to readable format."""
    try:
        dt = datetime.fromisoformat(iso_date.replace('Z', '+00:00'))
        return dt.strftime('%B %d, %Y')
    except Exception:
        return iso_date


def _email_wrapper(first_name: str, body: str) -> str:
    """Wrap email content in brand template."""
    return f"""<!DOCTYPE html>
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
      <tr><td style="background:{BRAND_COLOR};padding:28px 36px;text-align:center;">
        <div style="font-size:26px;margin-bottom:4px;">🏃</div>
        <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">Misty Mountain Runners</div>
        <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;">New York Running Community</div>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:36px 36px 28px;">
        {body}
      </td></tr>
      <!-- Footer -->
      <tr><td style="background:#f8f8fa;padding:20px 36px;text-align:center;border-top:1px solid #eeeeee;">
        <div style="color:#999999;font-size:12px;line-height:1.6;">
          Misty Mountain Runners &nbsp;·&nbsp; New York
          <br>Questions? Email us at <a href="mailto:{ADMIN_EMAIL}" style="color:{BRAND_COLOR};text-decoration:none;">{ADMIN_EMAIL}</a>
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>"""


def _cta_button(label: str, url: str) -> str:
    """Create a branded CTA button."""
    return f"""<table cellpadding="0" cellspacing="0" style="margin:28px auto 0;">
    <tr><td align="center" style="background:{BRAND_COLOR};border-radius:8px;">
      <a href="{url}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">{label} &rarr;</a>
    </td></tr>
  </table>"""


# ─────────────────────────────────────────────────────────────────────────────
# Payment approved (admin action)
# ─────────────────────────────────────────────────────────────────────────────


def payment_approved_html(
    first_name: str,
    member_id: str,
    payment_intent: str,
    expires_at: str,
    amount: float,
) -> str:
    """Email sent to member when admin approves their payment."""
    expiry = _format_date(expires_at)

    body = f"""
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;font-weight:700;">Payment approved, {first_name}! 🎉</h2>
    <p style="margin:0 0 20px;font-size:15px;color:#555555;line-height:1.6;">
      Your <strong>${amount:.2f} {payment_intent}</strong> payment has been verified and your membership is now active.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:10px;margin:0 0 20px;">
      <tr><td style="padding:20px 22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:0 20px 12px 0;">
              <div style="font-size:11px;color:#9b8ec4;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px;">Member ID</div>
              <div style="font-size:20px;font-weight:800;color:{BRAND_COLOR};">{member_id}</div>
            </td>
            <td style="padding:0 0 12px;">
              <div style="font-size:11px;color:#9b8ec4;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px;">Type</div>
              <div style="font-size:15px;font-weight:600;color:#333333;">{payment_intent}</div>
            </td>
          </tr>
          <tr><td colspan="2">
            <div style="font-size:11px;color:#9b8ec4;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px;">Valid until</div>
            <div style="font-size:15px;font-weight:600;color:#333333;">{expiry}</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
    <p style="margin:0 0 8px;font-size:15px;color:#555555;line-height:1.6;">
      Log in to your member portal to view your profile, race results, club photos, and upcoming events.
    </p>
    {_cta_button('Go to Member Portal', PORTAL)}
    <p style="margin:24px 0 0;font-size:13px;color:#999999;text-align:center;">
      Questions? <a href="mailto:{ADMIN_EMAIL}" style="color:{BRAND_COLOR};text-decoration:none;">{ADMIN_EMAIL}</a>
    </p>"""

    return _email_wrapper(first_name, body)


# ─────────────────────────────────────────────────────────────────────────────
# Payment rejected
# ─────────────────────────────────────────────────────────────────────────────


def payment_rejected_html(
    first_name: str,
    member_id: str,
    reason: str,
    reference_id: str,
) -> str:
    """Email sent to member when admin rejects their payment."""
    body = f"""
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;font-weight:700;">Payment not verified, {first_name}</h2>
    <p style="margin:0 0 20px;font-size:15px;color:#555555;line-height:1.6;">
      Unfortunately, we were unable to verify your recent membership payment.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border:1px solid #fecaca;border-radius:10px;margin:0 0 20px;">
      <tr><td style="padding:18px 22px;">
        <div style="font-size:11px;color:#e57373;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:6px;">Reason</div>
        <div style="font-size:14px;color:#c62828;font-weight:500;">{reason}</div>
      </td></tr>
    </table>
    <p style="margin:0 0 16px;font-size:15px;color:#555555;line-height:1.6;">
      Please resubmit your payment or contact us and we'll help sort it out.
    </p>
    {_cta_button('Resubmit Payment', PORTAL + '/payment')}
    <p style="margin:24px 0 0;font-size:13px;color:#999999;text-align:center;">
      Need help? <a href="mailto:{ADMIN_EMAIL}" style="color:{BRAND_COLOR};text-decoration:none;">{ADMIN_EMAIL}</a>
    </p>"""

    return _email_wrapper(first_name, body)


# ─────────────────────────────────────────────────────────────────────────────
# Membership activated (same as welcome, for admin-created members)
# ─────────────────────────────────────────────────────────────────────────────


def membership_activated_html(
    first_name: str,
    member_id: str,
    plan_label: str,
    expires_at: str,
) -> str:
    """Email sent when admin creates/activates a membership."""
    expiry = _format_date(expires_at)

    body = f"""
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;font-weight:700;">Welcome, {first_name}! 🎉</h2>
    <p style="margin:0 0 20px;font-size:15px;color:#555555;line-height:1.6;">
      We're so glad you've joined Misty Mountain Runners — New York's Chinese-American running community.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:10px;margin:0 0 20px;">
      <tr><td style="padding:20px 22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:0 20px 12px 0;">
              <div style="font-size:11px;color:#9b8ec4;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px;">Member ID</div>
              <div style="font-size:20px;font-weight:800;color:{BRAND_COLOR};">{member_id}</div>
            </td>
            <td style="padding:0 0 12px;">
              <div style="font-size:11px;color:#9b8ec4;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px;">Type</div>
              <div style="font-size:15px;font-weight:600;color:#333333;">{plan_label}</div>
            </td>
          </tr>
          <tr><td colspan="2">
            <div style="font-size:11px;color:#9b8ec4;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px;">Valid until</div>
            <div style="font-size:15px;font-weight:600;color:#333333;">{expiry}</div>
          </td></tr>
        </table>
      </td></tr>
    </table>
    <p style="margin:0 0 16px;font-size:15px;color:#555555;line-height:1.6;">
      Your member portal gives you access to race results, club events, photos, and more.
    </p>
    {_cta_button('Go to My Portal', PORTAL)}
    <p style="margin:24px 0 0;font-size:13px;color:#999999;text-align:center;line-height:1.5;">
      Questions? Just reply to this email or write to
      <a href="mailto:{ADMIN_EMAIL}" style="color:{BRAND_COLOR};text-decoration:none;">{ADMIN_EMAIL}</a>
    </p>"""

    return _email_wrapper(first_name, body)
