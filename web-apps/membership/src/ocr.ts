// ============================================================
// OCR processing for payment proofs stored in WebApp-Events
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

    const found = findWebAppEvent(payload.eventId);
    if (!found) {
      return jsonError(req.requestId, 'NOT_FOUND', 'WebApp event not found.');
    }

    const fileId = found.event.screenshotFileId || '';
    if (!fileId) {
      return jsonError(req.requestId, 'BAD_REQUEST', 'No screenshot file ID found for this event.');
    }

    const ocrText = ocrImageToText_(fileId);
    const filePath = DriveApp.getFileById(fileId).getUrl();
    const timestamp = new Date().toISOString();

    updateWebAppEventRow(found.rowIndex, {
      GDRIVE_FILE_PATH: filePath,
      OCR_TEXT:         ocrText,
      OCR_TIMESTAMP:    timestamp,
    });

    return jsonOk(req.requestId, { message: 'OCR process completed successfully.' });

  } catch (e: any) {
    return jsonError(req.requestId, 'INTERNAL_ERROR', String(e));
  }
}
