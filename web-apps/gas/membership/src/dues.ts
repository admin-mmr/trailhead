// ============================================================
// Membership dues: submit, reconcile, approve, reject
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: submitDuesPayment, reconcileWebAppWithGmail,
//                        approveDuesPayment, rejectDuesPayment
// NOTE: Old names (submitRenewalRequest, approveRenewal, rejectRenewal) are
//       kept as aliases for backward compatibility with existing callers.
// ============================================================

function submitDuesPayment(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<DuesSubmitPayload>;
  const { payload } = req;
  try {
    console.log('[mmr][submitDuesPayment] memberID:', payload.memberId,
      '| intent:', payload.paymentIntent, '| amount:', payload.amount);

    const config = getConfigMap();
    const reviewDays = parseInt(config['PaymentProofReviewDays'] || '7', 10);
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + reviewDays * 24 * 60 * 60 * 1000).toISOString();

    auditLog('DUES_SUBMIT', {
      memberID: payload.memberId,
      email: payload.email,
      sessionID: payload.sessionID,
    });

    const eventID = appendWebAppEvent({
      eventType:                'dues_payment',
      timestamp:                now,
      expiresAt,
      memberID:                 payload.memberId,
      email:                    payload.email,
      paymentIntent:            payload.paymentIntent,
      amount:                   payload.amount,
      paymentMethod:            payload.paymentMethod,
      payerName:                payload.payerName,
      memoField:                payload.memoField,
      last4Digits:              payload.last4Digits              ?? '',
      familyMemberEmails:       payload.familyMemberEmails       ?? '',
      status:                   'Pending',
      matchedMessageId:         '',
      matchedTransactionNumber: '',
      adminApprover:            '',
      approvalDate:             '',
      notes:                    '',
    });

    auditLog('DUES_SUBMIT', {
      eventID,
      memberID: payload.memberId,
      email: payload.email,
    });

    return jsonOk(req.requestId, {
      eventID,
      message: 'Payment submitted. We will verify and approve within 1–2 business days.',
    });
  } catch (e: any) {
    auditLog('ERROR', { memberID: payload.memberId, email: payload.email, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// Backward-compat alias
function submitRenewalRequest(jsonRequest: string): string {
  return submitDuesPayment(jsonRequest);
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
          STATUS:                     'Matched',
          MATCHED_MESSAGE_ID:         gmailMatch.messageId,
          MATCHED_TRANSACTION_NUMBER: gmailMatch.transactionNumber,
        });
        markGmailPaymentProcessed(gmailMatch.rowIndex, event.eventID);
        auditLog('RECONCILE_MATCH_FOUND', { eventID: event.eventID, memberID: event.memberID });

        // Auto-approve the matched event
        const approveReq = {
          requestId: 'auto-reconcile',
          payload: {
            eventID: event.eventID,
            adminEmail: 'auto-reconcile@system',
            notes: 'Auto-approved by system reconciliation'
          }
        };
        const approveResult = approveDuesPayment(JSON.stringify(approveReq));
        const approveData = JSON.parse(approveResult);
        if (approveData.ok) {
          console.log('[mmr][reconcileWebAppWithGmail] auto-approved eventID:', event.eventID);
        } else {
          console.error('[mmr][reconcileWebAppWithGmail] auto-approve failed for eventID:', event.eventID, approveData.errorMessage);
        }

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
    if (row.processed) continue;
    if (row.amount !== event.amount) continue;

    const rowDate = new Date(row.transactionDate || row.timestamp);
    if (isNaN(rowDate.getTime())) continue;
    if (Math.abs(eventDate.getTime() - rowDate.getTime()) > SEVEN_DAYS_MS) continue;

    const trimmed4 = (event.last4Digits || '').trim();
    const last4Match =
      trimmed4.length === 4 && (row.transactionNumber || '').endsWith(trimmed4);

    const memoText = ((row.memo || '') + ' ' + (row.originalMemo || '')).toLowerCase();
    const memberIdMatch = memoText.includes(event.memberID.toLowerCase());

    const payerLower  = (event.payerName || '').toLowerCase().trim();
    const senderLower = (row.sender      || '').toLowerCase().trim();
    const payerNameMatch =
      payerLower.length > 0 && senderLower.length > 0 &&
      (senderLower.includes(payerLower) || payerLower.includes(senderLower));

    if (last4Match || memberIdMatch || payerNameMatch) return row;
  }
  return null;
}


