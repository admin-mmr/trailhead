const spreadSheetId='1rVOvhXzSxCRpWdAw3jYq5tWrYdCYtXmfqblTHP_wPqA';
let startIndex = 0;
const MAXTHREADS = 200;
const maxProcessedCount = 100;
const DATE_CUTOFF = new Date("2024-11-01")

function checkAllPayments() {
  const processedIds = processedEmails();
  var processedAlready = 0;

  do {
    console.log(startIndex);
    threads = GmailApp.getInboxThreads(startIndex, MAXTHREADS);

    for(let i=0; i < threads.length; i++) {
      const messages = threads[i].getMessages();
      if (messages[messages.length-1].getDate()<DATE_CUTOFF) {
          console.log("scan completed");
          console.log(i+startIndex);
          doSort();
          return true;
      }
      for (let j=messages.length-1; j >-1; j--) {
        message = messages[j];
        var messageId = message.getId();
        if (!isNaN(messageId)) {
          messageId = "_" + messageId;
        }
        const date = Utilities.formatDate(message.getDate(), "GMT", "yyyy-MM-dd");
        if(date<DATE_CUTOFF) {
          continue;
        }
        if (i==0 && j==0) {
          console.log(date);
        }
        if (processedAlready > maxProcessedCount) {
          console.log("already caught up to the last run");
          console.log(i+startIndex);
          console.log(date);
          doSort();
          return true;
        }
        if (message.isInInbox()){
          const subjectText = message.getSubject();
          const msgFrom = message.getFrom();
          const text = message.getPlainBody();

          if (subjectText.includes("You received money with Zelle") ||
          (date<"2024-07-25" && text.includes("You received a payment") && text.includes("Zelle"))) {
            if (processedIds.includes(messageId)) {
              processedAlready += 1;
            } else {
              extractZelleDetails(message, messageId);
              processedAlready = 0;
            }
          }
          const match1 = text.match(/Payment ID/)
          const match2 = text.match(/Transaction ID/)
          if (msgFrom.includes("venmo.com") && (match1 || match2) ) {
            // console.log(text);
            if (processedIds.includes(messageId)) {
              processedAlready += 1;
            } else {
              extractVenmoDetails(message, messageId);
              processedAlready = 0;
            }
          }

          if (subjectText.includes("You've got money") &&
          (msgFrom.toLowerCase().includes("paypal") || text.toLowerCase().includes("from: service@paypal.com <service@paypal.com>"))) {
            if (processedIds.includes(messageId)) {
              processedAlready += 1;
            } else {
              extractPayPalDetails(message, messageId);
              processedAlready = 0;
            }
          }
        }
      }
    }
    //Increment startIndex by 500 after having processed 500 threads
    startIndex += MAXTHREADS;
  } while (threads.length == MAXTHREADS);
  doSort();
  return true;
}

/**
 * Normalize a Chase/Zelle plain-text body so field regexes are layout-proof.
 * Chase's July 2026 template wraps every detail value in <b>, which
 * getPlainBody() renders as *asterisks*, and the table cells arrive
 * tab- or newline-separated depending on the message. This strips the
 * markdown-ish emphasis, non-breaking spaces and CR, and collapses runs
 * of spaces/tabs so labels and values are always separated by plain \s.
 */
function normalizeZelleBody(text) {
  return String(text)
    .replace(/\r\n?/g, "\n")
    .replace(/ /g, " ")
    .replace(/\*/g, "")
    .replace(/[ \t]+/g, " ");
}

/**
 * Parse the "Here are the details:" block of a modern (post-2024-07-25)
 * Chase Zelle receipt. Returns {sender, amount, transDate, transactionNumber, memo}.
 */
