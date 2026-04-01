// ============================================================
// Webhook endpoint for mmr-admin → Google Sheets sync
//
// Receives POST requests from Python api_sheets_sync.py and
// supports two groups of actions:
//
// Single-row operations (write-only):
//   member_updated        — sync any member field changes
//   event_status_updated  — update webapp_event status
//   payment_created       — append to Payment-History
//
// Batch sync operations (read-write):
//   get_members/events/payments/transactions      — fetch all rows
//   append_members/events/payments                — insert new rows
//   update_members/events/payments                — update existing rows
//
// Deploy: Apps Script → Deploy → Manage deployments →
//   Edit existing → New version → Deploy.
//   URL goes in MySQL config table (SheetsWebhookUrl).
//
// Depends on: config.ts, sheets.ts, types.ts, email_hook.ts
// ============================================================

/**
 * Map from Python field names (sent by sync_member_to_sheets)
 * to MM_COL indices. This is the single source of truth for
 * the Python↔Sheets field mapping.
 */
const FIELD_TO_COL: Record<string, number> = {
  'Status':             MM_COL.STATUS,
  'Expiration':         MM_COL.EXPIRATION,
  'Email':              MM_COL.EMAIL,
  'FirstName':          MM_COL.FIRST_NAME,
  'LastName':           MM_COL.LAST_NAME,
  'Type':               MM_COL.TYPE,
  'FamilyID':           MM_COL.FAMILY_ID,
  'Gender':             MM_COL.GENDER,
  'WeChatID':           MM_COL.WECHAT_ID,
  'District':           MM_COL.DISTRICT,
  'MembershipFeePaid':  MM_COL.MEMBERSHIP_FEE_PAID,
  'PaymentDate':        MM_COL.PAYMENT_DATE,
  'PaymentTransaction': MM_COL.PAYMENT_TRANSACTION,
  'LastUpdated':        MM_COL.LAST_UPDATED,
  'PhoneNumber':        MM_COL.PHONE_NUMBER,
  'Notes':              MM_COL.NOTES,
  'NYRRRunnerName':     MM_COL.NYRR_RUNNER_NAME,
  'YearBorn':           MM_COL.YEAR_BORN,
};


// ---------------------------------------------------------------------------
// doPost — route to action handler
// ---------------------------------------------------------------------------

