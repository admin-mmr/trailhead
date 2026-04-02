// ============================================================
// Scheduled jobs: proof expiry, membership expiry, payment guessing,
//                 payment history repair
// Depends on: config.ts, sheets.ts, email.ts, logger.ts
// Exposed GAS functions:
//   expirePaymentProofs        — nightly, expire unreviewed proof events
//   expireInactiveMemberships  — nightly, mark expired members inactive
//   autoMatchUnmatchedPayments — nightly (within collection window) + manual button
//   reviewPaymentHistory       — nightly + manual; repair missing/wrong expiration dates
// ============================================================


// toISODateString() is defined in sheets.ts (canonical, local-date extraction).

// ── computeMembershipExpiration ───────────────────────────
// Shared helper: given a base date, the member's current expiration string,
// the number of renewal years, and an optional fixed membership year-end date,
// returns the ISO (YYYY-MM-DD) expiration date string.
//
// Two modes:
//
//   Fixed year-end (membershipYearEnd is set, e.g. "2027-03-31"):
//     Everyone in this membership cycle expires on the same calendar date.
//     Result = max(membershipYearEnd, currentExpiration)   — never regress.
//     renewalYears is ignored in this mode.
//
//   Rolling (membershipYearEnd is blank / not configured):
//     Result = max(baseDate + renewalYears, currentExpiration + renewalYears)
//     Renewals stack: a member already active through 2027-03-31 who pays again
//     extends to 2028-03-31, not just today + 1 year.
function computeMembershipExpiration(
  baseDate: Date,
  currentExpiration: string,
  renewalYears: number,
  membershipYearEnd?: string
): string {
  // ── Fixed year-end mode ──────────────────────────────────
  if (membershipYearEnd && membershipYearEnd.trim()) {
    const yearEnd = new Date(membershipYearEnd.trim());
    if (!isNaN(yearEnd.getTime())) {
      let result = yearEnd;
      if (currentExpiration && currentExpiration.trim()) {
        const current = new Date(currentExpiration);
        if (!isNaN(current.getTime()) && current > yearEnd) result = current;
      }
      return result.toISOString().split('T')[0];
    }
  }

  // ── Rolling mode ─────────────────────────────────────────
  let newExpiration = new Date(baseDate);
  newExpiration.setFullYear(newExpiration.getFullYear() + renewalYears);

  if (currentExpiration && currentExpiration.trim()) {
    const current = new Date(currentExpiration);
    if (!isNaN(current.getTime()) && current > baseDate) {
      const extended = new Date(current);
      extended.setFullYear(extended.getFullYear() + renewalYears);
      if (extended > newExpiration) newExpiration = extended;
    }
  }

  return newExpiration.toISOString().split('T')[0];
}


// ── extractMemberIDFromMemo ────────────────────────────────
// Scan a memo/note string for a valid MemberID (format: A0001 through A9999).
// Returns the first match or null if none found.
function extractMemberIDFromMemo(memo: string): string | null {
  if (!memo || memo.trim() === '') return null;
  // Case-insensitive match for A followed by exactly 4 digits, word-boundary aware
  const match = memo.match(/\b(A\d{4})\b/i);
  return match ? match[1].toUpperCase() : null;
}


// ── isWithinCollectionWindow ──────────────────────────────
// Returns true if the given date (defaults to today) falls within the
// configured membership collection window [MembershipCollectionStart, MembershipCollectionEnd].
// Both endpoints are inclusive. Returns false if either config value is missing or invalid.
function isWithinCollectionWindow(checkDate?: Date): boolean {
  const startStr = getConfigValue('MembershipCollectionStart').trim();
  const endStr   = getConfigValue('MembershipCollectionEnd').trim();

  if (!startStr || !endStr) {
    console.warn('[jobs] MembershipCollectionStart or MembershipCollectionEnd not configured — skipping window check');
    return false;
  }

  const start = new Date(startStr);
  const end   = new Date(endStr);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    console.warn('[jobs] Invalid collection window dates:', startStr, endStr);
    return false;
  }

  const target = checkDate ? new Date(checkDate) : new Date();
  return target >= start && target <= end;
}


