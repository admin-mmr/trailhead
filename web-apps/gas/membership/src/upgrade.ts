// ============================================================
// Family upgrade flows: Switch to Family, Upgrade to Family, Cancel Upgrade
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: initiateSwitch, initiateUpgrade, cancelUpgrade
// ============================================================

// ---- initiateSwitch ----
// Individual → Family (full Family dues, expiration extended on approval).
// Available when: Status = inactive OR expires < ReminderDaysBefore days.
// Action: assign FamilyID, set Status = pending_upgrade, create WebApp-Events row.

function initiateSwitch(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<InitiateSwitchPayload>;
  const { payload } = req;
  try {
    console.log('[mmr][initiateSwitch] memberID:', payload.memberID);

    const result = findMemberByID(payload.memberID);
    if (!result) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');

    const { member, rowIndex } = result;

    if (member.status === 'pending_upgrade') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'A family upgrade is already in progress. Complete or cancel it first.');
    }
    if (member.type === 'Family' && member.status === 'active') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'Already an active Family member.');
    }

    // Log before write
    logMainTableRow(payload.memberID);

    // Assign FamilyID if not already set
    let familyID = member.familyID;
    if (!familyID) {
      familyID = generateFamilyID();
    }

    const config = getConfigMap();
    const amount = parseFloat(config['FamilyPrice'] || '50');
    const reviewDays = parseInt(config['PaymentProofReviewDays'] || '7', 10);

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + reviewDays * 24 * 60 * 60 * 1000).toISOString();

    // Update Main table: Type = Family, Status = pending_upgrade, assign FamilyID
    updateMemberRow(rowIndex, {
      TYPE:      'Family',
      STATUS:    'pending_upgrade',
      FAMILY_ID: familyID,
      LAST_UPDATED: now,
    });

    // Create WebApp-Events row to track this switch request
    const eventID = appendWebAppEvent({
      eventType:                'family_switch',
      timestamp:                now,
      expiresAt,
      memberID:                 payload.memberID,
      email:                    payload.email,
      paymentIntent:            'Family Membership',
      amount,
      paymentMethod:            '',
      payerName:                '',
      memoField:                '',
      last4Digits:              '',
      familyMemberEmails:       '',
      status:                   'Pending',
      matchedMessageId:         '',
      matchedTransactionNumber: '',
      adminApprover:            '',
      approvalDate:             '',
      notes:                    '',
    });

    auditLog('UPGRADE_INITIATE', {
      eventID,
      memberID: payload.memberID,
      email: payload.email,
      sessionID: payload.sessionID,
      state: { action: 'family_switch', familyID },
    });

    return jsonOk(req.requestId, {
      eventID,
      familyID,
      paymentIntent: 'Family Membership',
      amount,
      message: 'Switched to Family. Please pay the Family dues to activate your membership.',
    });
  } catch (e: any) {
    auditLog('ERROR', { memberID: payload.memberID, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// ---- initiateUpgrade ----
// Individual → Family (delta payment only, expiration unchanged).
// Available when: Status = active AND expiration > UpgradeMinMonths months from today.

function initiateUpgrade(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<InitiateUpgradePayload>;
  const { payload } = req;
  try {
    console.log('[mmr][initiateUpgrade] memberID:', payload.memberID);

    const result = findMemberByID(payload.memberID);
    if (!result) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');

    const { member, rowIndex } = result;

    if (member.status === 'pending_upgrade') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'A family upgrade is already in progress. Complete or cancel it first.');
    }
    if (member.status !== 'active') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'Family Upgrade requires an active membership. Use Switch to Family instead.');
    }
    if (member.type !== 'Individual') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'Already on a Family plan.');
    }

    // Validate expiration > UpgradeMinMonths
    const config = getConfigMap();
    const upgradeMinMonths = parseInt(config['UpgradeMinMonths'] || '3', 10);
    const today = new Date();
    const minExpiration = new Date(today);
    minExpiration.setMonth(minExpiration.getMonth() + upgradeMinMonths);

    const expDate = new Date(member.expiration);
    if (isNaN(expDate.getTime()) || expDate <= minExpiration) {
      return jsonError(req.requestId, 'INVALID_STATE',
        `Upgrade to Family requires more than ${upgradeMinMonths} months remaining on your membership. ` +
        `Use Switch to Family (full dues) instead.`);
    }

    // Log before write
    logMainTableRow(payload.memberID);

    // Assign FamilyID if not already set
    let familyID = member.familyID;
    if (!familyID) {
      familyID = generateFamilyID();
    }

    const amount = parseFloat(config['FamilyUpgradePrice'] || '20');
    const reviewDays = parseInt(config['PaymentProofReviewDays'] || '7', 10);

    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + reviewDays * 24 * 60 * 60 * 1000).toISOString();

    // Update Main table: Type = Family, Status = pending_upgrade, assign FamilyID
    updateMemberRow(rowIndex, {
      TYPE:      'Family',
      STATUS:    'pending_upgrade',
      FAMILY_ID: familyID,
      LAST_UPDATED: now,
    });

    // Create WebApp-Events row to track this upgrade request
    const eventID = appendWebAppEvent({
      eventType:                'family_upgrade',
      timestamp:                now,
      expiresAt,
      memberID:                 payload.memberID,
      email:                    payload.email,
      paymentIntent:            'Family Upgrade',
      amount,
      paymentMethod:            '',
      payerName:                '',
      memoField:                '',
      last4Digits:              '',
      familyMemberEmails:       '',
      status:                   'Pending',
      matchedMessageId:         '',
      matchedTransactionNumber: '',
      adminApprover:            '',
      approvalDate:             '',
      notes:                    '',
    });

    auditLog('UPGRADE_INITIATE', {
      eventID,
      memberID: payload.memberID,
      email: payload.email,
      sessionID: payload.sessionID,
      state: { action: 'family_upgrade', familyID },
    });

    return jsonOk(req.requestId, {
      eventID,
      familyID,
      paymentIntent: 'Family Upgrade',
      amount,
      message: 'Upgrade initiated. Please pay the upgrade fee to activate Family membership. Your expiration date is unchanged.',
    });
  } catch (e: any) {
    auditLog('ERROR', { memberID: payload.memberID, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

// ---- cancelUpgrade ----
// Revert all family members back to Individual. Remove FamilyID from all.
// Recalculate Status immediately based on each member's expiration date.
// Reject any pending proof event if found.

function cancelUpgrade(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<CancelUpgradePayload>;
  const { payload } = req;
  try {
    console.log('[mmr][cancelUpgrade] memberID:', payload.memberID);

    const result = findMemberByID(payload.memberID);
    if (!result) return jsonError(req.requestId, 'NOT_FOUND', 'Member not found.');

    const { member } = result;

    if (member.status !== 'pending_upgrade') {
      return jsonError(req.requestId, 'INVALID_STATE',
        'No pending upgrade to cancel.');
    }

    // Find all members sharing the same FamilyID
    let membersToRevert: Array<{ member: Member; rowIndex: number }> = [];
    if (member.familyID) {
      membersToRevert = findMembersByFamilyID(member.familyID);
    }
    if (membersToRevert.length === 0) {
      membersToRevert = [result];
    }

    const now = new Date().toISOString();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Log and revert each family member
    for (const { member: fm, rowIndex } of membersToRevert) {
      logMainTableRow(fm.memberID);

      // Immediately recalculate status from expiration
      const expDate = fm.expiration ? new Date(fm.expiration) : null;
      const revertedStatus =
        expDate && !isNaN(expDate.getTime()) && expDate >= today ? 'active' : 'inactive';

      updateMemberRow(rowIndex, {
        TYPE:        'Individual',
        STATUS:      revertedStatus,
        FAMILY_ID:   '',
        LAST_UPDATED: now,
      });
    }

    // Reject any pending family_switch / family_upgrade event for this member
    const pendingEvents = getPendingWebAppEvents();
    for (const ev of pendingEvents) {
      if (
        ev.memberID === payload.memberID &&
        (ev.eventType === 'family_switch' || ev.eventType === 'family_upgrade')
      ) {
        const found = findWebAppEvent(ev.eventID);
        if (found) {
          updateWebAppEventRow(found.rowIndex, {
            STATUS:        'Rejected',
            ADMIN_APPROVER: 'system',
            APPROVAL_DATE:  now,
            NOTES:          'Cancelled by member',
          });
        }
      }
    }

    auditLog('CANCEL_UPGRADE', {
      memberID: payload.memberID,
      email: payload.email,
      sessionID: payload.sessionID,
      state: { revertedCount: membersToRevert.length },
    });

    return jsonOk(req.requestId, {
      message: 'Upgrade cancelled. All family members reverted to Individual.',
      revertedCount: membersToRevert.length,
    });
  } catch (e: any) {
    auditLog('ERROR', { memberID: payload.memberID, errorMessage: String(e) });
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

(globalThis as any).initiateSwitch   = initiateSwitch;
(globalThis as any).initiateUpgrade  = initiateUpgrade;
(globalThis as any).cancelUpgrade    = cancelUpgrade;
