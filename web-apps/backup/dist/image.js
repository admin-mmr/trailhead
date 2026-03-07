"use strict";
// ============================================================
// Image serving
// ============================================================
// Image serving
function serveImage(fileId) {
    try {
        console.log('mmr:serveImage fileId =', fileId);
        if (!fileId) {
            return HtmlService.createHtmlOutput('<p>Missing file ID</p>');
        }
        const file = DriveApp.getFileById(fileId);
        const blob = file.getBlob();
        const mimeType = blob.getContentType();
        const bytes = blob.getBytes();
        const base64 = Utilities.base64Encode(bytes);
        console.log('mmr:serveImage mimeType =', mimeType, 'size =', bytes.length);
        // Serve as inline base64 image page — browsers accept this from GAS doGet
        const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;">
      <img src="data:${mimeType};base64,${base64}" style="max-width:100%;display:block;" />
    </body></html>`;
        return HtmlService.createHtmlOutput(html)
            .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
    }
    catch (e) {
        console.error('mmr:serveImage ERROR fileId =', fileId, 'error =', String(e));
        return HtmlService.createHtmlOutput(`<p>Image not found: ${String(e)}</p>`);
    }
}
