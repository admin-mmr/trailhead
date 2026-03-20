// ============================================================
// Email notifications for payment approvals, rejections, expirations
// Depends on: config.ts, sheets.ts, logger.ts
//
// ⚠️ IMPORTANT: Uses MailApp.sendEmail() — NOT GmailApp.sendEmail().
// GmailApp requires an active user session; in time-based GAS triggers
// Session.getActiveUser().getEmail() returns '' which causes silent failures.
// MailApp always sends from the script owner's Google account and works
// correctly in all trigger contexts (time-based, event-based, or interactive).
// ============================================================

interface EmailPayload {
  to: string;
  cc?: string;
  subject: string;
  body: string;       // plain-text fallback (always required)
  htmlBody?: string;  // HTML version — shown by default in modern email clients
  triggerName?: string; // for audit log
  memberID?: string;    // for audit log
}

function sendEmail(payload: EmailPayload): void {
  const triggerName = payload.triggerName || 'sendEmail';
  const memberID    = payload.memberID    || '';
  try {
    MailApp.sendEmail({
      to:       payload.to,
      cc:       payload.cc || '',
      subject:  payload.subject,
      body:     payload.body,
      htmlBody: payload.htmlBody || undefined,
    } as GoogleAppsScript.Mail.MailAdvancedParameters);
    console.log('[email] sent to:', payload.to, 'cc:', payload.cc || 'none', 'subject:', payload.subject);

    // Audit log every outbound email
    auditLog('EMAIL_SENT', {
      memberID,
      email: payload.to,
      state: {
        subject:  payload.subject,
        to:       payload.to,
        cc:       payload.cc || '',
        trigger:  triggerName,
      },
    });
  } catch (e) {
    console.error('[email] failed to send to:', payload.to, 'error:', String(e));

    // Audit log failures so admin can spot broken email flows
    auditLog('EMAIL_SEND_FAILED', {
      memberID,
      email: payload.to,
      errorMessage: String(e),
      state: {
        subject:  payload.subject,
        to:       payload.to,
        cc:       payload.cc || '',
        trigger:  triggerName,
      },
    });
  }
}

// ── notifyPaymentApproved ──────────────────────────────────
// Sent when admin (or auto-reconcile) approves a payment event.
function notifyPaymentApproved(memberID: string, paymentIntent: string): void {
  const result = findMemberByID(memberID);
  if (!result) {
    console.warn('[notifyPaymentApproved] Member not found:', memberID);
    return;
  }

  const m = result.member;
  const adminEmail = getConfigValue('AdminEmails').split(',')[0]?.trim() || 'admin@mmrunners.org';

  const subject = `Thank you for Your ${paymentIntent} Payment - MMR Membership`;
  const body = `Hello ${m.firstName} ${m.lastName},

Your payment has been approved and processed successfully!

--- Your Updated Membership Profile ---
Member ID:              ${m.memberID}
Email:                  ${m.email}
Membership Type:        ${m.type}
Membership Expiration:  ${m.expiration || 'Not set'}
Status:                 ${m.status}
Payment Intent:         ${paymentIntent}

Thank you for your membership with Misty Mountain Runners. 🏃

If you have any questions, please contact us at ${adminEmail}.

Best regards,
Misty Mountain Runners`;

  sendEmail({
    to: m.email,
    cc: adminEmail,
    subject,
    body,
    triggerName: 'notifyPaymentApproved',
    memberID,
  });
}

// ── notifyPaymentRejected ──────────────────────────────────
// Sent when admin rejects a payment event.
function notifyPaymentRejected(memberID: string, reason: string): void {
  const result = findMemberByID(memberID);
  if (!result) {
    console.warn('[notifyPaymentRejected] Member not found:', memberID);
    return;
  }

  const m = result.member;
  const adminEmail = getConfigValue('AdminEmails').split(',')[0]?.trim() || 'admin@mmrunners.org';

  const subject = `Your MMR Membership Payment Was Rejected`;
  const body = `Hello ${m.firstName} ${m.lastName},

Unfortunately, your membership payment has been rejected by our admin team.

Reason: ${reason}

Member ID: ${m.memberID}
Membership Type: ${m.type}

Please contact us at ${adminEmail} for more information or to resubmit your payment.

Best regards,
Misty Mountain Runners`;

  sendEmail({
    to: m.email,
    cc: adminEmail,
    subject,
    body,
    triggerName: 'notifyPaymentRejected',
    memberID,
  });
}

