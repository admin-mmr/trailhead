// ============================================================
// Email notifications for payment approvals, rejections, expirations
// Depends on: config.ts, sheets.ts
// ============================================================

interface EmailPayload {
  to: string;
  cc?: string;
  subject: string;
  body: string;
}

function sendEmail(payload: EmailPayload): void {
  try {
    const cc = payload.cc ? [payload.cc] : undefined;
    GmailApp.sendEmail(payload.to, payload.subject, payload.body, {
      cc: cc?.join(','),
      from: Session.getActiveUser().getEmail(),
    });
    console.log('[email] sent to:', payload.to, 'cc:', payload.cc || 'none');
  } catch (e) {
    console.error('[email] failed to send:', String(e));
  }
}

// ── notifyPaymentApproved ──────────────────────────────────
// Send approval email to member with updated profile info
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
    // cc: adminEmail,
    subject,
    body,
  });
}

// ── notifyPaymentRejected ──────────────────────────────────
// Send rejection email to member and admin
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
  });
}

// ── notifyPaymentExpired ───────────────────────────────────
// Send expiration notice to member and admin
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
  });
}

(globalThis as any).sendEmail                = sendEmail;
(globalThis as any).notifyPaymentApproved    = notifyPaymentApproved;
(globalThis as any).notifyPaymentRejected    = notifyPaymentRejected;
(globalThis as any).notifyPaymentExpired     = notifyPaymentExpired;