function approveDuesPayment(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<ApproveDuesPayload>;
  const payload = req.payload;
  try {
    const found = findWebAppEvent(payload.eventID);
    if (!found) return jsonError(req.requestId, 'NOT_FOUND', 'Event not found.');

    const event = found.event;
    const renewalYears = parseInt(getConfigValue('MembershipRenewalYears'), 10) || 1;
    const today = new Date();
    const intent = event.paymentIntent as PaymentIntent;
    const now = new Date().toISOString();

    // ── Branch C: Family Upgrade (delta payment, no expiration change) ───────
    if (intent === 'Family Upgrade') {
      const primary = findMemberByID(event.memberID);
      if (!primary) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');

      // Must be in pending_upgrade state (set by initiateUpgrade)
      if (primary.member.status !== 'pending_upgrade') {
        return jsonError(req.requestId, 'INVALID_STATE',
          'Family Upgrade approval requires the member to be in pending_upgrade state.');
      }

      const familyID = primary.member.familyID;
      const membersToUpdate = familyID
        ? findMembersByFamilyID(familyID)
        : [primary];

      // Update each family member (logging is automatic via updateMemberWithLog)
      for (const { member: fm } of membersToUpdate) {
        updateMemberWithLog(fm.memberID, {
          TYPE:         'Family',
          STATUS:       'active',
          LAST_UPDATED: now,
        });
      }

      const periodStart = primary.member.expiration
        ? new Date(primary.member.expiration).toISOString().split('T')[0]
        : today.toISOString().split('T')[0];
      const periodEnd = periodStart;

      appendPaymentRecord({
        ...baseRecord(event, payload), paymentIntent: intent,
        periodStart, periodEnd,
      });
      updateWebAppEventRow(found.rowIndex, {
        STATUS:         'Approved',
        ADMIN_APPROVER: payload.adminEmail,
        APPROVAL_DATE:  now,
        NOTES:          payload.notes ?? '',
      });
      auditLog('UPGRADE_APPROVED', { eventID: event.eventID, memberID: event.memberID });
      notifyPaymentApproved(event.memberID, intent);
      return jsonOk(req.requestId, { message: 'Family upgrade approved.', periodEnd });
    }

    // ── Branch B: Family Membership (Switch or Renewal) ───────────────────────
    // ── Branch A: Individual Membership ─────────────────────────────────────
    let membersToUpdate: Array<{ rowIndex: number; member: Member }> = [];

    if (intent === 'Family Membership') {
      const primary = findMemberByID(event.memberID);
      if (!primary) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');

      // Assign FamilyID if blank (safety net — should already be set by initiateSwitch)
      if (!primary.member.familyID) {
        const newFamilyID = generateFamilyID();
        updateMemberWithLog(primary.member.memberID, { FAMILY_ID: newFamilyID });
        primary.member.familyID = newFamilyID;
      }

      membersToUpdate = findMembersByFamilyID(primary.member.familyID);
      if (membersToUpdate.length === 0) membersToUpdate = [primary];
    } else {
      // Individual Membership
      const m = findMemberByID(event.memberID);
      if (!m) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');
      membersToUpdate = [m];
    }

    // Compute newExpiration.
    //
    // Fixed year-end mode (MembershipYearEnd configured, e.g. "2027-03-31"):
    //   Every payment this cycle expires on the same calendar date.
    //   Result = max(membershipYearEnd, currentExpiration) — never regress.
    //
    // Rolling mode (MembershipYearEnd blank):
    //   Result = max(today + renewalYears, currentExpiration + renewalYears)
    const membershipYearEnd = getConfigValue('MembershipYearEnd').trim();
    let newExpiration: Date;

    if (membershipYearEnd) {
      const yearEnd = new Date(membershipYearEnd);
      if (!isNaN(yearEnd.getTime())) {
        newExpiration = yearEnd;
        for (const { member } of membersToUpdate) {
          if (member.expiration) {
            const current = new Date(member.expiration);
            if (!isNaN(current.getTime()) && current > newExpiration) newExpiration = current;
          }
        }
      }
    }

    if (!newExpiration!) {
      // Rolling: max(today + N years, currentExpiration + N years)
      newExpiration = new Date(today);
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
    }

    const periodStart = today.toISOString().split('T')[0];
    const periodEnd   = newExpiration.toISOString().split('T')[0];
    const memberType  = intent === 'Family Membership' ? 'Family' : 'Individual';

    // Update each member (logging is automatic via updateMemberWithLog)
    for (const { member: fm } of membersToUpdate) {
      updateMemberWithLog(fm.memberID, {
        EXPIRATION:          periodEnd,
        TYPE:                memberType,
        STATUS:              'active',
        MEMBERSHIP_FEE_PAID: event.amount,
        PAYMENT_DATE:        now,
        PAYMENT_TRANSACTION: event.matchedTransactionNumber || event.last4Digits,
        LAST_UPDATED:        now,
      });
    }

    appendPaymentRecord({
      ...baseRecord(event, payload), paymentIntent: intent,
      periodStart, periodEnd,
    });
    updateWebAppEventRow(found.rowIndex, {
      STATUS:         'Approved',
      ADMIN_APPROVER: payload.adminEmail,
      APPROVAL_DATE:  now,
      NOTES:          payload.notes ?? '',
    });
    auditLog('DUES_APPROVED', {
      eventID: event.eventID, memberID: event.memberID, email: event.email,
    });
    notifyPaymentApproved(event.memberID, intent);

    return jsonOk(req.requestId, { message: 'Dues approved.', periodEnd });

  } catch (e: any) {
    auditLog('ERROR', { eventID: payload.eventID, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// Backward-compat alias
function approveRenewal(jsonRequest: string): string {
  return approveDuesPayment(jsonRequest);
}

function baseRecord(event: WebAppEvent, payload: ApproveDuesPayload) {
  return {
    eventID:              event.eventID,
    memberID:             event.memberID,
    paymentDate:          new Date().toISOString().split('T')[0],
    amount:               event.amount,
    paymentMethod:        event.paymentMethod,
    payerName:            event.payerName,
    memoField:            event.memoField,
    last4Digits:          event.last4Digits,
    transactionReference: event.matchedTransactionNumber,
    processedBy:          payload.adminEmail,
    processedDate:        new Date().toISOString(),
    source:               'WebApp',
    notes:                payload.notes ?? '',
  };
}


function rejectDuesPayment(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<RejectDuesPayload>;
  const { payload } = req;
  try {
    console.log('[mmr][rejectDuesPayment] eventID:', payload.eventID, '| admin:', payload.adminEmail);
    const found = findWebAppEvent(payload.eventID);
    if (!found) return jsonError(req.requestId, 'NOT_FOUND', 'Event not found.');

    const now = new Date().toISOString();
    updateWebAppEventRow(found.rowIndex, {
      STATUS:         'Rejected',
      ADMIN_APPROVER: payload.adminEmail,
      APPROVAL_DATE:  now,
      NOTES:          payload.notes,
    });

    auditLog('RENEWAL_REJECTED', { eventID: payload.eventID, memberID: found.event.memberID });
    notifyPaymentRejected(found.event.memberID, payload.notes || 'No reason provided');
    return jsonOk(req.requestId, { message: 'Payment rejected.' });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// Backward-compat alias
function rejectRenewal(jsonRequest: string): string {
  return rejectDuesPayment(jsonRequest);
}

(globalThis as any).submitDuesPayment        = submitDuesPayment;
(globalThis as any).submitRenewalRequest     = submitRenewalRequest;
(globalThis as any).reconcileWebAppWithGmail = reconcileWebAppWithGmail;
(globalThis as any).approveDuesPayment       = approveDuesPayment;
(globalThis as any).approveRenewal           = approveRenewal;
(globalThis as any).rejectDuesPayment        = rejectDuesPayment;
(globalThis as any).rejectRenewal            = rejectRenewal;
