"use strict";
// ============================================================
// Low-level sheet read/write helpers
// Depends on: config.ts, types.ts
// ============================================================
// ---- ID generators ----
function generateEventID() {
    return `EV-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}
function generatePaymentID() {
    return `PY-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}
function generateLogID() {
    return `LG-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}
function generateMasterLogID() {
    return `ML-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}
// ---- Membership Master ----
// Returns 'active' or 'inactive' based on expiration date.
// 'pending_upgrade' is STORED in the Status column and read directly by rowToMember — not derived.
function deriveStatus(expirationStr) {
    if (!expirationStr || expirationStr.trim() === '')
        return 'inactive';
    const exp = new Date(expirationStr);
    if (isNaN(exp.getTime()))
        return 'inactive';
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return exp >= today ? 'active' : 'inactive';
}
function rowToMember(row) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y;
    const expiration = String((_a = row[MM_COL.EXPIRATION]) !== null && _a !== void 0 ? _a : '');
    const storedStatus = String((_b = row[MM_COL.STATUS]) !== null && _b !== void 0 ? _b : '').trim().toLowerCase();
    // 'pending_upgrade' is stored explicitly. For all other values (including legacy
    // 'expired', 'not active'), derive active/inactive from the expiration date.
    const status = storedStatus === 'pending_upgrade'
        ? 'pending_upgrade'
        : deriveStatus(expiration);
    return {
        memberID: String((_c = row[MM_COL.MEMBER_ID]) !== null && _c !== void 0 ? _c : ''),
        status,
        created: String((_d = row[MM_COL.CREATED]) !== null && _d !== void 0 ? _d : ''),
        expiration,
        email: String((_e = row[MM_COL.EMAIL]) !== null && _e !== void 0 ? _e : ''),
        firstName: String((_f = row[MM_COL.FIRST_NAME]) !== null && _f !== void 0 ? _f : ''),
        lastName: String((_g = row[MM_COL.LAST_NAME]) !== null && _g !== void 0 ? _g : ''),
        type: String((_h = row[MM_COL.TYPE]) !== null && _h !== void 0 ? _h : 'Individual'),
        familyID: String((_j = row[MM_COL.FAMILY_ID]) !== null && _j !== void 0 ? _j : ''),
        gender: String((_k = row[MM_COL.GENDER]) !== null && _k !== void 0 ? _k : ''),
        wechatID: String((_l = row[MM_COL.WECHAT_ID]) !== null && _l !== void 0 ? _l : ''),
        district: String((_m = row[MM_COL.DISTRICT]) !== null && _m !== void 0 ? _m : ''),
        webApp: String((_o = row[MM_COL.WEBAPP]) !== null && _o !== void 0 ? _o : ''),
        paymentCheck: String((_p = row[MM_COL.PAYMENT_CHECK]) !== null && _p !== void 0 ? _p : ''),
        info: String((_q = row[MM_COL.INFO]) !== null && _q !== void 0 ? _q : ''),
        lastUpdated: String((_r = row[MM_COL.LAST_UPDATED]) !== null && _r !== void 0 ? _r : ''),
        membershipFeePaid: String((_s = row[MM_COL.MEMBERSHIP_FEE_PAID]) !== null && _s !== void 0 ? _s : ''),
        paymentDate: String((_t = row[MM_COL.PAYMENT_DATE]) !== null && _t !== void 0 ? _t : ''),
        paymentTransaction: String((_u = row[MM_COL.PAYMENT_TRANSACTION]) !== null && _u !== void 0 ? _u : ''),
        joinYear: String((_v = row[MM_COL.JOIN_YEAR]) !== null && _v !== void 0 ? _v : ''),
        phoneNumber: String((_w = row[MM_COL.PHONE_NUMBER]) !== null && _w !== void 0 ? _w : ''),
        lastLoginDate: String((_x = row[MM_COL.LAST_LOGIN_DATE]) !== null && _x !== void 0 ? _x : ''),
        notes: String((_y = row[MM_COL.NOTES]) !== null && _y !== void 0 ? _y : ''),
    };
}
// ---- Membership-Master-Log (audit trail) ----
/**
 * Copy the current Main table row for memberID into the Log table BEFORE any write.
 * Rule: every function that updates Membership Master must call this first.
 */
