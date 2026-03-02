// ============================================================
// GAS web app entry point and JSON response helpers
// Depends on: (none — must be loaded first by GAS alphabetically)
// ============================================================

// Route ?page= to the matching HTML template
function doGet(e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  try {
    const page = (e && e.parameter && e.parameter['page']) || 'login';
    const allowedPages = ['login', 'dashboard', 'profile', 'renewal', 'admin', 'newmember'];
    const safePage = allowedPages.includes(page) ? page : 'login';
    const fileName = `page_${safePage}`;
    console.log(`doGet: serving "${fileName}", page param="${page}"`);
    let scriptUrl = '';
    try { scriptUrl = ScriptApp.getService().getUrl(); } catch (_) {}
    const raw = HtmlService.createHtmlOutputFromFile(fileName).getContent();
    const content = raw.replace('__SCRIPT_URL__', scriptUrl);
    console.log(`doGet: content length=${content.length}, scriptUrl=${scriptUrl}`);
    return HtmlService.createHtmlOutput(content)
      .setTitle('Misty Mountain Runners — Membership')
      .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
  } catch (err: any) {
    console.error('doGet error:', String(err));
    return HtmlService.createHtmlOutput(
      `<h2 style="color:red;font-family:sans-serif;">Server Error in doGet</h2><pre>${String(err)}</pre>`
    );
  }
}

// ---- JSON response helpers (used by all backend modules) ----

function jsonOk<T>(requestId: string, payload: T): string {
  const response: ApiResponseSuccess<T> = { ok: true, requestId, payload };
  return JSON.stringify(response);
}

function jsonError(requestId: string, errorCode: string, errorMessage: string): string {
  const response: ApiResponseError = { ok: false, requestId, errorCode, errorMessage };
  return JSON.stringify(response);
}