// ============================================================
// autoMatchUnmatchedPayments
//
// Payment guessing logic for the membership collection period.
//
// Problem: Many members pay $30 or $50 directly via Zelle/Venmo without
// opening the webapp. There is no payment_events row to match against.
// This function handles those "orphan" Gmail payments by guessing intent
// from the amount and extracting MemberID from the memo field.
//
// Safety guardrails:
//   - Only runs within the configured MembershipCollectionStart/End window
//   - Only processes amounts of exactly $30 or $50
//   - MemberID must be present and valid in the memo
//   - Each Gmail message is processed at most once (keyed on messageId/rowIndex)
//   - All guessed matches are logged with source='AutoGuess' and are reviewable
//
// Can be triggered:
//   - Automatically: called from autoReconcile() when within collection window
//   - Manually: via "Run Auto-Match" button in Admin UI → triggerAutoMatch()
// ============================================================
function autoMatchUnmatchedPayments(): { matched: number; skipped: number; errors: number } {
  console.log('[mmr][autoMatchUnmatchedPayments] starting');

  const stats = { matched: 0, skipped: 0, errors: 0 };

  // Guard: only run within the collection window
  if (!isWithinCollectionWindow()) {
    const startStr = getConfigValue('MembershipCollectionStart') || '(not set)';
    const endStr   = getConfigValue('MembershipCollectionEnd')   || '(not set)';
    console.log(`[mmr][autoMatchUnmatchedPayments] outside collection window [${startStr} – ${endStr}], skipping`);
    auditLog('AUTO_GUESS_SKIPPED_OUTSIDE_WINDOW', {
      state: { collectionStart: startStr, collectionEnd: endStr },
    });
    return stats;
  }

  const renewalYears      = parseInt(getConfigValue('MembershipRenewalYears') || '1', 10) || 1;
  const membershipYearEnd = getConfigValue('MembershipYearEnd').trim();
  const individualPrice   = parseFloat(getConfigValue('IndividualPrice') || '30');
  const familyPrice       = parseFloat(getConfigValue('FamilyPrice')     || '50');
  const now = new Date().toISOString();

  // Parse collection window boundaries (for per-row date filtering)
  const startStr = getConfigValue('MembershipCollectionStart').trim();
  const endStr   = getConfigValue('MembershipCollectionEnd').trim();
  const windowStart = new Date(startStr);
  const windowEnd   = new Date(endStr);
  windowStart.setHours(0, 0, 0, 0);
  windowEnd.setHours(23, 59, 59, 999);

  // Get all unprocessed Gmail rows
  const unmatchedRows = getUnmatchedGmailPayments();
  console.log(`[mmr][autoMatchUnmatchedPayments] found ${unmatchedRows.length} unprocessed Gmail rows`);

  for (const gmailRow of unmatchedRows) {
    try {
      // ── 1. Filter: transaction must be within collection window ──
      const txDateStr = gmailRow.transactionDate || gmailRow.timestamp;
      if (!txDateStr) {
        console.log(`[mmr][autoMatchUnmatchedPayments] skipping row ${gmailRow.rowIndex} — no transaction date`);
        stats.skipped++;
        continue;
      }
      const txDate = new Date(txDateStr);
      if (isNaN(txDate.getTime()) || txDate < windowStart || txDate > windowEnd) {
        console.log(`[mmr][autoMatchUnmatchedPayments] skipping row ${gmailRow.rowIndex} — date ${txDateStr} outside window`);
        stats.skipped++;
        continue;
      }

      // ── 2. Filter: amount must be exactly IndividualPrice or FamilyPrice ──
      const amount = gmailRow.amount;
      if (amount !== individualPrice && amount !== familyPrice) {
        console.log(`[mmr][autoMatchUnmatchedPayments] skipping row ${gmailRow.rowIndex} — amount ${amount} not $${individualPrice} or $${familyPrice}`);
        stats.skipped++;
        continue;
      }

      // ── 3. Extract MemberID from memo ──
      const combinedMemo = [gmailRow.memo, gmailRow.originalMemo].join(' ');
      const memberID = extractMemberIDFromMemo(combinedMemo);
      if (!memberID) {
        console.log(`[mmr][autoMatchUnmatchedPayments] skipping row ${gmailRow.rowIndex} — no MemberID found in memo: "${combinedMemo}"`);
        stats.skipped++;
        continue;
      }

      // ── 4. Verify member exists ──
      const memberResult = findMemberByID(memberID);
      if (!memberResult) {
        console.warn(`[mmr][autoMatchUnmatchedPayments] skipping row ${gmailRow.rowIndex} — MemberID ${memberID} not found in master`);
        auditLog('AUTO_GUESS_MEMBER_NOT_FOUND', {
          memberID,
          state: { rowIndex: gmailRow.rowIndex, memo: combinedMemo, amount },
        });
        stats.skipped++;
        continue;
      }

      // ── 5. Determine payment intent from amount ──
      const paymentIntent: PaymentIntent = amount === familyPrice
        ? 'Family Membership'
        : 'Individual Membership';

      // ── 6. Determine which members to update ──
      //    For Family Membership, update all members sharing the same FamilyID.
      //    For Individual Membership, update only the primary member.
      const primaryMember = memberResult.member;
      let membersToUpdate: Array<{ member: Member; rowIndex: number }> = [];

      if (paymentIntent === 'Family Membership' && primaryMember.familyID) {
        membersToUpdate = findMembersByFamilyID(primaryMember.familyID);
        if (membersToUpdate.length === 0) membersToUpdate = [memberResult];
      } else {
        membersToUpdate = [memberResult];
      }

      // ── 7. Compute new expiration date ──
      const newExpiration = computeMembershipExpiration(
        txDate,
        primaryMember.expiration,
        renewalYears,
        membershipYearEnd
      );
      const periodStart = txDate.toISOString().split('T')[0];

      console.log(`[mmr][autoMatchUnmatchedPayments] matching row ${gmailRow.rowIndex}: MemberID=${memberID}, intent=${paymentIntent}, amount=${amount}, newExp=${newExpiration}`);

      // ── 8. Write Payment-History record (no WebApp-Events row for this path) ──
      const paymentID = appendPaymentRecord({
        eventID:              '',   // no webapp event — direct payment path
        memberID:             primaryMember.memberID,
        paymentDate:          txDate.toISOString().split('T')[0],
        amount,
        paymentIntent,
        paymentMethod:        gmailRow.source || 'Unknown',
        payerName:            gmailRow.sender || '',
        memoField:            gmailRow.memo   || '',
        last4Digits:          '',
        transactionReference: gmailRow.transactionNumber || '',
        periodStart,
        periodEnd:            newExpiration,
        processedBy:          'auto-guess@system',
        processedDate:        now,
        source:               'AutoGuess',
        notes:                `Auto-matched by payment guessing: MemberID ${memberID} found in memo, amount $${amount} → ${paymentIntent}`,
      });

      // ── 9. Update Membership Master for each affected member ──
      const memberType = paymentIntent === 'Family Membership' ? 'Family' : 'Individual';
      for (const { member: fm } of membersToUpdate) {
        updateMemberWithLog(fm.memberID, {
          EXPIRATION:          newExpiration,
          TYPE:                memberType,
          STATUS:              'active',
          MEMBERSHIP_FEE_PAID: amount,
          PAYMENT_DATE:        now,
          PAYMENT_TRANSACTION: gmailRow.transactionNumber || '',
          LAST_UPDATED:        now,
        });
      }

      // ── 10. Mark the Gmail row as processed ──
      // Use the PaymentID as the reference since there is no EventID
      const gmailSheet = getSheet(SHEET_NAMES.FETCH_GMAIL);
      gmailSheet.getRange(gmailRow.rowIndex, FG_COL.PROCESSED + 1).setValue(now);
      gmailSheet.getRange(gmailRow.rowIndex, FG_COL.PAYMENT_ID + 1).setValue(paymentID);
      gmailSheet.getRange(gmailRow.rowIndex, FG_COL.SOURCE + 1).setValue('AutoGuess');

      // ── 11. Audit log ──
      auditLog('AUTO_GUESS_MATCH', {
        memberID: primaryMember.memberID,
        state: {
          paymentID,
          amount,
          paymentIntent,
          transactionNumber: gmailRow.transactionNumber,
          newExpiration,
          updatedMembers: membersToUpdate.map(r => r.member.memberID),
        },
      });

      // ── 12. Send confirmation email to member ──
      try {
        notifyAutoGuessMatch(primaryMember.memberID, paymentIntent, gmailRow.transactionNumber || '');
      } catch (emailErr) {
        console.error(`[mmr][autoMatchUnmatchedPayments] email failed for ${primaryMember.memberID}:`, String(emailErr));
      }

      stats.matched++;

    } catch (rowErr) {
      console.error(`[mmr][autoMatchUnmatchedPayments] error processing row ${gmailRow.rowIndex}:`, String(rowErr));
      auditLog('AUTO_GUESS_ERROR', {
        state: { rowIndex: gmailRow.rowIndex, error: String(rowErr) },
      });
      stats.errors++;
    }
  }

  console.log(`[mmr][autoMatchUnmatchedPayments] done — matched: ${stats.matched}, skipped: ${stats.skipped}, errors: ${stats.errors}`);
  auditLog('AUTO_GUESS_COMPLETE', {
    state: { matched: stats.matched, skipped: stats.skipped, errors: stats.errors },
  });

  return stats;
}