function doPost(e: GoogleAppsScript.Events.DoPost): GoogleAppsScript.Content.TextOutput {
  console.log('[doPost] request received');
  console.log('[doPost] postData type:', e?.postData?.type ?? 'MISSING');
  console.log('[doPost] postData contents:', e?.postData?.contents?.substring(0, 300) ?? 'MISSING');
  try {
    if (!e?.postData?.contents) {
      console.error('[doPost] Empty or missing postData');
      return jsonResponse({ ok: false, error: 'Empty request body' });
    }
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;
    console.log('[doPost] action:', action);

    switch (action) {
      // Email sending
      case 'email_send':
        return handleEmailSend(payload);
      // Single-row operations
      case 'member_updated':
        return handleMemberUpdated(payload);
      case 'event_status_updated':
        return handleEventStatusUpdated(payload);
      case 'payment_created':
        return handlePaymentCreated(payload);
      // Batch sync — GET operations
      case 'get_transactions':
        return handleGetTransactions(payload);
      case 'get_members':
        return handleGetMembers(payload);
      case 'get_events':
        return handleGetEvents(payload);
      case 'get_payments':
        return handleGetPayments(payload);
      // Batch sync — APPEND operations
      case 'append_members':
        return handleAppendMembers(payload);
      case 'append_events':
        return handleAppendEvents(payload);
      case 'append_payments':
        return handleAppendPayments(payload);
      // Batch sync — UPDATE operations
      case 'update_members':
        return handleUpdateMembers(payload);
      case 'update_events':
        return handleUpdateEvents(payload);
      case 'update_payments':
        return handleUpdatePayments(payload);
      // Legacy — kept for backward compat during rollout
      case 'payment_approved':
        return handlePaymentApproved(payload);
      default:
        return jsonResponse({ ok: false, error: `Unknown action: ${action}` });
    }
  } catch (err: any) {
    console.error('[webhook] doPost error:', err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}


// ---------------------------------------------------------------------------
// Action: member_updated
// Syncs any changed fields for a single member from MySQL → Sheets
// ---------------------------------------------------------------------------

function handleMemberUpdated(payload: any): GoogleAppsScript.Content.TextOutput {
  const { memberId, fields, changedBy } = payload;

  if (!memberId || !fields) {
    return jsonResponse({ ok: false, error: 'memberId and fields required' });
  }

  console.log(`[webhook] member_updated: ${memberId} by ${changedBy || 'unknown'}, fields: ${Object.keys(fields).join(', ')}`);

  try {
    // Build the updates object mapping MM_COL index → value
    const updates: Record<number, any> = {};
    for (const [fieldName, value] of Object.entries(fields)) {
      const colIndex = FIELD_TO_COL[fieldName];
      if (colIndex !== undefined) {
        updates[colIndex] = value;
      } else {
        console.warn(`[webhook] Unknown field name: ${fieldName} — skipping`);
      }
    }

    if (Object.keys(updates).length === 0) {
      return jsonResponse({ ok: true, message: 'No mappable fields — nothing to update' });
    }

    // updateMemberWithLog logs the before-state, then applies updates
    updateMemberWithLog(memberId, updates);

    return jsonResponse({
      ok: true,
      memberId,
      updatedFields: Object.keys(fields).filter(f => FIELD_TO_COL[f] !== undefined),
    });
  } catch (err: any) {
    console.error(`[webhook] Failed to update member ${memberId}:`, err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}


// ---------------------------------------------------------------------------
// Action: event_status_updated
// Updates a webapp_event row status in the WebApp-Events sheet
// ---------------------------------------------------------------------------

function handleEventStatusUpdated(payload: any): GoogleAppsScript.Content.TextOutput {
  const { eventId, status, adminApprover } = payload;

  if (!eventId || !status) {
    return jsonResponse({ ok: false, error: 'eventId and status required' });
  }

  console.log(`[webhook] event_status_updated: ${eventId} → ${status}`);

  try {
    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    const data = sheet.getDataRange().getValues();
    let found = false;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][WE_COL.EVENT_ID]) === eventId) {
        // Capitalize first letter to match Sheets convention (Approved, Rejected, etc.)
        const sheetStatus = status.charAt(0).toUpperCase() + status.slice(1);
        sheet.getRange(i + 1, WE_COL.STATUS + 1).setValue(sheetStatus);

        if (adminApprover) {
          sheet.getRange(i + 1, WE_COL.ADMIN_APPROVER + 1).setValue(adminApprover);
        }
        if (status === 'approved' || status === 'rejected') {
          sheet.getRange(i + 1, WE_COL.APPROVAL_DATE + 1).setValue(new Date().toISOString());
        }

        found = true;
        break;
      }
    }

    return jsonResponse({ ok: true, eventId, status, found });
  } catch (err: any) {
    console.error(`[webhook] Failed to update event ${eventId}:`, err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}


// ---------------------------------------------------------------------------
// Action: payment_created
// Appends a new row to the Payment-History sheet
// ---------------------------------------------------------------------------

function handlePaymentCreated(payload: any): GoogleAppsScript.Content.TextOutput {
  const { paymentId, eventId, memberId, amount, paymentIntent, periodEnd, source } = payload;

  if (!paymentId || !memberId) {
    return jsonResponse({ ok: false, error: 'paymentId and memberId required' });
  }

  console.log(`[webhook] payment_created: ${paymentId} for ${memberId}`);

  try {
    const sheet = getSheet(SHEET_NAMES.PAYMENT_HISTORY);
    sheet.appendRow([
      paymentId,                          // PaymentID
      eventId || '',                      // EventID
      memberId,                           // MemberID
      new Date().toISOString(),           // PaymentDate
      amount || '',                       // Amount
      paymentIntent || '',                // PaymentIntent
      '',                                 // PaymentMethod
      '',                                 // PayerName
      '',                                 // MemoField
      '',                                 // Last4Digits
      '',                                 // TransactionReference
      '',                                 // PeriodStart
      periodEnd || '',                    // PeriodEnd
      'mmr-admin',                        // ProcessedBy
      new Date().toISOString(),           // ProcessedDate
      source || 'mmr-admin',             // Source
      'Synced from mmr-admin',           // Notes
    ]);

    return jsonResponse({ ok: true, paymentId });
  } catch (err: any) {
    console.error('[webhook] Failed to create payment history:', err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}


// ---------------------------------------------------------------------------
// Action: get_transactions
// Fetches all transactions from the Fetch-Gmail sheet
// Returns array of FetchGmailRow objects
// ---------------------------------------------------------------------------

function handleGetTransactions(payload: any): GoogleAppsScript.Content.TextOutput {
  console.log('[webhook] get_transactions: fetching all gmail transactions');

  try {
    const sheet = getSheet(SHEET_NAMES.FETCH_GMAIL);
    const data = sheet.getDataRange().getValues();
    const transactions: FetchGmailRow[] = [];

    // Row 0 is header; start from row 1
    for (let i = 1; i < data.length; i++) {
      transactions.push(rowToFetchGmailRow(data[i], i + 1));
    }

    console.log(`[webhook] get_transactions: returning ${transactions.length} transactions`);
    return jsonResponse({ ok: true, data: transactions });
  } catch (err: any) {
    console.error('[webhook] Failed to fetch transactions:', err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}


// ---------------------------------------------------------------------------
// Batch sync handlers for mmr-admin MySQL → Sheets
// Supports full data syncing: get_*, append_*, update_*
// ---------------------------------------------------------------------------

// GET handlers — return all rows from sheet as array of objects

function handleGetMembers(payload: any): GoogleAppsScript.Content.TextOutput {
  console.log('[webhook] get_members: fetching all members');
  try {
    const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    const data = sheet.getDataRange().getValues();
    const members: any[] = [];
    for (let i = 1; i < data.length; i++) {
      members.push(rowToMemberObject(data[i]));
    }
    console.log(`[webhook] get_members: returning ${members.length} members`);
    return jsonResponse({ ok: true, data: members });
  } catch (err: any) {
    console.error('[webhook] Failed to fetch members:', err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

function handleGetEvents(payload: any): GoogleAppsScript.Content.TextOutput {
  console.log('[webhook] get_events: fetching all events');
  try {
    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    const data = sheet.getDataRange().getValues();
    const events: any[] = [];
    for (let i = 1; i < data.length; i++) {
      events.push(rowToEventObject(data[i]));
    }
    console.log(`[webhook] get_events: returning ${events.length} events`);
    return jsonResponse({ ok: true, data: events });
  } catch (err: any) {
    console.error('[webhook] Failed to fetch events:', err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

function handleGetPayments(payload: any): GoogleAppsScript.Content.TextOutput {
  console.log('[webhook] get_payments: fetching all payments');
  try {
    const sheet = getSheet(SHEET_NAMES.PAYMENT_HISTORY);
    const data = sheet.getDataRange().getValues();
    const payments: any[] = [];
    for (let i = 1; i < data.length; i++) {
      payments.push(rowToPaymentObject(data[i]));
    }
    console.log(`[webhook] get_payments: returning ${payments.length} payments`);
    return jsonResponse({ ok: true, data: payments });
  } catch (err: any) {
    console.error('[webhook] Failed to fetch payments:', err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

// APPEND handlers — insert new rows to sheet

function handleAppendMembers(payload: any): GoogleAppsScript.Content.TextOutput {
  console.log('[webhook] append_members: inserting new members');
  const { rows } = payload;
  if (!Array.isArray(rows)) {
    return jsonResponse({ ok: false, error: 'rows must be an array' });
  }
  try {
    const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    const data = sheet.getDataRange().getValues();

    // Safety check: detect if any rows already exist (would be duplicates)
    const existingIds: string[] = [];
    for (let i = 1; i < data.length; i++) {
      existingIds.push(String(data[i][MM_COL.MEMBER_ID] || '').trim());
    }

    let insertedCount = 0;
    let duplicateCount = 0;

    for (const row of rows) {
      const memberId = String(row.MemberID || row.memberID || '').trim();
      if (existingIds.includes(memberId)) {
        duplicateCount++;
        console.warn(`[webhook] DUPLICATE DETECTED: Trying to append ${memberId} but it already exists!`);
      } else {
        const sheetRow = memberObjectToRow(row);
        sheet.appendRow(sheetRow);
        insertedCount++;
        console.log(`[webhook] Appended new member: ${memberId}`);
      }
    }

    console.log(`[webhook] append_members: inserted=${insertedCount}, duplicates=${duplicateCount}`);
    if (duplicateCount > 0) {
      console.error(`[webhook] ⚠️ ALERT: Attempted to append ${duplicateCount} duplicate members!`);
    }
    return jsonResponse({ ok: true, data: { inserted: insertedCount, duplicates: duplicateCount } });
  } catch (err: any) {
    console.error('[webhook] Failed to append members:', err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

function handleAppendEvents(payload: any): GoogleAppsScript.Content.TextOutput {
  console.log('[webhook] append_events: inserting new events');
  const { rows } = payload;
  if (!Array.isArray(rows)) {
    return jsonResponse({ ok: false, error: 'rows must be an array' });
  }
  try {
    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    for (const row of rows) {
      const sheetRow = eventObjectToRow(row);
      sheet.appendRow(sheetRow);
    }
    console.log(`[webhook] append_events: inserted ${rows.length} events`);
    return jsonResponse({ ok: true, data: { inserted: rows.length } });
  } catch (err: any) {
    console.error('[webhook] Failed to append events:', err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

function handleAppendPayments(payload: any): GoogleAppsScript.Content.TextOutput {
  console.log('[webhook] append_payments: inserting new payments');
  const { rows } = payload;
  if (!Array.isArray(rows)) {
    return jsonResponse({ ok: false, error: 'rows must be an array' });
  }
  try {
    const sheet = getSheet(SHEET_NAMES.PAYMENT_HISTORY);
    for (const row of rows) {
      const sheetRow = paymentObjectToRow(row);
      sheet.appendRow(sheetRow);
    }
    console.log(`[webhook] append_payments: inserted ${rows.length} payments`);
    return jsonResponse({ ok: true, data: { inserted: rows.length } });
  } catch (err: any) {
    console.error('[webhook] Failed to append payments:', err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

// UPDATE handlers — update existing rows by primary key

function handleUpdateMembers(payload: any): GoogleAppsScript.Content.TextOutput {
  console.log('[webhook] update_members: updating members');
  const { rows } = payload;
  if (!Array.isArray(rows)) {
    return jsonResponse({ ok: false, error: 'rows must be an array' });
  }
  try {
    const sheet = getSheet(SHEET_NAMES.MEMBERSHIP_MASTER);
    const data = sheet.getDataRange().getValues();

    // Safety check: ensure data is valid 2D array
    if (!Array.isArray(data) || data.length < 1) {
      console.error('[webhook] Sheet data is invalid or empty');
      return jsonResponse({ ok: false, error: 'Sheet data is invalid or empty', data: { updated: 0 } });
    }

    let updated = 0;
    let notFound = [];

    for (const row of rows) {
      const memberId = row.MemberID || row.memberID;
      if (!memberId) {
        console.warn('[webhook] Skipping row with missing MemberID');
        continue;
      }

      let found = false;
      for (let i = 1; i < data.length; i++) {
        const sheetMemberId = String(data[i][MM_COL.MEMBER_ID] || '').trim();
        if (sheetMemberId === String(memberId).trim()) {
          const sheetRow = memberObjectToRow(row);
          for (let j = 0; j < sheetRow.length; j++) {
            sheet.getRange(i + 1, j + 1).setValue(sheetRow[j]);
          }
          console.log(`[webhook] Updated member: ${memberId} at row ${i + 1}`);
          updated++;
          found = true;
          break;
        }
      }

      if (!found) {
        notFound.push(memberId);
        console.warn(`[webhook] Member NOT FOUND in sheet (will be appended): ${memberId}`);
      }
    }

    console.log(`[webhook] update_members: updated=${updated}, notFound=${notFound.length}`);
    return jsonResponse({ ok: true, data: { updated, notFound } });
  } catch (err: any) {
    console.error('[webhook] Failed to update members:', err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

function handleUpdateEvents(payload: any): GoogleAppsScript.Content.TextOutput {
  console.log('[webhook] update_events: updating events');
  const { rows } = payload;
  if (!Array.isArray(rows)) {
    return jsonResponse({ ok: false, error: 'rows must be an array' });
  }
  try {
    const sheet = getSheet(SHEET_NAMES.WEBAPP_EVENTS);
    const data = sheet.getDataRange().getValues();
    let updated = 0;

    for (const row of rows) {
      const eventId = row.EventID || row.eventID;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][WE_COL.EVENT_ID]) === eventId) {
          const sheetRow = eventObjectToRow(row);
          for (let j = 0; j < sheetRow.length; j++) {
            sheet.getRange(i + 1, j + 1).setValue(sheetRow[j]);
          }
          updated++;
          break;
        }
      }
    }
    console.log(`[webhook] update_events: updated ${updated} events`);
    return jsonResponse({ ok: true, data: { updated } });
  } catch (err: any) {
    console.error('[webhook] Failed to update events:', err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

function handleUpdatePayments(payload: any): GoogleAppsScript.Content.TextOutput {
  console.log('[webhook] update_payments: updating payments');
  const { rows } = payload;
  if (!Array.isArray(rows)) {
    return jsonResponse({ ok: false, error: 'rows must be an array' });
  }
  try {
    const sheet = getSheet(SHEET_NAMES.PAYMENT_HISTORY);
    const data = sheet.getDataRange().getValues();
    let updated = 0;

    for (const row of rows) {
      const paymentId = row.PaymentID || row.paymentID;
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][PH_COL.PAYMENT_ID]) === paymentId) {
          const sheetRow = paymentObjectToRow(row);
          for (let j = 0; j < sheetRow.length; j++) {
            sheet.getRange(i + 1, j + 1).setValue(sheetRow[j]);
          }
          updated++;
          break;
        }
      }
    }
    console.log(`[webhook] update_payments: updated ${updated} payments`);
    return jsonResponse({ ok: true, data: { updated } });
  } catch (err: any) {
    console.error('[webhook] Failed to update payments:', err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}


// ---------------------------------------------------------------------------
// Helper functions to convert between row arrays and objects
// ---------------------------------------------------------------------------

function rowToMemberObject(row: any[]): any {
  return {
    MemberID: row[MM_COL.MEMBER_ID],
    Status: row[MM_COL.STATUS],
    Created: toISO8601(row[MM_COL.CREATED]) || '',
    Expiration: toISODateString(row[MM_COL.EXPIRATION]) || '',
    Email: row[MM_COL.EMAIL],
    FirstName: row[MM_COL.FIRST_NAME],
    LastName: row[MM_COL.LAST_NAME],
    Type: row[MM_COL.TYPE],
    FamilyID: row[MM_COL.FAMILY_ID],
    Gender: row[MM_COL.GENDER],
    WeChatID: row[MM_COL.WECHAT_ID],
    District: row[MM_COL.DISTRICT],
    WebApp: row[MM_COL.WEBAPP],
    PaymentCheck: row[MM_COL.PAYMENT_CHECK],
    Info: row[MM_COL.INFO],
    LastUpdated: toISO8601(row[MM_COL.LAST_UPDATED]) || '',
    MembershipFeePaid: row[MM_COL.MEMBERSHIP_FEE_PAID],
    PaymentDate: toISODateString(row[MM_COL.PAYMENT_DATE]) || '',
    PaymentTransaction: row[MM_COL.PAYMENT_TRANSACTION],
    JoinYear: row[MM_COL.JOIN_YEAR],
    PhoneNumber: row[MM_COL.PHONE_NUMBER],
    LastLoginDate: toISO8601(row[MM_COL.LAST_LOGIN_DATE]) || '',
    ProfileLastUpdated: toISO8601(row[MM_COL.PROFILE_LAST_UPDATED]) || '',
    Notes: row[MM_COL.NOTES],
    NYRRRunnerName: row[MM_COL.NYRR_RUNNER_NAME],
    YearBorn: row[MM_COL.YEAR_BORN],
  };
}

function memberObjectToRow(obj: any): any[] {
  return [
    obj.MemberID || obj.memberID || '',
    obj.Status || obj.status || '',
    obj.Created || obj.created || '',
    obj.Expiration || obj.expiration || '',
    obj.Email || obj.email || '',
    obj.FirstName || obj.firstName || '',
    obj.LastName || obj.lastName || '',
    obj.Type || obj.type || '',
    obj.FamilyID || obj.familyID || '',
    obj.Gender || obj.gender || '',
    obj.WeChatID || obj.wechatID || '',
    obj.District || obj.district || '',
    obj.WebApp || obj.webApp || '',
    obj.PaymentCheck || obj.paymentCheck || '',
    obj.Info || obj.info || '',
    obj.LastUpdated || obj.lastUpdated || '',
    obj.MembershipFeePaid || obj.membershipFeePaid || '',
    obj.PaymentDate || obj.paymentDate || '',
    obj.PaymentTransaction || obj.paymentTransaction || '',
    obj.JoinYear || obj.joinYear || '',
    obj.PhoneNumber || obj.phoneNumber || '',
    obj.LastLoginDate || obj.lastLoginDate || '',
    obj.ProfileLastUpdated || obj.profileLastUpdated || '',
    obj.Notes || obj.notes || '',
    obj.NYRRRunnerName || obj.nyrRRunnerName || '',
    obj.YearBorn || obj.yearBorn || '',
  ];
}

function rowToEventObject(row: any[]): any {
  return {
    EventID: row[WE_COL.EVENT_ID],
    EventType: row[WE_COL.EVENT_TYPE],
    Timestamp: toISO8601(row[WE_COL.TIMESTAMP]) || '',
    ExpiresAt: toISO8601(row[WE_COL.EXPIRES_AT]) || '',
    MemberID: row[WE_COL.MEMBER_ID],
    Email: row[WE_COL.EMAIL],
    PaymentIntent: row[WE_COL.PAYMENT_INTENT],
    Amount: row[WE_COL.AMOUNT],
    PaymentMethod: row[WE_COL.PAYMENT_METHOD],
    PayerName: row[WE_COL.PAYER_NAME],
    MemoField: row[WE_COL.MEMO_FIELD],
    Last4Digits: row[WE_COL.LAST_4_DIGITS],
    FamilyMemberEmails: row[WE_COL.FAMILY_MEMBER_EMAILS],
    Status: row[WE_COL.STATUS],
    MatchedMessageId: row[WE_COL.MATCHED_MESSAGE_ID],
    MatchedTransactionNumber: row[WE_COL.MATCHED_TRANSACTION_NUMBER],
    AdminApprover: row[WE_COL.ADMIN_APPROVER],
    ApprovalDate: toISO8601(row[WE_COL.APPROVAL_DATE]) || '',
    Notes: row[WE_COL.NOTES],
    PaymentDate: toISODateString(row[WE_COL.PAYMENT_DATE]) || '',
    ScreenshotFileId: row[WE_COL.SCREENSHOT_FILE_ID],
    GdriveFilePath: row[WE_COL.GDRIVE_FILE_PATH],
    OcrText: row[WE_COL.OCR_TEXT],
    OcrTimestamp: row[WE_COL.OCR_TIMESTAMP],
    UpdatedAt: row[WE_COL.TIMESTAMP], // Use TIMESTAMP as proxy for versioning
  };
}

function eventObjectToRow(obj: any): any[] {
  return [
    obj.EventID || obj.eventID || '',
    obj.EventType || obj.eventType || '',
    obj.Timestamp || obj.timestamp || '',
    obj.ExpiresAt || obj.expiresAt || '',
    obj.MemberID || obj.memberID || '',
    obj.Email || obj.email || '',
    obj.PaymentIntent || obj.paymentIntent || '',
    obj.Amount || obj.amount || '',
    obj.PaymentMethod || obj.paymentMethod || '',
    obj.PayerName || obj.payerName || '',
    obj.MemoField || obj.memoField || '',
    obj.Last4Digits || obj.last4Digits || '',
    obj.FamilyMemberEmails || obj.familyMemberEmails || '',
    obj.Status || obj.status || '',
    obj.MatchedMessageId || obj.matchedMessageId || '',
    obj.MatchedTransactionNumber || obj.matchedTransactionNumber || '',
    obj.AdminApprover || obj.adminApprover || '',
    obj.ApprovalDate || obj.approvalDate || '',
    obj.Notes || obj.notes || '',
    obj.PaymentDate || obj.paymentDate || '',
    obj.ScreenshotFileId || obj.screenshotFileId || '',
    obj.GdriveFilePath || obj.gdriveFilePath || '',
    obj.OcrText || obj.ocrText || '',
    obj.OcrTimestamp || obj.ocrTimestamp || '',
  ];
}

function rowToPaymentObject(row: any[]): any {
  return {
    PaymentID: row[PH_COL.PAYMENT_ID],
    EventID: row[PH_COL.EVENT_ID],
    MemberID: row[PH_COL.MEMBER_ID],
    PaymentDate: row[PH_COL.PAYMENT_DATE],
    Amount: row[PH_COL.AMOUNT],
    PaymentIntent: row[PH_COL.PAYMENT_INTENT],
    PaymentMethod: row[PH_COL.PAYMENT_METHOD],
    PayerName: row[PH_COL.PAYER_NAME],
    MemoField: row[PH_COL.MEMO_FIELD],
    Last4Digits: row[PH_COL.LAST_4_DIGITS],
    TransactionReference: row[PH_COL.TRANSACTION_REFERENCE],
    PeriodStart: row[PH_COL.PERIOD_START],
    PeriodEnd: row[PH_COL.PERIOD_END],
    ProcessedBy: row[PH_COL.PROCESSED_BY],
    ProcessedDate: row[PH_COL.PROCESSED_DATE],
    Source: row[PH_COL.SOURCE],
    Notes: row[PH_COL.NOTES],
  };
}

function paymentObjectToRow(obj: any): any[] {
  return [
    obj.PaymentID || obj.paymentID || '',
    obj.EventID || obj.eventID || '',
    obj.MemberID || obj.memberID || '',
    obj.PaymentDate || obj.paymentDate || '',
    obj.Amount || obj.amount || '',
    obj.PaymentIntent || obj.paymentIntent || '',
    obj.PaymentMethod || obj.paymentMethod || '',
    obj.PayerName || obj.payerName || '',
    obj.MemoField || obj.memoField || '',
    obj.Last4Digits || obj.last4Digits || '',
    obj.TransactionReference || obj.transactionReference || '',
    obj.PeriodStart || obj.periodStart || '',
    obj.PeriodEnd || obj.periodEnd || '',
    obj.ProcessedBy || obj.processedBy || '',
    obj.ProcessedDate || obj.processedDate || '',
    obj.Source || obj.source || '',
    obj.Notes || obj.notes || '',
  ];
}


// ---------------------------------------------------------------------------
// Legacy: payment_approved (kept for backward compat)
// Delegates to the individual handlers above
// ---------------------------------------------------------------------------

function handlePaymentApproved(payload: any): GoogleAppsScript.Content.TextOutput {
  const results: string[] = [];

  // Sync each member
  if (payload.updatedMembers && Array.isArray(payload.updatedMembers)) {
    for (const mid of payload.updatedMembers) {
      try {
        updateMemberWithLog(mid, {
          [MM_COL.EXPIRATION]:          payload.newExpiration || '',
          [MM_COL.TYPE]:                payload.membershipType || '',
          [MM_COL.STATUS]:              'active',
          [MM_COL.MEMBERSHIP_FEE_PAID]: payload.amount || '',
          [MM_COL.PAYMENT_DATE]:        new Date().toISOString(),
          [MM_COL.PAYMENT_TRANSACTION]: payload.transactionRef || '',
          [MM_COL.LAST_UPDATED]:        new Date().toISOString(),
        });
        results.push(`${mid}: updated`);
      } catch (err: any) {
        results.push(`${mid}: error — ${err.message}`);
      }
    }
  }

  // Sync event status
  if (payload.eventId) {
    try {
      const r = handleEventStatusUpdated({
        eventId: payload.eventId,
        status: 'approved',
        adminApprover: 'mmr-admin-webhook',
      });
      results.push(`event: synced`);
    } catch (err: any) {
      results.push(`event: error — ${err.message}`);
    }
  }

  // Create payment record
  try {
    const r = handlePaymentCreated({
      paymentId: generatePaymentID(),
      eventId: payload.eventId,
      memberId: payload.memberId,
      amount: payload.amount,
      paymentIntent: payload.paymentIntent,
      periodEnd: payload.newExpiration,
      source: 'mmr-admin',
    });
    results.push(`payment: created`);
  } catch (err: any) {
    results.push(`payment: error — ${err.message}`);
  }

  return jsonResponse({ ok: true, results });
}


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jsonResponse(data: any): GoogleAppsScript.Content.TextOutput {
  return ContentService
    .createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}