// ── notifyPaymentExpired ───────────────────────────────────
// Sent when a pending payment proof event expires without being reviewed.
function notifyPaymentExpired(memberID: string, eventID: string): void {
  const result = findMemberByID(memberID);
  if (!result) {
    console.warn('[notifyPaymentExpired] Member not found:', memberID);
    return;
  }

  const m = result.member;
  const adminEmail = getConfigValue('AdminEmails').split(',')[0]?.trim() || 'admin@mmrunners.org';

  const subject = `⏰ Your MMR Membership Payment Proof Expired`;
  const body = `Hello ${m.firstName} ${m.lastName},

Your membership payment proof has expired without being verified or approved.

Event ID: ${eventID}
Member ID: ${m.memberID}
Membership Type: ${m.type}

If you believe this is a mistake or need to resubmit your payment, please contact us at ${adminEmail}.

Best regards,
Misty Mountain Runners`;

  sendEmail({
    to: m.email,
    cc: adminEmail,
    subject,
    body,
    triggerName: 'notifyPaymentExpired',
    memberID,
  });
}

// ── notifyAutoGuessMatch ───────────────────────────────────
// Sent when the auto-guess system matches a direct Zelle/Venmo payment
// (i.e. member paid without using the webapp) to a member record.
function notifyAutoGuessMatch(memberID: string, paymentIntent: string, transactionRef: string): void {
  const result = findMemberByID(memberID);
  if (!result) {
    console.warn('[notifyAutoGuessMatch] Member not found:', memberID);
    return;
  }

  const m = result.member;
  const adminEmail = getConfigValue('AdminEmails').split(',')[0]?.trim() || 'admin@mmrunners.org';

  const subject = `Your MMR Membership Payment Has Been Processed`;
  const body = `Hello ${m.firstName} ${m.lastName},

We received your ${paymentIntent} payment and have processed it for your membership.

--- Your Updated Membership Profile ---
Member ID:              ${m.memberID}
Email:                  ${m.email}
Membership Type:        ${m.type}
Membership Expiration:  ${m.expiration || 'Not set'}
Status:                 ${m.status}
Payment Intent:         ${paymentIntent}
Transaction Reference:  ${transactionRef || 'N/A'}

Note: Your payment was matched automatically based on your Member ID in the payment memo.
If you believe this is incorrect, please contact us at ${adminEmail}.

Thank you for your continued membership with Misty Mountain Runners! 🏃

Best regards,
Misty Mountain Runners`;

  sendEmail({
    to: m.email,
    cc: adminEmail,
    subject,
    body,
    triggerName: 'notifyAutoGuessMatch',
    memberID,
  });
}

// ── notifyExpirationRepaired ───────────────────────────────
// Sent when reviewPaymentHistory repairs a member's expiration date.
// Confirms the corrected expiration so the member is aware of the change.
function notifyExpirationRepaired(memberID: string, newExpiration: string): void {
  const result = findMemberByID(memberID);
  if (!result) {
    console.warn('[notifyExpirationRepaired] Member not found:', memberID);
    return;
  }

  const m = result.member;
  const adminEmail = getConfigValue('AdminEmails').split(',')[0]?.trim() || 'admin@mmrunners.org';
  const appUrl     = getConfigValue('AppBaseUrl') || 'https://mmrunners.org';

  const subject = `Your MMR Membership Profile Has Been Updated`;
  const body = `Hello ${m.firstName} ${m.lastName},

Your membership profile has been updated by our system as part of a routine payment verification.

--- Your Updated Membership Profile ---
Member ID:              ${m.memberID}
Email:                  ${m.email}
Membership Type:        ${m.type}
Membership Expiration:  ${newExpiration}
Status:                 ${m.status}

You can view your full profile at:
${appUrl}

If you believe this change is incorrect or have any questions, please contact us at ${adminEmail}.

Best regards,
Misty Mountain Runners`;

  sendEmail({
    to: m.email,
    cc: adminEmail,
    subject,
    body,
    triggerName: 'notifyExpirationRepaired',
    memberID,
  });
}

