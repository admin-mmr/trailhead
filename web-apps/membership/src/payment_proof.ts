// ============================================================
// Payment Proof Submission
// Depends on: config.ts, sheets.ts, logger.ts
// Exposed GAS functions: getPaymentConfirmationEvents, submitPaymentProof
// ============================================================

function getPaymentConfirmationEvents(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{}>;
  try {
    const sheet = getSheet(SHEET_NAMES.PAYMENT_EVENTS);
    const rows = sheet.getDataRange().getValues().slice(1); // skip header
    const events = rows.map(row => ({
      name: row[PCE_COL.EVENT_NAME],
      description: row[PCE_COL.DESCRIPTION],
      confirmationMethod: row[PCE_COL.CONFIRMATION_METHOD],
    }));
    return jsonOk(req.requestId, { events });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}

function submitPaymentProof(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<any>;
  const { payload } = req;
  try {
    console.log('[mmr][submitPaymentProof] memberID:', payload.memberID);

    // 1. Upload screenshot to Drive
    const folderId = getConfigValue('PaymentProofFolderId');
    if (!folderId) {
      throw new Error('Payment proof folder ID is not configured.');
    }
    const folder = DriveApp.getFolderById(folderId);

    let fileId = '';
    if (payload.screenshot) {
      const decoded = Utilities.base64Decode(payload.screenshot);
      const blob = Utilities.newBlob(decoded, 'image/png', `${payload.memberID}-proof-${Date.now()}.png`);
      const file = folder.createFile(blob);
      fileId = file.getId();
    }

    // 2. Find the most recent Pending or Matched WebApp-Event for this member
    const memberEvents = getWebAppEventsByMemberID(payload.memberID);
    const pendingEvent = memberEvents
      .filter(ev => ev.status === 'Pending' || ev.status === 'Matched')
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())[0];

    if (pendingEvent) {
      // 3a. Attach proof fields to the existing event
      const found = findWebAppEvent(pendingEvent.eventID);
      if (found) {
        updateWebAppEventRow(found.rowIndex, {
          PAYMENT_DATE:       payload.paymentDate || '',
          PAYMENT_METHOD:     payload.paymentMethod || found.event.paymentMethod,
          MEMO_FIELD:         payload.memoField || found.event.memoField,
          SCREENSHOT_FILE_ID: fileId,
          NOTES:              payload.notes || found.event.notes,
        });
        console.log('[mmr][submitPaymentProof] updated existing event:', pendingEvent.eventID);
      }
    } else {
      // 3b. No pending event found — create a standalone proof event
      const newEventID = appendWebAppEvent({
        eventType:                'PaymentProof',
        timestamp:                new Date().toISOString(),
        expiresAt:                '',
        memberID:                 payload.memberID,
        email:                    payload.email,
        paymentIntent:            (payload.eventName || '') as PaymentIntent,
        amount:                   payload.amount || 0,
        paymentMethod:            payload.paymentMethod || '',
        payerName:                payload.payerName || '',
        memoField:                payload.memoField || '',
        last4Digits:              payload.last4Digits || '',
        familyMemberEmails:       '',
        status:                   'Pending',
        matchedMessageId:         '',
        matchedTransactionNumber: '',
        adminApprover:            '',
        approvalDate:             '',
        notes:                    payload.notes || '',
        paymentDate:              payload.paymentDate || '',
        screenshotFileId:         fileId,
        gdriveFilePath:           '',
        ocrText:                  '',
        ocrTimestamp:             '',
      });
      console.log('[mmr][submitPaymentProof] created standalone event:', newEventID);
    }

    return jsonOk(req.requestId, { message: 'Proof submitted successfully.' });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}
