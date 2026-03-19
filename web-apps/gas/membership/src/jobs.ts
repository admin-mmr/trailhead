// ============================================================
// Scheduled jobs: proof expiry checker, membership expiry checker
// Depends on: config.ts, sheets.ts, email.ts, logger.ts
// Exposed GAS functions: expirePaymentProofs, expireInactiveMemberships
// ============================================================

/**
 * Scheduled job: expire payment proofs after PaymentProofReviewDays.
 *
 * For each WebApp-Events row with M_Status = "Pending" and ExpiresAt < now:
 * 1. Set M_Status = "Expired"
 * 2. Send notification email to the member
 * 3. Log PROOF_EXPIRED action
 * 4. Member's Status in Main table remains pending_upgrade (Proof Required sub-state)
 *
 * This job is typically triggered on a nightly schedule (e.g., 2 AM daily).
 */
function expirePaymentProofs(): void {
  try {
    console.log('[mmr][expirePaymentProofs] starting proof expiry check');
    const now = new Date();
    const nowISO = now.toISOString();
    let expiredCount = 0;

    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const eventID = String(data[i][WE_COL.EVENT_ID]);
      const status = String(data[i][WE_COL.STATUS]);
      const expiresAtStr = String(data[i][WE_COL.EXPIRES_AT]);
      const memberID = String(data[i][WE_COL.MEMBER_ID]);

      // Only process Pending events
      if (status !== 'Pending') continue;

      // Check if expired
      if (!expiresAtStr || expiresAtStr.trim() === '') continue;
      const expiresAt = new Date(expiresAtStr);
      if (isNaN(expiresAt.getTime())) {
        console.warn(`[expirePaymentProofs] invalid expiresAt for eventID ${eventID}`);
        continue;
      }

      // If not yet expired, skip
      if (expiresAt > now) continue;

      // Expired: update status to Expired
      console.log(`[expirePaymentProofs] expiring eventID: ${eventID}, memberID: ${memberID}`);
      sheet.getRange(i + 1, WE_COL.STATUS + 1).setValue('Expired');
      expiredCount++;

      // Send notification email to member
      try {
        notifyPaymentExpired(memberID, eventID);
      } catch (emailErr) {
        console.error(`[expirePaymentProofs] failed to send expiration email for ${memberID}:`, String(emailErr));
      }

      // Log the action
      try {
        auditLog('PROOF_EXPIRED', {
          eventID,
          memberID,
          state: { expiresAt: expiresAtStr },
        });
      } catch (logErr) {
        console.error(`[expirePaymentProofs] failed to log for ${eventID}:`, String(logErr));
      }
    }

    console.log(`[mmr][expirePaymentProofs] completed, expired ${expiredCount} proofs`);
  } catch (e) {
    console.error('[mmr][expirePaymentProofs] error:', String(e));
  }
}

/**
 * Scheduled job: mark active members as inactive when their expiration date has passed.
 *
 * For each row in Membership-Master-Main-3 with Status = "active" and Expiration < today:
 * 1. Set Status = "inactive"
 * 2. Update LastUpdated timestamp
 * 3. Log the change to Membership-Master-Log
 * 4. Optionally send a courtesy notification (not required by PRDv4, but helpful)
 *
 * This job is typically triggered on a nightly schedule (e.g., 2 AM daily).
 */
function expireInactiveMemberships(): void {
  try {
    console.log('[mmr][expireInactiveMemberships] starting membership expiry check');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const now = new Date().toISOString();
    let expiredCount = 0;

    const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const memberID = String(data[i][MM_COL.MEMBER_ID]);
      const status = String(data[i][MM_COL.STATUS]).toLowerCase();
      const expirationStr = String(data[i][MM_COL.EXPIRATION]);

      // Only process active members
      if (status !== 'active') continue;

      // Check if expiration is in the past
      if (!expirationStr || expirationStr.trim() === '') continue;
      const expiration = new Date(expirationStr);
      if (isNaN(expiration.getTime())) {
        console.warn(`[expireInactiveMemberships] invalid expiration for memberID ${memberID}`);
        continue;
      }

      // If not yet expired, skip
      if (expiration >= today) continue;

      // Expired: update status to inactive
      console.log(`[expireInactiveMemberships] marking inactive: memberID: ${memberID}, expiration: ${expirationStr}`);

      // Log before write (required by PRDv4 §2.2)
      logMainTableRow(memberID);

      // Update member status
      sheet.getRange(i + 1, MM_COL.STATUS + 1).setValue('inactive');
      sheet.getRange(i + 1, MM_COL.LAST_UPDATED + 1).setValue(now);
      expiredCount++;

      // Audit log the change
      try {
        auditLog('MEMBERSHIP_EXPIRED', {
          memberID,
          state: { expiration: expirationStr, timestamp: now },
        });
      } catch (logErr) {
        console.error(`[expireInactiveMemberships] failed to log for ${memberID}:`, String(logErr));
      }
    }

    console.log(`[mmr][expireInactiveMemberships] completed, expired ${expiredCount} members`);
  } catch (e) {
    console.error('[mmr][expireInactiveMemberships] error:', String(e));
  }
}

// ── Schedule trigger setup ──
// In Google Apps Script, create a trigger via script.google.com for these functions:
// 1. expirePaymentProofs — recommended: nightly at 2 AM
// 2. expireInactiveMemberships — recommended: nightly at 2 AM
//
// Or call these functions manually from the Admin panel for testing.

(globalThis as any).expirePaymentProofs        = expirePaymentProofs;
(globalThis as any).expireInactiveMemberships  = expireInactiveMemberships;
