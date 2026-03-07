"use strict";
// ============================================================
// GAS web app entry point and JSON response helpers
// Depends on: (none — must be loaded first by GAS alphabetically)
// ============================================================
function doGet(e) {
    try {
        console.log('mmr:doGet called, parameters =', JSON.stringify(e.parameter));
        const page = (e && e.parameter && e.parameter['page']) || 'login';
        console.log('mmr:doGet serving page =', page);
        if (page === 'image') {
            const fileId = e.parameter['id'];
            return serveImage(fileId);
        }
        try {
            // 'renewal' removed — renewal/upgrade actions handled via dashboard buttons.
            // 'family' added — family member management page.
            const allowedPages = [
                'login', 'dashboard', 'profile', 'family',
                'admin', 'newmember', 'payment_proof', 'payment', 'image', 'payment_history',
            ];
            const safePage = allowedPages.includes(page) ? page : 'login';
            const fileName = `page_${safePage}`;
            console.log(`doGet: serving "${fileName}", page param="${page}"`);
            let scriptUrl = '';
            try {
                scriptUrl = ScriptApp.getService().getUrl();
            }
            catch (_) { }
            const urlParamsJson = JSON.stringify(e.parameter || {});
            const raw = HtmlService.createHtmlOutputFromFile(fileName).getContent();
            const content = raw
                .replace('__SCRIPT_URL__', scriptUrl)
                .replace('__URL_PARAMS__', urlParamsJson);
            const output = HtmlService.createHtmlOutput(content)
                .setTitle('Misty Mountain Runners — Membership')
                .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
            return output;
        }
        catch (er) {
            console.error('mmr:doGet ERROR for page =', page, 'error =', String(er));
            return HtmlService.createHtmlOutput(`<h2 style="color:red;font-family:sans-serif;">Server Error in doGet for ${page}</h2><pre>${String(er)}</pre>`);
        }
    }
    catch (err) {
        console.error('doGet error:', String(err));
        return HtmlService.createHtmlOutput(`<h2 style="color:red;font-family:sans-serif;">Server Error in doGet</h2><pre>${String(err)}</pre>`);
    }
}
// ---- JSON response helpers (used by all backend modules) ----
function jsonOk(requestId, payload) {
    const response = { ok: true, requestId, payload };
    return JSON.stringify(response);
}
function jsonError(requestId, errorCode, errorMessage) {
    const response = { ok: false, requestId, errorCode, errorMessage };
    return JSON.stringify(response);
}
globalThis.doGet = doGet;
// ── globalThis exports for test environment ──────────────────
globalThis.jsonOk = jsonOk;
globalThis.jsonError = jsonError;
