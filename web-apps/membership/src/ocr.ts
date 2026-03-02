// ============================================================
// OCR processing for payment proofs
// Depends on: config.ts, sheets.ts, admin.ts
// Exposed GAS functions: runOcrForPaymentProof
// ============================================================

// Enable Advanced Drive Service (Resources → Advanced Google services → Drive API)
function ocrImageToText_(imageFileId: string): string {
  const file = Drive.Files.copy(
    {
      name: 'OCR temp',
      mimeType: 'application/vnd.google-apps.document'
    },
    imageFileId,
    {ocr: true}
  );

  if (!file.id) {
    throw new Error('Failed to create temporary file for OCR.');
  }

  const doc = DocumentApp.openById(file.id);
  const text = doc.getBody().getText();
  Drive.Files.remove(file.id); // Clean up the temporary file
  return text;
}

function runOcrForPaymentProof(jsonRequest: string): string {
  const req = JSON.parse(jsonRequest) as ApiRequest<{ adminEmail: string; eventId: string }>;
  const { payload } = req;
  try {
    if (!isAdmin(payload.adminEmail)) {
      return jsonError(req.requestId, 'FORBIDDEN', 'Not authorized.');
    }

    const sheet = getSheet(SHEET_NAMES.PAYMENT_PROOFS);
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    let fileId = '';

    for (let i = 1; i < data.length; i++) {
      if (data[i][PP_COL.EVENT_ID] === payload.eventId) {
        rowIndex = i;
        fileId = data[i][PP_COL.SCREENSHOT_FILE_ID];
        break;
      }
    }

    if (rowIndex === -1) {
      return jsonError(req.requestId, 'NOT_FOUND', 'Payment proof event not found.');
    }

    if (!fileId) {
      return jsonError(req.requestId, 'BAD_REQUEST', 'No screenshot file ID found for this payment proof.');
    }

    const ocrText = ocrImageToText_(fileId);
    const file = DriveApp.getFileById(fileId);
    const filePath = file.getUrl();
    const timestamp = new Date().toISOString();

    sheet.getRange(rowIndex + 1, PP_COL.GDRIVE_FILE_PATH + 1).setValue(filePath);
    sheet.getRange(rowIndex + 1, PP_COL.OCR_TEXT + 1).setValue(ocrText);
    sheet.getRange(rowIndex + 1, PP_COL.OCR_TIMESTAMP + 1).setValue(timestamp);

    return jsonOk(req.requestId, { message: 'OCR process completed successfully.' });

  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}
