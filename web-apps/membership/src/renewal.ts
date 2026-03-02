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
    console.log('[mmr][submitRenewalRequest] memberID:', payload.memberId, '| type:', payload.membershipType, '| amount:', payload.amount, '| method:', payload.paymentMethod);
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
      membershipType: payload.membershipType,
      amount: payload.amount,
      paymentMethod: payload.paymentMethod,
      payerName: payload.payerName,
      memoField: payload.memoField,
      last4Digits: payload.last4Digits ?? '',
      familyMemberEmails: (payload.familyMemberEmails ?? []).join(','),
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
  const windowMs = 3 * 24 * 60 * 60 * 1000; // ±3 days

  for (const row of gmailRows) {
    // Exact match on last 4 digits of transaction number
    if (event.last4Digits && row.transactionNumber.endsWith(event.last4Digits)) {
      if (row.amount === event.amount) return row;
    }

    // Fuzzy match
    const rowDate = new Date(row.transactionDate || row.timestamp);
    if (Math.abs(eventDate.getTime() - rowDate.getTime()) > windowMs) continue;
    if (row.amount !== event.amount) continue;
    if (row.source.toLowerCase() !== event.paymentMethod.toLowerCase()) continue;

    const senderLower = row.sender.toLowerCase();
    const payerLower = event.payerName.toLowerCase();
    const memoLower = (row.memo + ' ' + row.originalMemo).toLowerCase();

    const senderMatch =
      senderLower.includes(payerLower) || payerLower.includes(senderLower);
    const memoMatch =
      memoLower.includes(event.memberID.toLowerCase()) ||
      memoLower.includes(payerLower);

    if (senderMatch || memoMatch) return row;
  }

  return null;
}

function approveRenewal(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<ApproveRenewalPayload>;
  const { payload } = req;
  try {
    console.log('[mmr][approveRenewal] eventID:', payload.eventID, '| admin:', payload.adminEmail);
    const found = findWebAppEvent(payload.eventID);
    if (!found) return jsonError(req.requestId, 'NOT_FOUND', 'Event not found.');
    const event = found.event;

    const renewalYears = parseInt(getConfigValue('Membership_Renewal_Years'), 10) || 1;
    const today = new Date();

    // Determine members to update (family or individual)
    let membersToUpdate: Array<{ member: Member; rowIndex: number }> = [];
    if (event.membershipType === 'Family') {
      const primary = findMemberByID(event.memberID);
      if (primary?.member.familyID) {
        membersToUpdate = findMembersByFamilyID(primary.member.familyID);
      }
    }
    if (membersToUpdate.length === 0) {
      const m = findMemberByID(event.memberID);
      if (m) membersToUpdate = [m];
    }
    if (membersToUpdate.length === 0) {
      return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');
    }

    // Compute new expiration: max(today + years, current expiration + years)
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

    // Update all members in scope
    for (const { rowIndex, member } of membersToUpdate) {
      updateMemberRow(rowIndex, {
        STATUS: 'active',
        EXPIRATION: periodEnd,
        MEMBERSHIP_FEE_PAID: event.amount,
        PAYMENT_DATE: now,
        PAYMENT_TRANSACTION: event.matchedTransactionNumber || event.last4Digits || '',
        LAST_UPDATED: now,
      });

      // Email notification (non-critical)
      if (member.email) {
        try {
          MailApp.sendEmail({
            to: member.email,
            subject: 'Misty Mountain Runners — Membership Renewed',
            body:
              `Hi ${member.firstName || 'Member'},\n\n` +
              `Your membership has been renewed and is active through ${periodEnd}.\n\n` +
              `Thank you for your support!\n\nMisty Mountain Runners`,
          });
        } catch (_) { /* non-critical — log only */ }
      }
    }

    // Write Payment-History record
    appendPaymentRecord({
      eventID: event.eventID,
      memberID: event.memberID,
      paymentDate: now,
      amount: event.amount,
      membershipType: event.membershipType,
      paymentMethod: event.paymentMethod,
      payerName: event.payerName,
      memoField: event.memoField,
      last4Digits: event.last4Digits,
      transactionReference: event.matchedTransactionNumber,
      periodStart,
      periodEnd,
      processedBy: payload.adminEmail,
      processedDate: now,
      source: 'WebApp',
      notes: payload.notes ?? '',
    });

    // Mark event as Approved
    updateWebAppEventRow(found.rowIndex, {
      STATUS: 'Approved',
      ADMIN_APPROVER: payload.adminEmail,
      APPROVAL_DATE: now,
      NOTES: payload.notes ?? '',
    });

    auditLog('RENEWAL_APPROVED', {
      eventID: event.eventID,
      memberID: event.memberID,
      email: event.email,
    });

    console.log('[mmr][approveRenewal] approved, periodEnd:', periodEnd, '| members updated:', membersToUpdate.length);
    return jsonOk(req.requestId, { message: 'Renewal approved.', periodEnd });
  } catch (e: any) {
    console.error('[mmr][approveRenewal] error:', String(e));
    auditLog('ERROR', { eventID: payload.eventID, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
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