// ============================================================
// reviewPaymentHistory
//
// Scans every row in Payment-History and checks whether the corresponding
// member's Expiration date in Membership Master is correct and up-to-date.
// Repairs any rows where it is missing or wrong.
//
// Useful after:
//   - Bulk imports of historical payment data
//   - Manual entry of payment records
//   - Auto-guess runs (to verify they applied correctly)
//   - Any admin workflow that creates Payment-History without updating the member row
//
// Safe to run multiple times — it only writes when a repair is actually needed.
// ============================================================
function reviewPaymentHistory(): { reviewed: number; repaired: number; skipped: number } {
  console.log('[mmr][reviewPaymentHistory] starting');

  const stats = { reviewed: 0, repaired: 0, skipped: 0 };
  const renewalYears      = parseInt(getConfigValue('MembershipRenewalYears') || '1', 10) || 1;
  const membershipYearEnd = getConfigValue('MembershipYearEnd').trim();
  const now = new Date().toISOString();

  const MEMBERSHIP_INTENTS = new Set<string>([
    'Individual Membership',
    'Family Membership',
  ]);
  // Note: 'Family Upgrade' is excluded — it changes the Type but not the Expiration date.

  const phSheet = getSheet(SHEET_NAMES.PAYMENT_HISTORY);
  const phData  = phSheet.getDataRange().getValues();

  // Process newest payments first so that if a member has multiple entries,
  // the most recent one "wins" when we check the current expiration state.
  // We collect all rows, sort by PaymentDate descending, then process.
  interface ReviewRow {
    memberID:      string;
    paymentIntent: string;
    paymentDate:   string;
    periodEnd:     string;
    rowNum:        number; // 1-based spreadsheet row
  }

  const rows: ReviewRow[] = [];
  for (let i = 1; i < phData.length; i++) {
    const memberID      = String(phData[i][PH_COL.MEMBER_ID]      || '').trim();
    const paymentIntent = String(phData[i][PH_COL.PAYMENT_INTENT] || '').trim();
    const paymentDate   = String(phData[i][PH_COL.PAYMENT_DATE]   || '').trim();
    const periodEnd     = String(phData[i][PH_COL.PERIOD_END]     || '').trim();

    if (!MEMBERSHIP_INTENTS.has(paymentIntent)) continue;

    rows.push({ memberID, paymentIntent, paymentDate, periodEnd, rowNum: i + 1 });
  }

  // Sort by paymentDate descending (most recent first) so that when we repair,
  // the most recent payment sets the final expiration.
  rows.sort((a, b) => {
    const dA = new Date(a.paymentDate);
    const dB = new Date(b.paymentDate);
    if (isNaN(dA.getTime()) && isNaN(dB.getTime())) return 0;
    if (isNaN(dA.getTime())) return 1;
    if (isNaN(dB.getTime())) return -1;
    return dB.getTime() - dA.getTime();
  });

  // Track which members we've already repaired in this run to avoid
  // redundant write-then-overwrite cycles from older payment rows.
  const repairedThisRun = new Set<string>();

  for (const row of rows) {
    stats.reviewed++;

    // ── Guard: MemberID must be present ──
    if (!row.memberID) {
      console.warn(`[mmr][reviewPaymentHistory] row ${row.rowNum}: missing MemberID — skipping`);
      auditLog('EXPIRATION_REVIEW_SKIPPED', {
        state: { reason: 'missing_member_id', rowNum: row.rowNum },
      });
      stats.skipped++;
      continue;
    }

    // ── Guard: don't re-process a member we already repaired this run ──
    if (repairedThisRun.has(row.memberID)) {
      console.log(`[mmr][reviewPaymentHistory] row ${row.rowNum}: ${row.memberID} already repaired in this run — skipping older entry`);
      stats.skipped++;
      continue;
    }

    // ── Look up member ──
    const memberResult = findMemberByID(row.memberID);
    if (!memberResult) {
      console.warn(`[mmr][reviewPaymentHistory] row ${row.rowNum}: MemberID ${row.memberID} not found in master — skipping`);
      auditLog('EXPIRATION_REVIEW_SKIPPED', {
        memberID: row.memberID,
        state: { reason: 'member_not_found', rowNum: row.rowNum },
      });
      stats.skipped++;
      continue;
    }

    // Declare currentExpiration up here so it's available in the computation below.
    // Normalise to ISO YYYY-MM-DD — GAS may return a JavaScript Date toString like
    // "Mon Jan 11 2027 00:00:00 GMT-0500" when reading a date-formatted cell.
    const currentExpirationRaw = memberResult.member.expiration || '';
    const currentExpiration    = toISODateString(currentExpirationRaw) || currentExpirationRaw;
    const currentStatus        = memberResult.member.status;

    // ── Compute expected expiration ──
    // When MembershipYearEnd is configured (e.g. "2027-03-31"), every payment in
    // this cycle should land on that fixed date regardless of payment date.
    // computeMembershipExpiration handles both fixed-year-end and rolling modes.
    // In either mode, the result is always >= currentExpiration (no regression).
    let expectedExpiration: string;
    const baseForComputation = row.periodEnd || row.paymentDate;
    if (baseForComputation) {
      const baseDate = new Date(baseForComputation);
      if (isNaN(baseDate.getTime())) {
        console.warn(`[mmr][reviewPaymentHistory] row ${row.rowNum}: invalid date "${baseForComputation}" — skipping`);
        auditLog('EXPIRATION_REVIEW_SKIPPED', {
          memberID: row.memberID,
          state: { reason: 'invalid_date', rowNum: row.rowNum, date: baseForComputation },
        });
        stats.skipped++;
        continue;
      }
      // Fixed-year-end mode: MembershipYearEnd overrides baseDate arithmetic.
      // Rolling mode (no MembershipYearEnd): max(baseDate + renewalYears, currentExpiration + renewalYears).
      // Pass renewalYears=0 when using periodEnd (already includes the +1yr from original processing).
      const yearsToAdd = row.periodEnd ? 0 : renewalYears;
      expectedExpiration = computeMembershipExpiration(baseDate, currentExpiration, yearsToAdd, membershipYearEnd);
    } else {
      console.warn(`[mmr][reviewPaymentHistory] row ${row.rowNum}: no PeriodEnd or PaymentDate — skipping`);
      auditLog('EXPIRATION_REVIEW_SKIPPED', {
        memberID: row.memberID,
        state: { reason: 'no_date_available', rowNum: row.rowNum },
      });
      stats.skipped++;
      continue;
    }

    // ── Check if repair is needed ──
    // Compare both sides as ISO strings so format differences don't trigger false repairs.
    const currentExpirationISO = toISODateString(currentExpiration) || currentExpiration;
    const expirationMismatch   = currentExpirationISO !== expectedExpiration;
    const statusNeedsRepair    = currentStatus !== 'active';

    if (!expirationMismatch && !statusNeedsRepair) {
      console.log(`[mmr][reviewPaymentHistory] ${row.memberID}: expiration ${currentExpirationISO} is correct, status is active — no repair needed`);
      continue;
    }

    // ── Apply repair ──
    console.log(`[mmr][reviewPaymentHistory] repairing ${row.memberID}: expiration ${currentExpirationISO} → ${expectedExpiration}, status ${currentStatus} → active`);

    const memberType = row.paymentIntent === 'Family Membership' ? 'Family' : 'Individual';

    // If it's a Family Membership, also repair all family members
    let membersToRepair: Array<{ member: Member; rowIndex: number }> = [memberResult];
    if (row.paymentIntent === 'Family Membership' && memberResult.member.familyID) {
      const familyMembers = findMembersByFamilyID(memberResult.member.familyID);
      if (familyMembers.length > 0) membersToRepair = familyMembers;
    }

    for (const { member: fm } of membersToRepair) {
      updateMemberWithLog(fm.memberID, {
        EXPIRATION:   expectedExpiration,
        TYPE:         memberType,
        STATUS:       'active',
        LAST_UPDATED: now,
      });

      auditLog('EXPIRATION_REPAIRED', {
        memberID: fm.memberID,
        state: {
          oldExpiration:  fm.expiration || '',
          newExpiration:  expectedExpiration,
          oldStatus:      fm.status,
          sourceRowNum:   row.rowNum,
          paymentIntent:  row.paymentIntent,
          paymentDate:    row.paymentDate,
        },
      });

      // Notify member that their profile has been updated — but suppress the email
      // if the old and new dates are within 5 days of each other (pure format fix,
      // no meaningful change in when their membership expires).
      const oldDateMs = new Date(fm.expiration || '').getTime();
      const newDateMs = new Date(expectedExpiration).getTime();
      const diffDays  = !isNaN(oldDateMs) ? Math.abs(newDateMs - oldDateMs) / 86_400_000 : Infinity;
      if (diffDays <= 5) {
        console.log(`[mmr][reviewPaymentHistory] skipping email for ${fm.memberID} — date change is only ${diffDays.toFixed(1)} days (format fix only)`);
      } else {
        try {
          notifyExpirationRepaired(fm.memberID, expectedExpiration);
        } catch (emailErr) {
          console.error(`[mmr][reviewPaymentHistory] email failed for ${fm.memberID}:`, String(emailErr));
        }
      }
    }

    repairedThisRun.add(row.memberID);
    stats.repaired++;
  }

  console.log(`[mmr][reviewPaymentHistory] done — reviewed: ${stats.reviewed}, repaired: ${stats.repaired}, skipped: ${stats.skipped}`);
  auditLog('PAYMENT_HISTORY_REVIEW_COMPLETE', {
    state: { reviewed: stats.reviewed, repaired: stats.repaired, skipped: stats.skipped },
  });

  return stats;
}