function parseZelleModern(rawText) {
  const text = normalizeZelleBody(rawText);

  // Everything before "<sender> is registered with a Zelle" is the details block.
  const tailIndex = text.search(/is registered with a Zelle/);
  const details = tailIndex > -1 ? text.slice(0, tailIndex) : text;

  const senderMatch = details.match(/([^\n]+?) sent you money/);
  const amountMatch = details.match(/Amount\s*\$\s*([\d,]+\.\d{2})/);
  const dateMatch = details.match(/Sent on\s*([A-Za-z]{3,}\s+\d{1,2},\s+\d{4})/);
  const transactionMatch = details.match(/Transaction number\s*#?\s*(\d+)/);

  // Memo is the last labelled field, so take everything after it. Guard against
  // an empty memo swallowing the sender sentence by cutting at a blank line.
  var memo = null;
  const memoMatch = details.match(/Memo\s*([\s\S]*)$/);
  if (memoMatch) {
    memo = memoMatch[1].split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
    if (!memo) {
      memo = null;
    }
  }

  return {
    sender: senderMatch ? senderMatch[1].trim() : null,
    amount: amountMatch ? amountMatch[1].replace(/,/g, "") : null,
    transDate: dateMatch ? dateMatch[1] : null,
    transactionNumber: transactionMatch ? transactionMatch[1] : null,
    memo: memo
  };
}

/** Parse the legacy (pre-2024-07-25) "Chase QuickPay" style receipt. */
function parseZelleLegacy(text) {
  const senderMatch = text.match(/(.*?) sent you money through Chase Quick/);
  const amountMatch = text.match(/\*Amount:\* \$([\d,]+\.\d{2})/);
  const memoMatch = text.match(/\*Memo:\* ([\s\S]*?)(?:\n|$)/);

  return {
    sender: senderMatch ? senderMatch[1].trim() : null,
    amount: amountMatch ? amountMatch[1].replace(/,/g, "") : null,
    transDate: null,
    transactionNumber: null,
    memo: memoMatch ? memoMatch[1].trim() : null
  };
}

function extractZelleDetails(message, mailId){
  const sheetName = 'Active'
  const ss = SpreadsheetApp.openById(spreadSheetId);
  const timezone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const sheet = ss.getSheetByName(sheetName);

  const dateTime = Utilities.formatDate(message.getDate(), timezone, "yyyy-MM-dd HH:mm:ss");
  const text = message.getPlainBody();

  const isLegacy = Utilities.formatDate(message.getDate(), timezone, "yyyy-MM-dd") < "2024-07-25";
  const d = isLegacy ? parseZelleLegacy(text) : parseZelleModern(text);

  if (!d.amount || !d.sender) {
    console.log("Zelle parse incomplete for " + mailId + ": " + JSON.stringify(d));
  }

  sheet.appendRow([dateTime, d.sender, d.amount, d.memo, d.transDate, d.transactionNumber, mailId, "", d.memo, "", "", "Zelle"]);
}

function extractVenmoDetails(message, mailId){
  const sheetName = 'Active'
  const ss = SpreadsheetApp.openById(spreadSheetId);
  const timezone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const sheet = ss.getSheetByName(sheetName);
  const msgSubject = message.getSubject();

  const dateTime = Utilities.formatDate(message.getDate(), timezone, "yyyy-MM-dd HH:mm:ss");
  const text = message.getPlainBody();

  var senderMatch = false;
  var amountMatch = false;
  var memoMatch = false;
  var transactionMatch = false;
  var dateMatch = false;

  senderMatch = msgSubject.match(/(.*?) paid /);
  amountMatch = msgSubject.match(/paid.*?\$(\d+\.\d{2})/);

  if (Utilities.formatDate(message.getDate(), timezone, "yyyy-MM-dd")<"2024-08-08") {
    memoMatch = text.match(/\>\s+([^\>]*?)Transfer Date and/s);
    dateMatch = text.match(/Transfer Date and Amount:\s+([a-zA-Z]+\s\d{2},\s\d{4})\s/);
    transactionMatch = text.match(/Payment ID:\s+(\d+)/);
  } else {
    memoMatch = text.match(/\.\s+\d{2}\s*([\s\S]*?)\s+See transaction/s);
    dateMatch = text.match(/Transaction detailsDate\n\s+([a-zA-Z]+\s\d{2},\s\d{4})\n/);
    transactionMatch = text.match(/Transaction ID\s+([A-Z0-9]+)/);
  }

  const sender = senderMatch ? senderMatch[1] : null;
  const amount = amountMatch ? amountMatch[1] : null;
  const transDate = dateMatch ? dateMatch[1] : null;
  const transactionNumber = transactionMatch ? transactionMatch[1] : null;
  const memo = memoMatch ? memoMatch[1].trim() : null;

  sheet.appendRow([dateTime, sender, amount, memo, transDate, transactionNumber, mailId, msgSubject, memo, "", "", "Venmo"]);
}

function extractPayPalDetails(message, mailId){
  const sheetName = 'Active'
  const ss = SpreadsheetApp.openById(spreadSheetId);
  const timezone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  const sheet = ss.getSheetByName(sheetName);

  const dateTime = Utilities.formatDate(message.getDate(), timezone, "yyyy-MM-dd HH:mm:ss");
  const text = message.getPlainBody();
  // const senderMatch = text.match(/\nNote from (.*?):/);
  const senderMatch = text.match(/\n(.*?) sent you \$/);
  const memoMatch = text.match(/image: quote\]\s*(.*?)\s*\[image/);
  const transactionIDMatch = text.match(/\*Transaction ID\*\n(.*)\n/);
  const dateMatch = text.match(/\*Transaction\s+date\*\s*\n([A-Za-z]+\s+\d{1,2},\s+\d{4})/);
  const amountMatch = text.match(/sent you \$(\d+\.\d{2})/);

  const amount = amountMatch ? amountMatch[1] : null;
  const transDate = dateMatch ? dateMatch[1] : null;
  const sender = senderMatch ? senderMatch[1] : null;
  const memo = memoMatch ? memoMatch[1] : null;
  const transactionNumber = transactionIDMatch ? transactionIDMatch[1] : null;

  sheet.appendRow([dateTime, sender, amount, memo, transDate, transactionNumber, mailId, "", memo, "", "", "PayPal"]);
}

function onOpen(e) {
  SpreadsheetApp.getUi()
  .createMenu('Click to Fetch Emails')
  .addItem('Get Email', 'checkAllPayments')
  .addToUi();
}

function checkMessage() {
  const message = GmailApp.getMessageById("19d41db972bcbad3");
  const msgSubject = message.getSubject();
  console.log(`subject: [${msgSubject}]`);
  const text = message.getPlainBody();
  console.log(`text: ${text}`);
  console.log(JSON.stringify(parseZelleModern(text), null, 2));
}

function processedEmails() {
  const sheetName = 'Active';
  const colName = 'MessageId';
  const ss = SpreadsheetApp.openById(spreadSheetId);
  const sheet = ss.getSheetByName(sheetName);
  const res = getColumnValues(sheet, colName);
  return res;
}

function getColumnValues(sheet, columnName) {
  // Get the data range of the sheet
  var dataRange = sheet.getDataRange();
  var values = dataRange.getValues();

  // Find the index of the column with the given name
  var columnIndex = values[0].indexOf(columnName);
  if (columnIndex === -1) {
    throw new Error('Column not found: ' + columnName);
  }

  // Extract the column values
  var columnValues = [];
  for (var i = 1; i < values.length; i++) {
    columnValues.push(values[i][columnIndex]);
  }

  return columnValues;
}

function sortSheet(sheet) {
  const columnIndex = 1;
  var range = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()); // Exclude the header row

  // Sort the range by the specified column index
  range.sort({ column: columnIndex, ascending: false });
}

function doSort() {
  const sheetName = 'Active';
  const ss = SpreadsheetApp.openById(spreadSheetId);
  const sheet = ss.getSheetByName(sheetName);
  sortSheet(sheet);
}

function RemainingDailyQuotaMailApp() {
  const emailQuotaRemaining = MailApp.getRemainingDailyQuota();
  Logger.log("Remaining email quota: " + emailQuotaRemaining);
}

/* istanbul ignore else */
if (typeof module !== 'undefined') {
  module.exports = { normalizeZelleBody, parseZelleModern, parseZelleLegacy };
}
