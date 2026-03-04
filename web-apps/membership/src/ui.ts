// ============================================================
// GAS web app entry point and JSON response helpers
// Depends on: (none — must be loaded first by GAS alphabetically)
// ============================================================

// Route ?page= to the matching HTML template
// Route ?page= to the matching HTML template
function doGet(e: GoogleAppsScript.Events.DoGet): GoogleAppsScript.HTML.HtmlOutput {
  try {
    console.log('mmr:doGet called, parameters =', JSON.stringify(e.parameter));
    console.log('mmr:doGet page =', e.parameter.page);

    const page = (e && e.parameter && e.parameter['page']) || 'login';
    console.log('mmr:doGet serving page =', page);

    if (page === 'image') {
      const fileId = e.parameter['id'];
      return serveImage(fileId);
    }

    try {
      const allowedPages = ['login', 'dashboard', 'profile', 'renewal', 'admin', 'newmember', 'payment_proof', 'payment', 'image', 'payment_history'];
      const safePage = allowedPages.includes(page) ? page : 'login';
      const fileName = `page_${safePage}`;
      console.log(`doGet: serving "${fileName}", page param="${page}"`);

      let scriptUrl = '';
      try { scriptUrl = ScriptApp.getService().getUrl(); } catch (_) {}
      console.log('mmr:doGet SCRIPTURL =', scriptUrl);

      // Serialize all URL params as JSON so the page can read type, amount, etc.
      const urlParamsJson = JSON.stringify(e.parameter || {});
      console.log('mmr:doGet urlParamsJson =', urlParamsJson);

      const raw = HtmlService.createHtmlOutputFromFile(fileName).getContent();
      const content = raw
        .replace('__SCRIPT_URL__', scriptUrl)
        .replace('__URL_PARAMS__', urlParamsJson);  // ← NEW

      console.log(`doGet: content length=${content.length}, scriptUrl=${scriptUrl}`);
      const output = HtmlService.createHtmlOutput(content)
        .setTitle('Misty Mountain Runners — Membership')
        .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
      console.log('mmr:doGet output created successfully for page =', page);
      return output;

    } catch (er: any) {
      console.error('mmr:doGet ERROR for page =', page, 'error =', String(er));
      return HtmlService.createHtmlOutput(
        `<h2 style="color:red;font-family:sans-serif;">Server Error in doGet for ${page}</h2><pre>${String(er)}</pre>`
      );
    }

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

(globalThis as any).doGet = doGet;
