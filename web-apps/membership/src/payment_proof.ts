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
  const req = JSON.parse(jsonRequest) as ApiRequest<any>; // Define a proper type later
  const { payload } = req;
  try {
    console.log('[mmr][submitPaymentProof] payload:', payload);

    const folderId = getConfigValue('Payment_Proof_Folder_Id');
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

    appendPaymentProof({
      eventID: `PP-${Date.now()}`,
      timestamp: new Date().toISOString(),
      memberID: payload.memberID,
      email: payload.email,
      eventName: payload.eventName,
      amount: payload.amount,
      paymentDate: payload.paymentDate,
      payerName: payload.payerName,
      last4Digits: payload.last4Digits,
      notes: payload.notes,
      screenshotFileId: fileId,
      status: 'Pending Review',
    });

    return jsonOk(req.requestId, { message: 'Proof submitted successfully.' });
  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}
