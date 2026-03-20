// ============================================================
// Outbound reminder email campaigns
// Depends on: config.ts, sheets.ts, email.ts, logger.ts
//
// Exposed GAS functions:
//   sendIncompleteSignupReminders  — one-off or scheduled
//   sendRenewalReminders           — scheduled daily (default 50 emails/run)
// ============================================================

// Days between successive reminders of the same type to the same member.
const REMINDER_THROTTLE_DAYS = 8;

// Days before expiration to start sending renewal reminders.
const RENEWAL_LOOKAHEAD_DAYS = 14;


// ── sendIncompleteSignupReminders ─────────────────────────
//
// Finds every member whose account has an email address and a MemberID
// but no first or last name — meaning they entered their email in the Join Us
// app but never finished signing up.
//
// For each such member:
//   - Skip if reminded within the last REMINDER_THROTTLE_DAYS days
//   - Send a welcoming HTML email encouraging them to complete registration
//   - Log the send to Outbound-Emails
//
// Safe to run on a schedule or on-demand.  Idempotent within the throttle window.
// ============================================================
function sendIncompleteSignupReminders(): { sent: number; skipped: number; errors: number } {
  console.log('[mmr][sendIncompleteSignupReminders] starting');
  const stats  = { sent: 0, skipped: 0, errors: 0 };
  const now    = new Date();
  const throttleMs = REMINDER_THROTTLE_DAYS * 86_400_000;

  // Build throttle map: memberID → ISO timestamp of last IncompleteSignup reminder
  const lastReminderMap = buildLastReminderMap('IncompleteSignup');

  // Scan Membership Master for incomplete accounts
  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const memberID  = String(data[i][MM_COL.MEMBER_ID]  || '').trim();
    const email     = String(data[i][MM_COL.EMAIL]       || '').trim();
    const firstName = String(data[i][MM_COL.FIRST_NAME]  || '').trim();
    const lastName  = String(data[i][MM_COL.LAST_NAME]   || '').trim();

    // Must have both memberID and email, but NO name
    if (!memberID || !email) continue;
    if (firstName || lastName) continue;

    // Throttle: skip if reminded recently
    const lastTs = lastReminderMap[memberID];
    if (lastTs) {
      const ageMs = now.getTime() - new Date(lastTs).getTime();
      if (ageMs < throttleMs) {
        console.log(`[mmr][sendIncompleteSignupReminders] skipping ${memberID} — reminded ${Math.floor(ageMs / 86_400_000)} days ago`);
        stats.skipped++;
        continue;
      }
    }

    try {
      const subject = 'Welcome to Misty Mountain Runners — Finish Your Registration!';
      notifyIncompleteSignup(memberID, email);

      appendOutboundEmailLog({
        memberID,
        email,
        reminderType: 'IncompleteSignup',
        subject,
        status:       'sent',
        notes:        'No first/last name on file',
      });

      auditLog('INCOMPLETE_SIGNUP_REMINDER_SENT', { memberID, email: email });
      console.log(`[mmr][sendIncompleteSignupReminders] sent to ${memberID} <${email}>`);
      stats.sent++;

    } catch (err) {
      console.error(`[mmr][sendIncompleteSignupReminders] error for ${memberID}:`, String(err));
      appendOutboundEmailLog({
        memberID,
        email,
        reminderType: 'IncompleteSignup',
        subject:      'Welcome to Misty Mountain Runners — Finish Your Registration!',
        status:       'failed',
        notes:        String(err),
      });
      auditLog('INCOMPLETE_SIGNUP_REMINDER_FAILED', { memberID, email: email, errorMessage: String(err) });
      stats.errors++;
    }
  }

  console.log(`[mmr][sendIncompleteSignupReminders] done — sent: ${stats.sent}, skipped: ${stats.skipped}, errors: ${stats.errors}`);
  return stats;
}


