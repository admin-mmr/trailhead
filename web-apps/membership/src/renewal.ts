// ============================================================
// Membership renewal: submit, reconcile, approve, reject
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: submitRenewalRequest, reconcileWebAppWithGmail,
//                        approveRenewal, rejectRenewal
// ============================================================

function submitRenewalRequest(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<RenewalSubmitPayload>;
  const { payload } = req;
  try {
    console.log('[mmr][submitRenewalRequest] memberID:', payload.memberId, '| type:', payload.paymentIntent, '| amount:', payload.amount, '| method:', payload.paymentMethod);
    auditLog('RENEWAL_FORM_OPEN', {
      memberID: payload.memberId,
      email: payload.email,
      sessionID: payload.sessionID,
    });

    const eventID = appendWebAppEvent({
      eventType: 'MembershipRenewal',
      timestamp: new Date().toISOString(),
      memberID: payload.memberId,
      email: payload.email,
      paymentIntent: payload.paymentIntent,   // 'Individual Renewal' | 'Family Renewal' | 'Family Upgrade'
      amount: payload.amount,
      paymentMethod: payload.paymentMethod,
      payerName: payload.payerName,
      memoField: payload.memoField,
      last4Digits: payload.last4Digits ?? '',
      familyMemberEmails: payload.familyMemberEmails ?? '',
      status: 'Pending',
      matchedMessageId: '',
      matchedTransactionNumber: '',
      adminApprover: '',
      approvalDate: '',
      notes: '',
    });

    auditLog('RENEWAL_SUBMIT', {
      eventID,
      memberID: payload.memberId,
      email: payload.email,
    });

    return jsonOk(req.requestId, {
      eventID,
      message: 'Payment submitted. We will verify and approve within 1–2 business days.',
    });
  } catch (e: any) {
    auditLog('ERROR', {
      memberID: payload.memberId,
      email: payload.email,
      errorMessage: String(e),
    });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function reconcileWebAppWithGmail(_jsonRequest?: string): string {
  try {
    console.log('[mmr][reconcileWebAppWithGmail] starting reconciliation');
    const pendingEvents = getPendingWebAppEvents().filter(e => e.status === 'Pending');
    const gmailPayments = getUnmatchedGmailPayments();
    let matchCount = 0;

    for (const event of pendingEvents) {
      const found = findWebAppEvent(event.eventID);
      if (!found) continue;

      const gmailMatch = findGmailMatch(event, gmailPayments);
      if (gmailMatch) {
        updateWebAppEventRow(found.rowIndex, {
          STATUS: 'Matched',
          MATCHED_MESSAGE_ID: gmailMatch.messageId,
          MATCHED_TRANSACTION_NUMBER: gmailMatch.transactionNumber,
        });
        markGmailPaymentProcessed(gmailMatch.rowIndex, event.eventID);
        auditLog('RECONCILE_MATCH_FOUND', {
          eventID: event.eventID,
          memberID: event.memberID,
        });
        matchCount++;
      }
    }

    console.log('[mmr][reconcileWebAppWithGmail] done, matches:', matchCount);
    return jsonOk('reconcile', { matchCount });
  } catch (e: any) {
    console.error('[mmr][reconcileWebAppWithGmail] error:', String(e));
    return jsonError('reconcile', 'INTERNAL_ERROR', String(e));
  }
}

function findGmailMatch(event: WebAppEvent, gmailRows: FetchGmailRow[]): FetchGmailRow | null {
  const eventDate = new Date(event.timestamp);
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  for (const row of gmailRows) {
    // ── Must-match (all three required) ────────────────────────────────────
    // 1. Not already matched/processed
    if (row.processed) continue;

    // 2. Same amount (exact)
    if (row.amount !== event.amount) continue;

    // 3. Transaction date within 7 days of submission timestamp
    const rowDate = new Date(row.transactionDate || row.timestamp);
    if (isNaN(rowDate.getTime())) continue;
    if (Math.abs(eventDate.getTime() - rowDate.getTime()) > SEVEN_DAYS_MS) continue;

    // ── At-least-one (any one is sufficient) ───────────────────────────────
    // 1. Last 4 digits of confirmation/transaction ID match
    const trimmed4 = (event.last4Digits || '').trim();
    const last4Match =
      trimmed4.length === 4 &&
      (row.transactionNumber || '').endsWith(trimmed4);

    // 2. MemberID found anywhere in the memo fields
    const memoText = ((row.memo || '') + ' ' + (row.originalMemo || '')).toLowerCase();
    const memberIdMatch = memoText.includes(event.memberID.toLowerCase());

    // 3. Payer name matches sender (case-insensitive, substring in either direction)
    const payerLower  = (event.payerName || '').toLowerCase().trim();
    const senderLower = (row.sender      || '').toLowerCase().trim();
    const payerNameMatch =
      payerLower.length > 0 &&
      senderLower.length > 0 &&
      (senderLower.includes(payerLower) || payerLower.includes(senderLower));

    if (last4Match || memberIdMatch || payerNameMatch) {
      return row;
    }
  }
  return null;
}

function approveRenewal(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<ApproveRenewalPayload>;
  const payload = req.payload;
  try {
    const found = findWebAppEvent(payload.eventID);
    if (!found) return jsonError(req.requestId, 'NOT_FOUND', 'Event not found.');

    const event = found.event;
    const renewalYears = parseInt(getConfigValue('MembershipRenewalYears'), 10) || 1;
    const today = new Date();
    const intent = event.paymentIntent as PaymentIntent;

    // ── Branch C: Family Upgrade ──────────────────────────────────────
    if (intent === 'Family Upgrade') {
      const primary = findMemberByID(event.memberID);
      if (!primary) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');
      if (primary.member.status !== 'active') {
        return jsonError(req.requestId, 'INVALID_STATE',
          'Family upgrade requires an active Individual membership first.');
      }
      // Assign FamilyID if blank
      let familyID = primary.member.familyID;
      if (!familyID) {
        familyID = generateFamilyID();
        updateMemberRow(primary.rowIndex, { FAMILY_ID: familyID });
      }
      // Set Type → Family, do NOT change Expiration
      updateMemberRow(primary.rowIndex, { TYPE: 'Family' });

      const periodStart = primary.member.expiration
        ? new Date(primary.member.expiration).toISOString().split('T')[0]
        : today.toISOString().split('T')[0];
      const periodEnd = primary.member.expiration
        ? new Date(primary.member.expiration).toISOString().split('T')[0]
        : periodStart;

      appendPaymentRecord({ ...baseRecord(event, payload), paymentIntent: intent,
        periodStart, periodEnd });
      updateWebAppEventRow(found.rowIndex, { STATUS: 'Approved',
        ADMIN_APPROVER: payload.adminEmail, APPROVAL_DATE: new Date().toISOString(),
        NOTES: payload.notes ?? '' });
      auditLog('UPGRADEAPPROVED', { eventID: event.eventID, memberID: event.memberID });
      return jsonOk(req.requestId, { message: 'Family upgrade approved.', periodEnd });
    }

    // ── Branch B: Family Renewal ──────────────────────────────────────
    // ── Branch A: Individual Renewal ─────────────────────────────────
    // (shared expiration logic for both)
    let membersToUpdate: Array<{ rowIndex: number; member: Member }> = [];

    if (intent === 'Family Renewal') {
      const primary = findMemberByID(event.memberID);
      if (!primary) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');
      // Assign FamilyID if blank
      if (!primary.member.familyID) {
        const newFamilyID = generateFamilyID();
        updateMemberRow(primary.rowIndex, { FAMILY_ID: newFamilyID });
        primary.member.familyID = newFamilyID;
      }
      membersToUpdate = findMembersByFamilyID(primary.member.familyID);
      if (membersToUpdate.length === 0) membersToUpdate = [primary];
    } else {
      // Individual Renewal
      const m = findMemberByID(event.memberID);
      if (!m) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');
      membersToUpdate = [m];
    }

    // Compute newExpiration = max(today + N years, currentExpiration)
    let newExpiration = new Date(today);
    newExpiration.setFullYear(newExpiration.getFullYear() + renewalYears);
    for (const { member } of membersToUpdate) {
      if (member.expiration) {
        const current = new Date(member.expiration);
        if (!isNaN(current.getTime()) && current > today) {
          const extended = new Date(current);
          extended.setFullYear(extended.getFullYear() + renewalYears);
          if (extended > newExpiration) newExpiration = extended;
        }
      }
    }

    const now = new Date().toISOString();
    const periodStart = today.toISOString().split('T')[0];
    const periodEnd = newExpiration.toISOString().split('T')[0];
    const memberType = intent === 'Family Renewal' ? 'Family' : 'Individual';

    for (const { rowIndex } of membersToUpdate) {
      updateMemberRow(rowIndex, {
        EXPIRATION: periodEnd, TYPE: memberType,
        MEMBERSHIP_FEE_PAID: event.amount, PAYMENT_DATE: now,
        PAYMENT_TRANSACTION: event.matchedTransactionNumber || event.last4Digits,
        LAST_UPDATED: now,
      });
    }

    appendPaymentRecord({ ...baseRecord(event, payload), paymentIntent: intent,
      periodStart, periodEnd });
    updateWebAppEventRow(found.rowIndex, { STATUS: 'Approved',
      ADMIN_APPROVER: payload.adminEmail, APPROVAL_DATE: now,
      NOTES: payload.notes ?? '' });
    auditLog('RENEWALAPPROVED', { eventID: event.eventID, memberID: event.memberID,
      email: event.email });

    return jsonOk(req.requestId, { message: 'Renewal approved.', periodEnd });

  } catch (e: any) {
    auditLog('ERROR', { eventID: payload.eventID, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// Helper to avoid repeating shared Payment-History fields
function baseRecord(event: WebAppEvent, payload: ApproveRenewalPayload) {
  return {
    eventID: event.eventID, memberID: event.memberID,
    paymentDate: new Date().toISOString().split('T')[0],
    amount: event.amount, paymentMethod: event.paymentMethod,
    payerName: event.payerName, memoField: event.memoField,
    last4Digits: event.last4Digits,
    transactionReference: event.matchedTransactionNumber,
    processedBy: payload.adminEmail,
    processedDate: new Date().toISOString(),
    source: 'WebApp', notes: payload.notes ?? '',
  };
}


function rejectRenewal(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<RejectRenewalPayload>;
  const { payload } = req;
  try {
    console.log('[mmr][rejectRenewal] eventID:', payload.eventID, '| admin:', payload.adminEmail);
    const found = findWebAppEvent(payload.eventID);
    if (!found) return jsonError(req.requestId, 'NOT_FOUND', 'Event not found.');

    const now = new Date().toISOString();
    updateWebAppEventRow(found.rowIndex, {
      STATUS: 'Rejected',
      ADMIN_APPROVER: payload.adminEmail,
      APPROVAL_DATE: now,
      NOTES: payload.notes,
    });

    auditLog('RENEWAL_REJECTED', { eventID: payload.eventID, memberID: found.event.memberID });
    return jsonOk(req.requestId, { message: 'Renewal rejected.' });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

(globalThis as any).submitRenewalRequest     = submitRenewalRequest;
(globalThis as any).reconcileWebAppWithGmail = reconcileWebAppWithGmail;
(globalThis as any).approveRenewal           = approveRenewal;
(globalThis as any).rejectRenewal            = rejectRenewal;