function logMainTableRow(memberID) {
    try {
        const mainSheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
        const data = mainSheet.getDataRange().getValues();
        for (let i = 1; i < data.length; i++) {
            if (String(data[i][MM_COL.MEMBER_ID]) === memberID) {
                const logSheet = getSheet(SHEET_NAMES.MEMBERSHIP_LOG);
                const logRow = [
                    generateMasterLogID(),
                    new Date().toISOString(),
                    ...data[i], // All Main table columns verbatim
                ];
                logSheet.appendRow(logRow);
                return;
            }
        }
        // If member not found, log a warning but don't throw — write must proceed
        console.warn(`[logMainTableRow] memberID not found: ${memberID}`);
    }
    catch (e) {
        // Logging must never crash the main flow
        console.error('[logMainTableRow] failed:', e);
    }
}
function findMemberByEmail(email) {
    const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][MM_COL.EMAIL]).toLowerCase() === email.toLowerCase()) {
            return { member: rowToMember(data[i]), rowIndex: i + 1 };
        }
    }
    return null;
}
function findMemberByID(memberID) {
    const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][MM_COL.MEMBER_ID]) === memberID) {
            return { member: rowToMember(data[i]), rowIndex: i + 1 };
        }
    }
    return null;
}
function findMembersByFamilyID(familyID) {
    const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    const data = sheet.getDataRange().getValues();
    const results = [];
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][MM_COL.FAMILY_ID]) === familyID) {
            results.push({ member: rowToMember(data[i]), rowIndex: i + 1 });
        }
    }
    return results;
}
function generateMemberID() {
    const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    const data = sheet.getDataRange().getValues();
    const used = new Set();
    for (let i = 1; i < data.length; i++) {
        const m = String(data[i][MM_COL.MEMBER_ID]).match(/^A(\d{4})$/);
        if (m)
            used.add(parseInt(m[1], 10));
    }
    for (let n = 1; n <= 9999; n++) {
        if (!used.has(n))
            return 'A' + String(n).padStart(4, '0');
    }
    throw new Error('No available member IDs (A0001–A9999 all in use).');
}
function generateFamilyID() {
    const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    const data = sheet.getDataRange().getValues();
    const used = new Set();
    for (let i = 1; i < data.length; i++) {
        const m = String(data[i][MM_COL.FAMILY_ID]).match(/^B(\d{3})$/);
        if (m)
            used.add(parseInt(m[1], 10));
    }
    for (let n = 1; n <= 999; n++) {
        if (!used.has(n))
            return 'B' + String(n).padStart(3, '0');
    }
    throw new Error('No available family IDs B001–B999 all in use.');
}
// Returns all members sharing a FamilyID
function getMembersByFamilyID(familyID) {
    const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    if (!sheet)
        return [];
    const rows = sheet.getDataRange().getValues();
    return rows.slice(1)
        .filter(row => String(row[MM_COL.FAMILY_ID]).trim() === familyID.trim())
        .map(row => rowToMember(row));
}
function updateMemberRow(rowIndex, updates) {
    const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    for (const [colKey, value] of Object.entries(updates)) {
        const colIndex = MM_COL[colKey];
        if (colIndex !== undefined) {
            sheet.getRange(rowIndex, colIndex + 1).setValue(value);
        }
    }
}
// ---- WebApp-Events ----
function rowToWebAppEvent(row) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v, _w, _x, _y, _z;
    return {
        eventID: String((_a = row[WE_COL.EVENT_ID]) !== null && _a !== void 0 ? _a : ''),
        eventType: String((_b = row[WE_COL.EVENT_TYPE]) !== null && _b !== void 0 ? _b : ''),
        timestamp: String((_c = row[WE_COL.TIMESTAMP]) !== null && _c !== void 0 ? _c : ''),
        expiresAt: String((_d = row[WE_COL.EXPIRES_AT]) !== null && _d !== void 0 ? _d : ''),
        memberID: String((_e = row[WE_COL.MEMBER_ID]) !== null && _e !== void 0 ? _e : ''),
        email: String((_f = row[WE_COL.EMAIL]) !== null && _f !== void 0 ? _f : ''),
        paymentIntent: String((_g = row[WE_COL.PAYMENT_INTENT]) !== null && _g !== void 0 ? _g : ''),
        amount: Number((_h = row[WE_COL.AMOUNT]) !== null && _h !== void 0 ? _h : 0),
        paymentMethod: String((_j = row[WE_COL.PAYMENT_METHOD]) !== null && _j !== void 0 ? _j : ''),
        payerName: String((_k = row[WE_COL.PAYER_NAME]) !== null && _k !== void 0 ? _k : ''),
        memoField: String((_l = row[WE_COL.MEMO_FIELD]) !== null && _l !== void 0 ? _l : ''),
        last4Digits: String((_m = row[WE_COL.LAST_4_DIGITS]) !== null && _m !== void 0 ? _m : ''),
        familyMemberEmails: String((_o = row[WE_COL.FAMILY_MEMBER_EMAILS]) !== null && _o !== void 0 ? _o : ''),
        status: String((_p = row[WE_COL.STATUS]) !== null && _p !== void 0 ? _p : ''),
        matchedMessageId: String((_q = row[WE_COL.MATCHED_MESSAGE_ID]) !== null && _q !== void 0 ? _q : ''),
        matchedTransactionNumber: String((_r = row[WE_COL.MATCHED_TRANSACTION_NUMBER]) !== null && _r !== void 0 ? _r : ''),
        adminApprover: String((_s = row[WE_COL.ADMIN_APPROVER]) !== null && _s !== void 0 ? _s : ''),
        approvalDate: String((_t = row[WE_COL.APPROVAL_DATE]) !== null && _t !== void 0 ? _t : ''),
        notes: String((_u = row[WE_COL.NOTES]) !== null && _u !== void 0 ? _u : ''),
        paymentDate: String((_v = row[WE_COL.PAYMENT_DATE]) !== null && _v !== void 0 ? _v : ''),
        screenshotFileId: String((_w = row[WE_COL.SCREENSHOT_FILE_ID]) !== null && _w !== void 0 ? _w : ''),
        gdriveFilePath: String((_x = row[WE_COL.GDRIVE_FILE_PATH]) !== null && _x !== void 0 ? _x : ''),
        ocrText: String((_y = row[WE_COL.OCR_TEXT]) !== null && _y !== void 0 ? _y : ''),
        ocrTimestamp: String((_z = row[WE_COL.OCR_TIMESTAMP]) !== null && _z !== void 0 ? _z : ''),
    };
}
function appendWebAppEvent(event) {
    var _a, _b, _c, _d, _e;
    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    const eventID = generateEventID();
    sheet.appendRow([
        eventID,
        event.eventType,
        event.timestamp,
        event.expiresAt,
        event.memberID,
        event.email,
        event.paymentIntent,
        event.amount,
        event.paymentMethod,
        event.payerName,
        event.memoField,
        event.last4Digits,
        event.familyMemberEmails,
        event.status,
        '', '', '', '', '', // MatchedMessageId … Notes
        (_a = event.paymentDate) !== null && _a !== void 0 ? _a : '',
        (_b = event.screenshotFileId) !== null && _b !== void 0 ? _b : '',
        (_c = event.gdriveFilePath) !== null && _c !== void 0 ? _c : '',
        (_d = event.ocrText) !== null && _d !== void 0 ? _d : '',
        (_e = event.ocrTimestamp) !== null && _e !== void 0 ? _e : '',
    ]);
    return eventID;
}
function findWebAppEvent(eventID) {
    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][WE_COL.EVENT_ID]) === eventID) {
            return { event: rowToWebAppEvent(data[i]), rowIndex: i + 1 };
        }
    }
    return null;
}
function getPendingWebAppEvents() {
    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    const data = sheet.getDataRange().getValues();
    const events = [];
    for (let i = 1; i < data.length; i++) {
        const status = String(data[i][WE_COL.STATUS]);
        if (status === 'Pending' || status === 'Matched') {
            events.push(rowToWebAppEvent(data[i]));
        }
    }
    return events;
}
// Returns all pending payment-type events for a specific member.
// Used by the dashboard to determine catch-all gate state.
function getPendingPaymentEventsForMember(memberID) {
    const PAYMENT_TYPES = new Set([
        'dues_payment', 'family_switch', 'family_upgrade',
    ]);
    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    const data = sheet.getDataRange().getValues();
    const events = [];
    for (let i = 1; i < data.length; i++) {
        if (String(data[i][WE_COL.MEMBER_ID]) === memberID &&
            String(data[i][WE_COL.STATUS]) === 'Pending' &&
            PAYMENT_TYPES.has(String(data[i][WE_COL.EVENT_TYPE]))) {
            events.push(rowToWebAppEvent(data[i]));
        }
    }
    return events;
}
function updateWebAppEventRow(rowIndex, updates) {
    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    for (const [colKey, value] of Object.entries(updates)) {
        const colIndex = WE_COL[colKey];
        if (colIndex !== undefined) {
            sheet.getRange(rowIndex, colIndex + 1).setValue(value);
        }
    }
}
// ---- Payment-History ----
function appendPaymentRecord(record) {
    const sheet = getSheet(SHEET_NAMES.PAYMENT_HISTORY);
    const paymentID = generatePaymentID();
    sheet.appendRow([
        paymentID,
        record.eventID,
        record.memberID,
        record.paymentDate,
        record.amount,
        record.paymentIntent,
        record.paymentMethod,
        record.payerName,
        record.memoField,
        record.last4Digits,
        record.transactionReference,
        record.periodStart,
        record.periodEnd,
        record.processedBy,
        record.processedDate,
        record.source,
        record.notes,
    ]);
    return paymentID;
}
// ---- Fetch Gmail ----
function getUnmatchedGmailPayments() {
    const sheet = getSheet(SHEET_NAMES.FETCH_GMAIL);
    const data = sheet.getDataRange().getValues();
    const results = [];
    for (let i = 1; i < data.length; i++) {
        const processed = data[i][FG_COL.PROCESSED];
        if (!processed || String(processed).toUpperCase() === 'FALSE') {
            results.push(rowToFetchGmailRow(data[i], i + 1));
        }
    }
    return results;
}
function rowToFetchGmailRow(row, rowIndex) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    return {
        timestamp: String((_a = row[FG_COL.TIMESTAMP]) !== null && _a !== void 0 ? _a : ''),
        sender: String((_b = row[FG_COL.SENDER]) !== null && _b !== void 0 ? _b : ''),
        amount: Number((_c = row[FG_COL.AMOUNT]) !== null && _c !== void 0 ? _c : 0),
        memo: String((_d = row[FG_COL.MEMO]) !== null && _d !== void 0 ? _d : ''),
        transactionDate: String((_e = row[FG_COL.TRANSACTION_DATE]) !== null && _e !== void 0 ? _e : ''),
        transactionNumber: String((_f = row[FG_COL.TRANSACTION_NUMBER]) !== null && _f !== void 0 ? _f : ''),
        messageId: String((_g = row[FG_COL.MESSAGE_ID]) !== null && _g !== void 0 ? _g : ''),
        subject: String((_h = row[FG_COL.SUBJECT]) !== null && _h !== void 0 ? _h : ''),
        originalMemo: String((_j = row[FG_COL.ORIGINAL_MEMO]) !== null && _j !== void 0 ? _j : ''),
        notes: String((_k = row[FG_COL.NOTES]) !== null && _k !== void 0 ? _k : ''),
        processed: Boolean(row[FG_COL.PROCESSED]),
        source: String((_l = row[FG_COL.SOURCE]) !== null && _l !== void 0 ? _l : ''),
        webAppEventID: String((_m = row[FG_COL.WEBAPP_EVENT_ID]) !== null && _m !== void 0 ? _m : ''),
        rowIndex,
    };
}
function markGmailPaymentProcessed(rowIndex, eventID) {
    const sheet = getSheet(SHEET_NAMES.FETCH_GMAIL);
    sheet.getRange(rowIndex, FG_COL.PROCESSED + 1).setValue(true);
    sheet.getRange(rowIndex, FG_COL.WEBAPP_EVENT_ID + 1).setValue(eventID);
}
function getPaymentHistoryByMemberID(memberID) {
    const sheet = getSheet(SHEET_NAMES.PAYMENT_HISTORY);
    if (!sheet)
        return [];
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const col = (name) => headers.indexOf(name);
    return rows.slice(1)
        .filter(row => row[col('MemberID')] === memberID)
        .map(row => ({
        paymentID: String(row[col('PaymentID')] || ''),
        eventID: String(row[col('EventID')] || ''),
        paymentDate: String(row[col('PaymentDate')] || ''),
        amount: Number(row[col('Amount')] || 0),
        paymentIntent: String(row[col('PaymentIntent')] || ''),
        paymentMethod: String(row[col('PaymentMethod')] || ''),
        payerName: String(row[col('PayerName')] || ''),
        periodStart: String(row[col('PeriodStart')] || ''),
        periodEnd: String(row[col('PeriodEnd')] || ''),
        source: String(row[col('Source')] || ''),
        notes: String(row[col('Notes')] || ''),
    }));
}
function getWebAppEventsByMemberID(memberID) {
    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    if (!sheet)
        return [];
    const rows = sheet.getDataRange().getValues();
    const headers = rows[0];
    const col = (name) => headers.indexOf(name);
    return rows.slice(1)
        .filter(row => row[col('MemberID')] === memberID)
        .map(row => ({
        eventID: String(row[col('EventID')] || ''),
        eventType: String(row[col('EventType')] || ''),
        timestamp: String(row[col('Timestamp')] || ''),
        paymentIntent: String(row[col('PaymentIntent')] || ''),
        amount: Number(row[col('Amount')] || 0),
        paymentMethod: String(row[col('PaymentMethod')] || ''),
        status: String(row[col('Status')] || ''),
        notes: String(row[col('Notes')] || ''),
        paymentDate: String(row[col('PaymentDate')] || ''),
        screenshotFileId: String(row[col('ScreenshotFileId')] || ''),
        gdriveFilePath: String(row[col('GDriveFilePath')] || ''),
        ocrText: String(row[col('OCRText')] || ''),
        ocrTimestamp: String(row[col('OCRTimestamp')] || ''),
    }));
}
// ── globalThis exports for test environment ──────────────────
globalThis.deriveStatus = deriveStatus;
globalThis.rowToMember = rowToMember;
globalThis.logMainTableRow = logMainTableRow;
globalThis.findMemberByEmail = findMemberByEmail;
globalThis.findMemberByID = findMemberByID;
globalThis.findMembersByFamilyID = findMembersByFamilyID;
globalThis.getMembersByFamilyID = getMembersByFamilyID;
globalThis.generateMemberID = generateMemberID;
globalThis.generateFamilyID = generateFamilyID;
globalThis.generateMasterLogID = generateMasterLogID;
globalThis.updateMemberRow = updateMemberRow;
globalThis.appendWebAppEvent = appendWebAppEvent;
globalThis.findWebAppEvent = findWebAppEvent;
globalThis.getPendingWebAppEvents = getPendingWebAppEvents;
globalThis.getPendingPaymentEventsForMember = getPendingPaymentEventsForMember;
globalThis.updateWebAppEventRow = updateWebAppEventRow;
globalThis.appendPaymentRecord = appendPaymentRecord;
globalThis.getUnmatchedGmailPayments = getUnmatchedGmailPayments;
globalThis.markGmailPaymentProcessed = markGmailPaymentProcessed;
globalThis.getPaymentHistoryByMemberID = getPaymentHistoryByMemberID;
globalThis.getWebAppEventsByMemberID = getWebAppEventsByMemberID;
globalThis.generateEventID = generateEventID;
globalThis.generatePaymentID = generatePaymentID;
globalThis.generateLogID = generateLogID;