// ── notifyWelcome ──────────────────────────────────────────
// Sent to new members after their account is created.
function notifyWelcome(memberID: string): void {
  const result = findMemberByID(memberID);
  if (!result) {
    console.warn('[notifyWelcome] Member not found:', memberID);
    return;
  }

  const m = result.member;
  const adminEmail = getConfigValue('AdminEmails').split(',')[0]?.trim() || 'admin@mmrunners.org';
  const appUrl     = getConfigValue('AppBaseUrl') || 'https://mmrunners.org';

  const subject = `Welcome to Misty Mountain Runners! 🏃`;
  const body = `Hello ${m.firstName} ${m.lastName},

Welcome to Misty Mountain Runners! We're excited to have you as a member.

--- Your Member Profile ---
Member ID:       ${m.memberID}
Email:           ${m.email}
Membership Type: ${m.type}
Expiration:      ${m.expiration || 'Pending'}

You can log into your member portal at:
${appUrl}

If you have any questions, please contact us at ${adminEmail}.

Best regards,
Misty Mountain Runners`;

  sendEmail({
    to: m.email,
    cc: adminEmail,
    subject,
    body,
    triggerName: 'notifyWelcome',
    memberID,
  });
}

// ── HTML email shell ──────────────────────────────────────
// Wraps any inner HTML content in a consistent branded shell.
// All styles are inlined so they survive email clients that strip <head>.
function buildEmailHtml(innerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 16px;">
  <tr><td align="center">
    <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 20px rgba(0,0,0,0.08);">
      <!-- Header -->
      <tr><td style="background:#5c35a8;padding:28px 36px;text-align:center;">
        <div style="font-size:26px;margin-bottom:4px;">🏃</div>
        <div style="color:#ffffff;font-size:20px;font-weight:700;letter-spacing:-0.3px;">Misty Mountain Runners</div>
        <div style="color:rgba(255,255,255,0.7);font-size:13px;margin-top:4px;">New York Running Community</div>
      </td></tr>
      <!-- Body -->
      <tr><td style="padding:36px 36px 28px;">
        ${innerHtml}
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
</body></html>`;
}

// Shared CTA button used in HTML emails
function ctaButton(label: string, url: string): string {
  return `<table cellpadding="0" cellspacing="0" style="margin:28px auto 0;">
    <tr><td align="center" style="background:#5c35a8;border-radius:8px;">
      <a href="${url}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-size:15px;font-weight:700;text-decoration:none;letter-spacing:0.2px;">${label} &rarr;</a>
    </td></tr>
  </table>`;
}


// ── notifyIncompleteSignup ────────────────────────────────
// Sent to members whose account has an email + MemberID but no first/last name,
// meaning they started the join flow but never completed their profile.
function notifyIncompleteSignup(memberID: string, email: string): void {
  const adminEmail = getConfigValue('AdminEmails').split(',')[0]?.trim() || 'admin@mmrunners.org';
  const joinUrl    = 'https://sites.google.com/mmrunners.org/mmr/join-us';

  const subject = 'Welcome to Misty Mountain Runners — Finish Your Registration!';

  const htmlInner = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;font-weight:700;">Welcome! 🎉</h2>
    <p style="margin:0 0 18px;font-size:15px;color:#555555;line-height:1.6;">
      We're so excited you've taken the first step toward joining the Misty Mountain Runners family!
      We noticed your email was registered in our system, but your profile hasn't been completed yet.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:10px;padding:0;margin:0 0 20px;">
      <tr><td style="padding:18px 22px;">
        <div style="font-size:11px;color:#9b8ec4;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Your Member ID</div>
        <div style="font-size:26px;font-weight:800;color:#5c35a8;letter-spacing:1px;">${memberID}</div>
      </td></tr>
    </table>
    <p style="margin:0 0 8px;font-size:15px;color:#555555;line-height:1.6;">
      Completing your registration takes just a minute and unlocks your member portal, race results tracking, and more.
    </p>
    ${ctaButton('Complete My Registration', joinUrl)}
    <p style="margin:24px 0 0;font-size:13px;color:#999999;text-align:center;line-height:1.5;">
      If you didn't sign up or have any questions, simply reply to this email and we'll sort it out right away.
    </p>`;

  const body = `Welcome to Misty Mountain Runners!\n\nYour Member ID is: ${memberID}\n\nWe noticed your registration wasn't completed. Please visit ${joinUrl} to finish setting up your profile.\n\nSee you on the trails!\nMisty Mountain Runners`;

  sendEmail({
    to:          email,
    cc:          adminEmail,
    subject,
    body,
    htmlBody:    buildEmailHtml(htmlInner),
    triggerName: 'notifyIncompleteSignup',
    memberID,
  });
}


