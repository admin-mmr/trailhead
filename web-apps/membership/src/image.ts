// ============================================================
// Image serving
// ============================================================

function serveImage(fileId: string): GoogleAppsScript.Base.Blob {
  try {
    const file = DriveApp.getFileById(fileId);
    return file.getBlob();
  } catch (e) {
    throw new Error(`Could not serve image with id ${fileId}. Error: ${e}`);
  }
}