// ── sendRenewalReminders ──────────────────────────────────
//
// Sends personalised renewal reminder emails to members whose membership is
// either already inactive OR expiring within RENEWAL_LOOKAHEAD_DAYS days.
//
// Selection algorithm (prevents spam, spaces out reminders):
//   1. Eligible pool: inactive OR expiring within 14 days
//   2. Exclude anyone reminded within the last REMINDER_THROTTLE_DAYS days
//   3. Sort by last-reminded-at ascending (never-reminded accounts come first)
//   4. Send up to `numEmails` (default 50) per invocation
//
// Designed to run on a daily time-based trigger.  At 50 emails/day the full
// membership list is covered roughly every 3 days; the 8-day throttle means
// no member receives more than one reminder per cycle.
// ============================================================
function sendRenewalReminders(numEmails: number = 50): { sent: number; skipped: number; errors: number } {
  console.log(`[mmr][sendRenewalReminders] starting, numEmails=${numEmails}`);
  const stats      = { sent: 0, skipped: 0, errors: 0 };
  const now        = new Date();
  now.setHours(0, 0, 0, 0);
  const throttleMs = REMINDER_THROTTLE_DAYS * 86_400_000;
  const cutoff     = new Date(now);
  cutoff.setDate(cutoff.getDate() + RENEWAL_LOOKAHEAD_DAYS);

  // Build throttle map: memberID → last RenewalReminder send time
  const lastReminderMap = buildLastReminderMap('RenewalReminder');

  // ── Collect eligible members in a single sheet scan ──────
  interface Candidate {
    memberID:    string;
    email:       string;
    lastSentMs:  number; // 0 = never sent
  }
  const candidates: Candidate[] = [];

  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const memberID  = String(data[i][MM_COL.MEMBER_ID]  || '').trim();
    const email     = String(data[i][MM_COL.EMAIL]       || '').trim();
    const status    = String(data[i][MM_COL.STATUS]      || '').toLowerCase().trim();
    const expRaw    = data[i][MM_COL.EXPIRATION];

    if (!memberID || !email) continue;

    // Eligibility: inactive or expiring within the lookahead window
    let eligible = false;
    if (status === 'inactive') {
      eligible = true;
    } else {
      const isoExp = toISODateString(String(expRaw || ''));
      if (isoExp) {
        const expDate = new Date(isoExp);
        if (expDate <= cutoff) eligible = true;
      }
    }
    if (!eligible) continue;

    // Throttle check
    const lastTs  = lastReminderMap[memberID];
    const lastMs  = lastTs ? new Date(lastTs).getTime() : 0;
    if (lastMs > 0 && (now.getTime() - lastMs) < throttleMs) {
      stats.skipped++;
      continue;
    }

    candidates.push({ memberID, email, lastSentMs: lastMs });
  }

  // Sort: never-reminded first (lastSentMs = 0), then oldest-reminded first
  candidates.sort((a, b) => a.lastSentMs - b.lastSentMs);

  console.log(`[mmr][sendRenewalReminders] ${candidates.length} eligible candidates, sending up to ${numEmails}`);

  // ── Send up to numEmails ──────────────────────────────────
  const batch = candidates.slice(0, numEmails);

  for (const c of batch) {
    try {
      const m = findMemberByID(c.memberID);
      if (!m) {
        console.warn(`[mmr][sendRenewalReminders] member not found: ${c.memberID}`);
        stats.skipped++;
        continue;
      }

      const subject = m.member.status === 'inactive'
        ? `${m.member.firstName || 'there'}, your MMR membership has expired — renew today!`
        : `${m.member.firstName || 'there'}, your MMR membership is expiring soon 🏃`;

      notifyRenewalReminder(c.memberID);

      appendOutboundEmailLog({
        memberID:     c.memberID,
        email:        c.email,
        reminderType: 'RenewalReminder',
        subject,
        status:       'sent',
        notes:        `status=${m.member.status} exp=${toISODateString(m.member.expiration) || m.member.expiration || '—'}`,
      });

      auditLog('RENEWAL_REMINDER_SENT', { memberID: c.memberID, email: c.email });
      console.log(`[mmr][sendRenewalReminders] sent to ${c.memberID} <${c.email}>`);
      stats.sent++;

    } catch (err) {
      console.error(`[mmr][sendRenewalReminders] error for ${c.memberID}:`, String(err));
      appendOutboundEmailLog({
        memberID:     c.memberID,
        email:        c.email,
        reminderType: 'RenewalReminder',
        subject:      '(failed)',
        status:       'failed',
        notes:        String(err),
      });
      auditLog('RENEWAL_REMINDER_FAILED', { memberID: c.memberID, email: c.email, errorMessage: String(err) });
      stats.errors++;
    }
  }

  console.log(`[mmr][sendRenewalReminders] done — sent: ${stats.sent}, skipped: ${stats.skipped}, errors: ${stats.errors}`);
  auditLog('RENEWAL_REMINDER_BATCH_COMPLETE', {
    state: { sent: stats.sent, skipped: stats.skipped, errors: stats.errors, batchSize: numEmails },
  });

  return stats;
}


(globalThis as any).sendIncompleteSignupReminders = sendIncompleteSignupReminders;
(globalThis as any).sendRenewalReminders          = sendRenewalReminders;