// ── notifyRenewalReminder ─────────────────────────────────
// Sent to members whose membership is inactive or expiring within 2 weeks.
// Personalised with the member's first name, expiration date, and membership type.
function notifyRenewalReminder(memberID: string): void {
  const result = findMemberByID(memberID);
  if (!result) {
    console.warn('[notifyRenewalReminder] Member not found:', memberID);
    return;
  }

  const m          = result.member;
  const adminEmail = getConfigValue('AdminEmails').split(',')[0]?.trim() || 'admin@mmrunners.org';
  const portalUrl  = 'https://sites.google.com/mmrunners.org/mmr/join-us/member-portal';
  const firstName  = m.firstName || 'there';

  const isExpired  = m.status === 'inactive';
  const expLabel   = m.expiration ? toISODateString(m.expiration) || m.expiration : '—';

  const subject = isExpired
    ? `${firstName}, your MMR membership has expired — renew today!`
    : `${firstName}, your MMR membership is expiring soon 🏃`;

  const statusColor = isExpired ? '#c62828' : '#e65100';
  const statusBg    = isExpired ? '#fdecea'  : '#fff3e0';
  const statusText  = isExpired ? 'Expired'  : `Expires ${expLabel}`;

  const htmlInner = `
    <h2 style="margin:0 0 8px;font-size:22px;color:#222222;font-weight:700;">Hi ${firstName}! 👋</h2>
    <p style="margin:0 0 20px;font-size:15px;color:#555555;line-height:1.6;">
      ${isExpired
        ? 'We miss seeing you on the trails! Your Misty Mountain Runners membership has expired — renew now to stay connected with the crew.'
        : 'The trails are calling! Your Misty Mountain Runners membership is coming up for renewal. Renew early to keep your streak going and stay connected with the crew.'}
    </p>

    <!-- Membership card -->
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:10px;margin:0 0 20px;">
      <tr><td style="padding:20px 22px;">
        <table width="100%" cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:0 20px 0 0;">
              <div style="font-size:11px;color:#9b8ec4;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px;">Member ID</div>
              <div style="font-size:18px;font-weight:800;color:#5c35a8;">${m.memberID}</div>
            </td>
            <td>
              <div style="font-size:11px;color:#9b8ec4;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px;">Type</div>
              <div style="font-size:15px;font-weight:600;color:#333333;">${m.type || 'Individual'}</div>
            </td>
          </tr>
          <tr><td colspan="2" style="padding-top:14px;">
            <div style="font-size:11px;color:#9b8ec4;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:3px;">Membership Status</div>
            <div style="display:inline-block;padding:4px 14px;background:${statusBg};color:${statusColor};border-radius:20px;font-size:13px;font-weight:700;">${statusText}</div>
          </td></tr>
        </table>
      </td></tr>
    </table>

    <p style="margin:0 0 8px;font-size:15px;color:#555555;line-height:1.6;">
      Renewing is quick and easy through your member portal. We accept Zelle and Venmo — no sign-up fees, no hassle.
    </p>
    ${ctaButton('Renew My Membership', portalUrl)}
    <p style="margin:24px 0 0;font-size:13px;color:#999999;text-align:center;line-height:1.5;">
      Questions? Just reply to this email or reach us at
      <a href="mailto:${adminEmail}" style="color:#5c35a8;text-decoration:none;">${adminEmail}</a>
    </p>`;

  const body = `Hi ${firstName},\n\n${isExpired ? 'Your Misty Mountain Runners membership has expired.' : 'Your Misty Mountain Runners membership is expiring soon.'}\n\nMember ID: ${m.memberID}\nType: ${m.type || 'Individual'}\nStatus: ${statusText}\n\nRenew your membership at:\n${portalUrl}\n\nSee you on the trails!\nMisty Mountain Runners`;

  sendEmail({
    to:          m.email,
    cc:          adminEmail,
    subject,
    body,
    htmlBody:    buildEmailHtml(htmlInner),
    triggerName: 'notifyRenewalReminder',
    memberID,
  });
}


(globalThis as any).sendEmail                  = sendEmail;
(globalThis as any).notifyPaymentApproved    = notifyPaymentApproved;
(globalThis as any).notifyPaymentRejected    = notifyPaymentRejected;
(globalThis as any).notifyPaymentExpired     = notifyPaymentExpired;
(globalThis as any).notifyAutoGuessMatch     = notifyAutoGuessMatch;
(globalThis as any).notifyExpirationRepaired = notifyExpirationRepaired;
(globalThis as any).notifyIncompleteSignup   = notifyIncompleteSignup;
(globalThis as any).notifyRenewalReminder    = notifyRenewalReminder;
(globalThis as any).notifyWelcome            = notifyWelcome;
