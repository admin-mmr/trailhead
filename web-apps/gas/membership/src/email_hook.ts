// ============================================================
// Email Hook — receives email send requests from mmr-admin
// Sends via Gmail + logs to Email Log sheet
//
// Action: email_send
// Payload:
//   {
//     action: "email_send",
//     to: "user@example.com",
//     subject: "Your subject",
//     html_content: "HTML body",
//     text_content?: "plain text fallback (optional)",
//     cc?: "admin@mmrunners.org (optional)",
//     email_type?: "payment_approved|membership_activated|..." (optional),
//     member_id?: "MMR123 (optional)",
//     metadata?: {...} (optional, stored in log)
//   }
//
// Response: { ok: true, email_id: "EM-...", logged: true }
// ============================================================

interface EmailSendPayload {
  action: string;
  to: string;
  subject: string;
  html_content: string;
  text_content?: string;
  cc?: string;
  email_type?: string;
  member_id?: string;
  metadata?: Record<string, any>;
}

interface EmailLogEntry {
  EmailID: string;
  Timestamp: string;
  RecipientEmail: string;
  CCEmail?: string;
  Subject: string;
  EmailType?: string;
  MemberID?: string;
  Status: 'sent' | 'failed';
  ErrorMessage?: string;
  HTMLLength: number;
  DeliveredAt?: string;
  Notes?: string;
}

/**
 * Handle email_send action — send email via Gmail + log to Email Log sheet
 */
function handleEmailSend(payload: EmailSendPayload): GoogleAppsScript.Content.TextOutput {
  const emailId = generateEmailID();
  const now = new Date().toISOString();

  try {
    console.log(`[email_hook] Processing email_send: ${emailId} to ${payload.to}`);

    // Validate required fields
    if (!payload.to || !payload.subject || !payload.html_content) {
      throw new Error('Missing required fields: to, subject, html_content');
    }

    // Convert HTML to plain text if not provided
    const textContent =
      payload.text_content || stripHtmlTags(payload.html_content);

    // Build recipients
    const recipients = [payload.to];
    const options: GoogleAppsScript.Mail.MailAdvancedParameters = {
      htmlBody: payload.html_content,
      noReply: false,
      inlineImages: {},
      attachments: [],
    };

    if (payload.cc) {
      options.cc = payload.cc;
    }

    // Send via Gmail
    GmailApp.sendEmail(
      recipients.join(','),
      payload.subject,
      textContent,
      options
    );

    console.log(
      `[email_hook] Email sent: ${emailId} to ${payload.to}, subject: ${payload.subject.substring(0, 50)}`
    );

    // Log to Email Log sheet
    const logEntry: EmailLogEntry = {
      EmailID: emailId,
      Timestamp: now,
      RecipientEmail: payload.to,
      CCEmail: payload.cc || '',
      Subject: payload.subject,
      EmailType: payload.email_type || '',
      MemberID: payload.member_id || '',
      Status: 'sent',
      HTMLLength: payload.html_content.length,
      DeliveredAt: now,
      Notes: JSON.stringify(payload.metadata || {}),
    };

    logEmailToSheet(logEntry);

    return jsonResponse({
      ok: true,
      email_id: emailId,
      logged: true,
      status: 'sent',
      recipient: payload.to,
    });
  } catch (err: any) {
    console.error(`[email_hook] Failed to send email ${emailId}:`, err);

    // Log failure
    const logEntry: EmailLogEntry = {
      EmailID: emailId,
      Timestamp: now,
      RecipientEmail: payload.to,
      CCEmail: payload.cc || '',
      Subject: payload.subject,
      EmailType: payload.email_type || '',
      MemberID: payload.member_id || '',
      Status: 'failed',
      HTMLLength: payload.html_content.length,
      ErrorMessage: err.message || String(err),
      Notes: JSON.stringify(payload.metadata || {}),
    };

    logEmailToSheet(logEntry);

    return jsonResponse({
      ok: false,
      email_id: emailId,
      error: err.message || String(err),
      logged: true,
    });
  }
}

/**
 * Log email to the Email Log sheet
 */
function logEmailToSheet(entry: EmailLogEntry): void {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.EMAIL_LOG_SHEET_ID);
    const sheet = spreadsheet.getSheetByName(CONFIG.EMAIL_LOG_SHEET_NAME);

    if (!sheet) {
      console.error(
        `[email_hook] Sheet not found: ${CONFIG.EMAIL_LOG_SHEET_NAME}`
      );
      return;
    }

    // Append row: EmailID, Timestamp, RecipientEmail, CCEmail, Subject, EmailType, MemberID, Status, ErrorMessage, HTMLLength, DeliveredAt, Notes
    const row = [
      entry.EmailID,
      entry.Timestamp,
      entry.RecipientEmail,
      entry.CCEmail || '',
      entry.Subject,
      entry.EmailType || '',
      entry.MemberID || '',
      entry.Status,
      entry.ErrorMessage || '',
      entry.HTMLLength,
      entry.DeliveredAt || '',
      entry.Notes || '',
    ];

    sheet.appendRow(row);
    console.log(`[email_hook] Logged email ${entry.EmailID} to sheet`);
  } catch (err: any) {
    console.error(
      `[email_hook] Failed to log email to sheet:`,
      err
    );
  }
}

/**
 * Initialize Email Log sheet with headers if empty
 */
function initializeEmailLogSheet(): void {
  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.EMAIL_LOG_SHEET_ID);
    let sheet = spreadsheet.getSheetByName(CONFIG.EMAIL_LOG_SHEET_NAME);

    if (!sheet) {
      console.log(
        `[email_hook] Creating sheet: ${CONFIG.EMAIL_LOG_SHEET_NAME}`
      );
      sheet = spreadsheet.insertSheet(CONFIG.EMAIL_LOG_SHEET_NAME);
    }

    // Check if headers exist
    const data = sheet.getRange(1, 1, 1, 12).getValues();
    if (!data[0] || !data[0][0]) {
      // Empty — add headers
      const headers = [
        'EmailID',
        'Timestamp',
        'RecipientEmail',
        'CCEmail',
        'Subject',
        'EmailType',
        'MemberID',
        'Status',
        'ErrorMessage',
        'HTMLLength',
        'DeliveredAt',
        'Notes',
      ];
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      console.log('[email_hook] Initialized Email Log sheet with headers');
    }
  } catch (err: any) {
    console.error('[email_hook] Failed to initialize Email Log sheet:', err);
  }
}

/**
 * Generate unique email ID
 */
function generateEmailID(): string {
  return `EM-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
}

/**
 * Strip HTML tags from HTML string for plain text fallback
 * GAS version — uses regex instead of DOM
 */
function stripHtmlTags(html: string): string {
  if (!html) return '';

  // Remove script and style tags
  let text = html.replace(
    /<script[^>]*>[\s\S]*?<\/script>/gi,
    ''
  );
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');

  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // Decode common HTML entities
  text = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');

  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();

  return text;
}
