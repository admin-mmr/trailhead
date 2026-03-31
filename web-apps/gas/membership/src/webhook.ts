// ============================================================
// Webhook endpoint for mmr-admin → Google Sheets sync
//
// Receives POST requests from Python api_sheets_sync.py and
// writes updates to Sheets. Four actions supported:
//
//   member_updated        — sync any member field changes
//   event_status_updated  — update webapp_event status
//   payment_created       — append to Payment-History
//   get_transactions      — fetch all transactions from Fetch-Gmail sheet
//
// Deploy: Apps Script → Deploy → Manage deployments →
//   Edit existing → New version → Deploy.
//   URL goes in MySQL config table (SheetsWebhookUrl).
//
// Depends on: config.ts, sheets.ts, types.ts
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
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    switch (action) {
      case 'member_updated':
        return handleMemberUpdated(payload);
      case 'event_status_updated':
        return handleEventStatusUpdated(payload);
      case 'payment_created':
        return handlePaymentCreated(payload);
      case 'get_transactions':
        return handleGetTransactions(payload);
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
