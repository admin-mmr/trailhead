/**
 * nyrr/src/sheets.ts
 * Read/write helpers for all three NYRR Sheets tabs and Membership-Master.
 */

import {
  NyrrEvent,
  NyrrResult,
  NyrrProcessingLog,
  MmrMember,
  NyrrProcessingStatus,
} from './types';
import {
  getNyrrSheet,
  getMembershipMasterSheet,
  NYRR_SHEET,
  EVENTS_COL,
  RESULTS_COL,
  LOG_COL,
  MEMBER_COL,
} from './config';

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  const ts = new Date().getTime();
  const rnd = Math.floor(Math.random() * 9999);
  return `${prefix}-${ts}-${rnd}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// NYRR-Events sheet
// ---------------------------------------------------------------------------

/** Returns all rows from NYRR-Events as NyrrEvent objects (skips header). */
export function getAllNyrrEvents(): NyrrEvent[] {
  const sheet = getNyrrSheet(NYRR_SHEET.EVENTS);
  const rows = sheet.getDataRange().getValues() as unknown[][];
  if (rows.length <= 1) return [];

  return rows.slice(1).map((r) => ({
    nyrrEventId: String(r[EVENTS_COL.NYRR_EVENT_ID]),
    eventCode: String(r[EVENTS_COL.EVENT_CODE]),
    eventName: String(r[EVENTS_COL.EVENT_NAME]),
    eventUrl: String(r[EVENTS_COL.EVENT_URL]),
    location: String(r[EVENTS_COL.LOCATION]),
    distance: String(r[EVENTS_COL.DISTANCE]),
    eventDate: String(r[EVENTS_COL.EVENT_DATE]),
    eventYear: Number(r[EVENTS_COL.EVENT_YEAR]),
    isUpcoming: r[EVENTS_COL.IS_UPCOMING] === true || r[EVENTS_COL.IS_UPCOMING] === 'TRUE',
    processingStatus: String(r[EVENTS_COL.PROCESSING_STATUS]) as NyrrProcessingStatus,
    processedTimestamp: String(r[EVENTS_COL.PROCESSED_TIMESTAMP]),
    processedBy: String(r[EVENTS_COL.PROCESSED_BY]),
    resultCount: Number(r[EVENTS_COL.RESULT_COUNT]),
    notes: String(r[EVENTS_COL.NOTES]),
  }));
}

/** Returns events whose ProcessingStatus is Pending. */
export function getPendingNyrrEvents(): NyrrEvent[] {
  return getAllNyrrEvents().filter((e) => e.processingStatus === 'Pending');
}

/**
 * Upserts a NyrrEvent row (keyed on nyrrEventId).
 * If a row with that ID already exists, updates it in place.
 * If not found, appends a new row.
 */
export function upsertNyrrEvent(event: NyrrEvent): void {
  const sheet = getNyrrSheet(NYRR_SHEET.EVENTS);
  const data = sheet.getDataRange().getValues() as unknown[][];

  const rowIndex = data.findIndex(
    (r, i) => i > 0 && String(r[EVENTS_COL.NYRR_EVENT_ID]) === event.nyrrEventId
  );

  const rowData = [
    event.nyrrEventId,
    event.eventCode,
    event.eventName,
    event.eventUrl,
    event.location,
    event.distance,
    event.eventDate,
    event.eventYear,
    event.isUpcoming,
    event.processingStatus,
    event.processedTimestamp,
    event.processedBy,
    event.resultCount,
    event.notes,
  ];

  if (rowIndex === -1) {
    sheet.appendRow(rowData);
  } else {
    sheet.getRange(rowIndex + 1, 1, 1, rowData.length).setValues([rowData]);
  }
}

/** Updates only the processing status fields of an event row. */
export function updateEventStatus(
  nyrrEventId: string,
  status: NyrrProcessingStatus,
  resultCount: number,
  processedBy: string,
  notes: string
): void {
  const sheet = getNyrrSheet(NYRR_SHEET.EVENTS);
  const data = sheet.getDataRange().getValues() as unknown[][];

  const rowIndex = data.findIndex(
    (r, i) => i > 0 && String(r[EVENTS_COL.NYRR_EVENT_ID]) === nyrrEventId
  );
  if (rowIndex === -1) return;

  const sheetRow = rowIndex + 1; // 1-based
  sheet.getRange(sheetRow, EVENTS_COL.PROCESSING_STATUS + 1).setValue(status);
  sheet.getRange(sheetRow, EVENTS_COL.PROCESSED_TIMESTAMP + 1).setValue(nowIso());
  sheet.getRange(sheetRow, EVENTS_COL.PROCESSED_BY + 1).setValue(processedBy);
  sheet.getRange(sheetRow, EVENTS_COL.RESULT_COUNT + 1).setValue(resultCount);
  sheet.getRange(sheetRow, EVENTS_COL.NOTES + 1).setValue(notes);
}

// ---------------------------------------------------------------------------
// NYRR-Results sheet
// ---------------------------------------------------------------------------

/**
 * Upserts a NyrrResult row keyed on (nyrrEventId, nyrrMemberId).
 * Prevents duplicate rows on re-runs.
 */
export function upsertNyrrResult(result: NyrrResult): void {
  const sheet = getNyrrSheet(NYRR_SHEET.RESULTS);
  const data = sheet.getDataRange().getValues() as unknown[][];

  const rowIndex = data.findIndex(
    (r, i) =>
      i > 0 &&
      String(r[RESULTS_COL.NYRR_EVENT_ID]) === result.nyrrEventId &&
      String(r[RESULTS_COL.NYRR_MEMBER_ID]) === result.nyrrMemberId
  );

  const rowData = [
    result.resultId || uid('NYRR-RES'),
    result.nyrrEventId,
    result.eventName,
    result.eventDate,
    result.nyrrMemberId,
    result.runnerName,
    result.age ?? '',
    result.gender,
    result.state,
    result.finishTime,
    result.pace,
    result.bibNumber,
    result.overallPlace ?? '',
    result.genderPlace ?? '',
    result.isMMRClub,
    result.mmrMemberId,
    result.isRegisteredOnly,
    result.scanTimestamp || nowIso(),
  ];

  if (rowIndex === -1) {
    sheet.appendRow(rowData);
  } else {
    sheet.getRange(rowIndex + 1, 1, 1, rowData.length).setValues([rowData]);
  }
}

/** Batch-upserts multiple results. Flushes to sheet in one write per row. */
export function upsertNyrrResults(results: NyrrResult[]): void {
  for (const result of results) {
    upsertNyrrResult(result);
  }
}

/**
 * Returns all NYRR-Results rows for a given MMR MemberID or NYRRMemberID.
 * Used by getMemberNYRRHistory() to power page_nyrr_history.html.
 */
export function getResultsForMember(
  mmrMemberId: string,
  nyrrMemberId?: string
): NyrrResult[] {
  const sheet = getNyrrSheet(NYRR_SHEET.RESULTS);
  const data = sheet.getDataRange().getValues() as unknown[][];
  if (data.length <= 1) return [];

  return data.slice(1)
    .filter((r) => {
      const matchesMmr =
        mmrMemberId && String(r[RESULTS_COL.MMR_MEMBER_ID]) === mmrMemberId;
      const matchesNyrr =
        nyrrMemberId && String(r[RESULTS_COL.NYRR_MEMBER_ID]) === nyrrMemberId;
      return matchesMmr || matchesNyrr;
    })
    .map((r) => ({
      resultId: String(r[RESULTS_COL.RESULT_ID]),
      nyrrEventId: String(r[RESULTS_COL.NYRR_EVENT_ID]),
      eventName: String(r[RESULTS_COL.EVENT_NAME]),
      eventDate: String(r[RESULTS_COL.EVENT_DATE]),
      nyrrMemberId: String(r[RESULTS_COL.NYRR_MEMBER_ID]),
      runnerName: String(r[RESULTS_COL.RUNNER_NAME]),
      age: r[RESULTS_COL.AGE] !== '' ? Number(r[RESULTS_COL.AGE]) : null,
      gender: String(r[RESULTS_COL.GENDER]),
      state: String(r[RESULTS_COL.STATE]),
      finishTime: String(r[RESULTS_COL.FINISH_TIME]),
      pace: String(r[RESULTS_COL.PACE]),
      bibNumber: String(r[RESULTS_COL.BIB_NUMBER]),
      overallPlace: r[RESULTS_COL.OVERALL_PLACE] !== '' ? Number(r[RESULTS_COL.OVERALL_PLACE]) : null,
      genderPlace: r[RESULTS_COL.GENDER_PLACE] !== '' ? Number(r[RESULTS_COL.GENDER_PLACE]) : null,
      isMMRClub: r[RESULTS_COL.IS_MMR_CLUB] === true || r[RESULTS_COL.IS_MMR_CLUB] === 'TRUE',
      mmrMemberId: String(r[RESULTS_COL.MMR_MEMBER_ID]),
      isRegisteredOnly: r[RESULTS_COL.IS_REGISTERED_ONLY] === true || r[RESULTS_COL.IS_REGISTERED_ONLY] === 'TRUE',
      scanTimestamp: String(r[RESULTS_COL.SCAN_TIMESTAMP]),
    }));
}

// ---------------------------------------------------------------------------
// NYRR-ProcessingLog sheet
// ---------------------------------------------------------------------------

/** Appends a new row to the processing log. */
export function appendProcessingLog(entry: Omit<NyrrProcessingLog, 'logId'>): void {
  const sheet = getNyrrSheet(NYRR_SHEET.PROCESSING_LOG);
  sheet.appendRow([
    uid('NYRR-LOG'),
    entry.runTimestamp,
    entry.triggeredBy,
    entry.nyrrEventId,
    entry.eventName,
    entry.runStatus,
    entry.rowsWritten,
    entry.errorDetails,
    entry.verifiedBy,
    entry.verifiedTimestamp,
    entry.notes,
  ]);
}

/** Marks a processing log row as verified by an admin. */
export function verifyProcessingLog(
  logId: string,
  adminEmail: string
): void {
  const sheet = getNyrrSheet(NYRR_SHEET.PROCESSING_LOG);
  const data = sheet.getDataRange().getValues() as unknown[][];
  const rowIndex = data.findIndex(
    (r, i) => i > 0 && String(r[LOG_COL.LOG_ID]) === logId
  );
  if (rowIndex === -1) return;

  const sheetRow = rowIndex + 1;
  sheet.getRange(sheetRow, LOG_COL.VERIFIED_BY + 1).setValue(adminEmail);
  sheet.getRange(sheetRow, LOG_COL.VERIFIED_TIMESTAMP + 1).setValue(nowIso());
}

// ---------------------------------------------------------------------------
// Membership-Master (read-only for NYRR pipeline)
// ---------------------------------------------------------------------------

/**
 * Returns all MMR members who have a NYRRMemberID set.
 * Used for the supplementary member-ID-based scan pass.
 */
export function getMembersWithNyrrId(): MmrMember[] {
  const sheet = getMembershipMasterSheet();
  const data = sheet.getDataRange().getValues() as unknown[][];
  if (data.length <= 1) return [];

  return data.slice(1)
    .filter((r) => String(r[MEMBER_COL.NYRR_MEMBER_ID]).trim() !== '')
    .map((r) => ({
      memberId: String(r[MEMBER_COL.MEMBER_ID]),
      firstName: String(r[MEMBER_COL.FIRST_NAME]),
      lastName: String(r[MEMBER_COL.LAST_NAME]),
      nyrrMemberId: String(r[MEMBER_COL.NYRR_MEMBER_ID]).trim(),
      nyrrMemberName: String(r[MEMBER_COL.NYRR_MEMBER_NAME]).trim(),
    }));
}

/**
 * Writes the matched MMRMemberID back to a NYRR-Results row.
 * Called by matchNyrrResultsToMembers() after a match is found.
 */
export function setMmrMemberIdOnResult(
  nyrrEventId: string,
  nyrrMemberId: string,
  mmrMemberId: string
): void {
  const sheet = getNyrrSheet(NYRR_SHEET.RESULTS);
  const data = sheet.getDataRange().getValues() as unknown[][];
  const rowIndex = data.findIndex(
    (r, i) =>
      i > 0 &&
      String(r[RESULTS_COL.NYRR_EVENT_ID]) === nyrrEventId &&
      String(r[RESULTS_COL.NYRR_MEMBER_ID]) === nyrrMemberId
  );
  if (rowIndex === -1) return;

  sheet
    .getRange(rowIndex + 1, RESULTS_COL.MMR_MEMBER_ID + 1)
    .setValue(mmrMemberId);
}
