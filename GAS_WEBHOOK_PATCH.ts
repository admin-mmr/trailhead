// ============================================================
// PATCH: Fix handleWriteRange to support key-based upsert
// File: web-apps/gas/membership/src/webhook.ts
//
// Problem: handleWriteRange always appends rows, creating duplicates
//          when syncing MySQL → Sheets (e.g., export/members)
//
// Solution: Add keyField parameter to support upsert (insert-or-update)
// ============================================================

/**
 * Map sheet names to their key column (first column, index 0)
 */
function getKeyColumnIndex(sheetName: string, keyField: string): number {
  // For all SQL export sheets, the key field is in column 0
  // SQL Members: MemberID is column 0
  // SQL Payments: PaymentID is column 0
  // SQL Submissions: SubmissionID is column 0
  // Active (Fetch-Gmail): MessageId is column 0
  return 0;
}

/**
 * FIXED: handleWriteRange — now supports key-based upsert
 *
 * Payload:
 *   {
 *     action: 'write_range',
 *     sheetName: 'SQL Members' | 'SQL Payments' | 'SQL Submissions',
 *     rows: [[col1, col2, ...], [col1, col2, ...], ...],
 *     overwrite: false,    // false = upsert (match by key), true = replace all
 *     keyField: 'MemberID' // For upsert mode, which field is the key
 *   }
 */
function handleWriteRange(payload: any): GoogleAppsScript.Content.TextOutput {
  console.log('[webhook] write_range: target sheet =', payload.sheetName);
  const { sheetName, rows, overwrite, keyField } = payload;

  if (!sheetName || !Array.isArray(rows)) {
    return jsonResponse({ ok: false, error: 'sheetName and rows array required' });
  }

  try {
    const sheet = getSheet(sheetName);

    if (overwrite) {
      // OVERWRITE MODE: Clear all existing data and append fresh
      console.log(`[webhook] write_range: overwrite=true, clearing existing data`);
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        sheet.deleteRows(2, lastRow - 1); // Keep header
      }

      let inserted = 0;
      for (const row of rows) {
        if (Array.isArray(row)) {
          sheet.appendRow(row);
          inserted++;
        }
      }

      console.log(`[webhook] write_range: overwrote ${inserted} rows to "${sheetName}"`);
      return jsonResponse({ ok: true, data: { inserted, updated: 0 } });
    }

    // UPSERT MODE (overwrite=false or not set)
    // Match rows by key field, update existing or append new
    if (!keyField) {
      // If no keyField provided, default to append-only behavior (backward compat)
      console.log(`[webhook] write_range: no keyField, defaulting to append-only`);
      let inserted = 0;
      for (const row of rows) {
        if (Array.isArray(row)) {
          sheet.appendRow(row);
          inserted++;
        }
      }
      console.log(`[webhook] write_range: appended ${inserted} rows to "${sheetName}"`);
      return jsonResponse({ ok: true, data: { inserted, updated: 0 } });
    }

    // UPSERT: Match by keyField
    console.log(`[webhook] write_range: upsert mode, keyField="${keyField}"`);
    const keyColIndex = getKeyColumnIndex(sheetName, keyField);
    const data = sheet.getDataRange().getValues();

    let inserted = 0;
    let updated = 0;

    for (const newRow of rows) {
      if (!Array.isArray(newRow) || newRow.length === 0) {
        console.warn('[webhook] Skipping invalid row');
        continue;
      }

      const keyValue = String(newRow[keyColIndex] || '').trim();
      if (!keyValue) {
        console.warn(`[webhook] Skipping row with empty key field "${keyField}"`);
        continue;
      }

      let found = false;

      // Search for existing row by key
      for (let i = 1; i < data.length; i++) {
        const existingKeyValue = String(data[i][keyColIndex] || '').trim();
        if (existingKeyValue === keyValue) {
          // FOUND: Update existing row in-place
          for (let j = 0; j < newRow.length; j++) {
            sheet.getRange(i + 1, j + 1).setValue(newRow[j]);
          }
          console.log(`[webhook] Updated existing row: ${keyField}="${keyValue}" at row ${i + 1}`);
          updated++;
          found = true;
          break;
        }
      }

      // NOT FOUND: Append as new row
      if (!found) {
        sheet.appendRow(newRow);
        console.log(`[webhook] Appended new row: ${keyField}="${keyValue}"`);
        inserted++;
      }
    }

    console.log(`[webhook] write_range: inserted=${inserted}, updated=${updated} in "${sheetName}"`);
    return jsonResponse({ ok: true, data: { inserted, updated } });
  } catch (err: any) {
    console.error('[webhook] write_range error:', err);
    return jsonResponse({ ok: false, error: err.message || String(err) });
  }
}

// ============================================================
// INTEGRATION: Update Python sync call
//
// In mmr-admin/api_sheets_sync.py, when calling write_range,
// always pass the keyField for the target sheet:
//
//   # For export/members
//   send_webhook('write_range', {
//       'sheetName': 'SQL Members',
//       'rows': member_rows,
//       'keyField': 'MemberID',     // ← ADD THIS
//       'overwrite': False
//   })
//
//   # For export/payments
//   send_webhook('write_range', {
//       'sheetName': 'SQL Payments',
//       'rows': payment_rows,
//       'keyField': 'PaymentID',    // ← ADD THIS
//       'overwrite': False
//   })
//
//   # For export/submission
//   send_webhook('write_range', {
//       'sheetName': 'SQL Submissions',
//       'rows': submission_rows,
//       'keyField': 'SubmissionID', // ← ADD THIS
//       'overwrite': False
//   })
// ============================================================