// ============================================================
// expirePaymentProofs
//
// Scheduled job: expire payment proof events after PaymentProofReviewDays.
//
// For each WebApp-Events row with Status = "Pending" and ExpiresAt < now:
// 1. Set Status = "Expired"
// 2. Send notification email to the member
// 3. Log PROOF_EXPIRED action
//
// Typically triggered nightly at 2 AM.
// ============================================================
function expirePaymentProofs(): void {
  try {
    console.log('[mmr][expirePaymentProofs] starting proof expiry check');
    const now = new Date();
    const nowISO = now.toISOString();
    let expiredCount = 0;

    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      const eventID     = String(data[i][WE_COL.EVENT_ID]);
      const status      = String(data[i][WE_COL.STATUS]);
      const expiresAtStr = String(data[i][WE_COL.EXPIRES_AT]);
      const memberID    = String(data[i][WE_COL.MEMBER_ID]);

      if (status !== 'Pending') continue;

      if (!expiresAtStr || expiresAtStr.trim() === '') continue;
      const expiresAt = new Date(expiresAtStr);
      if (isNaN(expiresAt.getTime())) {
        console.warn(`[expirePaymentProofs] invalid expiresAt for eventID ${eventID}`);
        continue;
      }

      if (expiresAt > now) continue;

      console.log(`[expirePaymentProofs] expiring eventID: ${eventID}, memberID: ${memberID}`);
      sheet.getRange(i + 1, WE_COL.STATUS + 1).setValue('Expired');
      expiredCount++;

      try {
        notifyPaymentExpired(memberID, eventID);
      } catch (emailErr) {
        console.error(`[expirePaymentProofs] failed to send expiration email for ${memberID}:`, String(emailErr));
      }

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


// ============================================================
// expireInactiveMemberships
//
// Scheduled job: mark active members as inactive when their expiration
// date has passed.
//
// For each Membership-Master row with Status = "active" and Expiration < today:
// 1. Set Status = "inactive"
// 2. Update LastUpdated timestamp
// 3. Log the change to Membership-Master-Log
//
// Typically triggered nightly at 2 AM.
// ============================================================
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
      const memberID      = String(data[i][MM_COL.MEMBER_ID]);
      const status        = String(data[i][MM_COL.STATUS]).toLowerCase();
      const expirationStr = String(data[i][MM_COL.EXPIRATION]);

      if (status !== 'active') continue;

      if (!expirationStr || expirationStr.trim() === '') continue;
      const expiration = new Date(expirationStr);
      if (isNaN(expiration.getTime())) {
        console.warn(`[expireInactiveMemberships] invalid expiration for memberID ${memberID}`);
        continue;
      }

      if (expiration >= today) continue;

      console.log(`[expireInactiveMemberships] marking inactive: memberID: ${memberID}, expiration: ${expirationStr}`);

      logMainTableRow(memberID);

      sheet.getRange(i + 1, MM_COL.STATUS + 1).setValue('inactive');
      sheet.getRange(i + 1, MM_COL.LAST_UPDATED + 1).setValue(now);
      sheet.getRange(i + 1, MM_COL.LAST_UPDATED_UNIX + 1).setValue(toUnixTimestamp(now));
      expiredCount++;

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


// ── Schedule trigger setup ────────────────────────────────────────────────
//
// In Google Apps Script (script.google.com → Triggers), create time-based
// triggers for these functions. Recommended schedule: daily at 2 AM.
//
//   Function                     When               Notes
//   ─────────────────────────────────────────────────────────────────────────
//   expirePaymentProofs          nightly 2 AM       expire unreviewed proof events
//   expireInactiveMemberships    nightly 2 AM       mark expired members inactive
//   reviewPaymentHistory         nightly 2 AM       repair missing/wrong expiration dates
//   autoMatchUnmatchedPayments   nightly 2 AM       auto-guess direct payments
//                                                   (only runs within collection window)
//
// The autoMatchUnmatchedPayments function self-guards: it checks the collection
// window on every run and exits immediately if today is outside the window.
// It is safe to keep this trigger active year-round.
//
// Manual triggers:
//   - "Run Auto-Match" button in Admin UI → calls triggerAutoMatch() in admin.ts
//   - Can also call any function directly from the Apps Script editor for testing


// ============================================================
// normalizeExpirationDateFormats  — ONE-TIME CLEANUP UTILITY
//
// Scans every row in Membership Master and rewrites any Expiration cell that
// is not already in YYYY-MM-DD format (e.g. GAS Date objects that serialise as
// "Mon Jan 11 2027 00:00:00 GMT-0500") into clean ISO format.
//
// Does NOT send any emails and does NOT change the expiration date value —
// only the string representation.  Safe to run multiple times (idempotent).
//
// Run once from the Apps Script editor after deploying this build.
// ============================================================
function normalizeExpirationDateFormats(): { checked: number; fixed: number; skipped: number } {
  console.log('[mmr][normalizeExpirationDateFormats] starting');

  const stats = { checked: 0, skipped: 0, fixed: 0 };
  const now   = new Date().toISOString();

  const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    const memberID      = String(data[i][MM_COL.MEMBER_ID] || '').trim();
    const expirationRaw = data[i][MM_COL.EXPIRATION];

    if (!memberID) continue;
    stats.checked++;

    // Nothing to fix if the cell is empty
    if (expirationRaw === '' || expirationRaw === null || expirationRaw === undefined) {
      stats.skipped++;
      continue;
    }

    const isoDate = toISODateString(String(expirationRaw));
    if (!isoDate) {
      console.warn(`[mmr][normalizeExpirationDateFormats] ${memberID} row ${i + 1}: unparseable expiration "${expirationRaw}" — skipping`);
      stats.skipped++;
      continue;
    }

    // Already correct format — nothing to do
    if (String(expirationRaw).trim() === isoDate) {
      stats.skipped++;
      continue;
    }

    console.log(`[mmr][normalizeExpirationDateFormats] ${memberID} row ${i + 1}: "${expirationRaw}" → "${isoDate}"`);
    sheet.getRange(i + 1, MM_COL.EXPIRATION + 1).setValue(isoDate);
    sheet.getRange(i + 1, MM_COL.LAST_UPDATED + 1).setValue(now);
    sheet.getRange(i + 1, MM_COL.LAST_UPDATED_UNIX + 1).setValue(toUnixTimestamp(now));

    auditLog('EXPIRATION_FORMAT_NORMALIZED', {
      memberID,
      state: { oldValue: String(expirationRaw), newValue: isoDate, rowNum: i + 1 },
    });

    stats.fixed++;
  }

  console.log(`[mmr][normalizeExpirationDateFormats] done — checked: ${stats.checked}, fixed: ${stats.fixed}, skipped: ${stats.skipped}`);
  return stats;
}


(globalThis as any).expirePaymentProofs          = expirePaymentProofs;
(globalThis as any).expireInactiveMemberships    = expireInactiveMemberships;
(globalThis as any).autoMatchUnmatchedPayments   = autoMatchUnmatchedPayments;
(globalThis as any).reviewPaymentHistory         = reviewPaymentHistory;
(globalThis as any).computeMembershipExpiration       = computeMembershipExpiration;
(globalThis as any).extractMemberIDFromMemo           = extractMemberIDFromMemo;
(globalThis as any).isWithinCollectionWindow          = isWithinCollectionWindow;
(globalThis as any).normalizeExpirationDateFormats    = normalizeExpirationDateFormats;
