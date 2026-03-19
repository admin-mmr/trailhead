/**
 * nyrr/src/sheets.ts
 * Read/write helpers for all three NYRR Sheets tabs and Membership-Master.
 */

/// <reference path="./types.ts" />
/// <reference path="./config.ts" />



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
function getAllNyrrEvents(): NyrrEvent[] {
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
function getPendingNyrrEvents(): NyrrEvent[] {
  return getAllNyrrEvents().filter((e) => e.processingStatus === 'Pending');
}

/**
 * Upserts a NyrrEvent row (keyed on nyrrEventId).
 * If a row with that ID already exists, updates it in place.
 * If not found, appends a new row.
 */
function upsertNyrrEvent(event: NyrrEvent): void {
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
function updateEventStatus(
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
// NYRR-Results sheet (year-organized)
// ---------------------------------------------------------------------------

/**
 * Gets or creates the NYRR-Results sheet for a specific year.
 * Creates sheets like "NYRR-Results-2025", "NYRR-Results-2026", etc.
 *
 * @param year - the year (e.g., 2025)
 */
function getResultsSheetForYear(year: number): GoogleAppsScript.Spreadsheet.Sheet {
  const ss = getNyrrSpreadsheet();
  const sheetName = `${NYRR_SHEET.RESULTS}-${year}`;

  // Try to get existing sheet
  let sheet = ss.getSheetByName(sheetName);

  // If it doesn't exist, create it
  if (!sheet) {
    logDebug(`[getResultsSheetForYear] Creating new sheet: ${sheetName}`);
    sheet = ss.insertSheet(sheetName);

    // Add header row (same as base NYRR-Results)
    const headers = [
      'Result ID',
      'Event ID',
      'Event Name',
      'Event Date',
      'Runner ID',          // runnerId from NYRR (populated)
      'Runner Name',
      'Age',
      'Gender',
      'State',
      'Finish Time',
      'Pace',
      'Bib Number',
      'Overall Place',
      'Gender Place',
      'Is MMR Club',
      'MMR Member ID',      // MMR system member ID (blank, Phase 2)
      'Is Registered Only',
      'Scan Timestamp',
    ];
    sheet.appendRow(headers);
    logDebug(`[getResultsSheetForYear] Sheet ${sheetName} created with headers`);
  } else {
    logDebug(`[getResultsSheetForYear] Using existing sheet: ${sheetName}`);
  }

  return sheet;
}

/**
 * Upserts a NyrrResult row keyed on (nyrrEventId, nyrrRunnerId).
 * Prevents duplicate rows on re-runs.
 * Automatically creates/uses year-specific sheet based on event date.
 */
function upsertNyrrResult(result: NyrrResult): void {
  try {
    // Extract year from eventDate (ISO format: YYYY-MM-DD)
    let year = parseInt(result.eventDate.split('-')[0], 10);

    // Fallback: if year is NaN, try to extract from event name or use current year
    if (isNaN(year)) {
      logDebug(`[upsertNyrrResult.noYear] ⚠ Could not parse year from eventDate "${result.eventDate}". Trying fallback...`);
      // Try to extract year from eventName (e.g., "2026 NYRR...")
      const yearMatch = result.eventName.match(/(\d{4})/);
      year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
      logDebug(`[upsertNyrrResult.yearFallback] Using year ${year} from eventName`);
    }

    const sheet = getResultsSheetForYear(year);
    const data = sheet.getDataRange().getValues() as unknown[][];

    const rowIndex = data.findIndex(
      (r, i) =>
        i > 0 &&
        String(r[RESULTS_COL.NYRR_EVENT_ID]) === result.nyrrEventId &&
        String(r[RESULTS_COL.RUNNER_ID]) === result.nyrrRunnerId
    );

    const rowData = [
      result.resultId || uid('NYRR-RES'),  // RESULT_ID
      result.nyrrEventId,                   // NYRR_EVENT_ID
      result.eventName,                     // EVENT_NAME
      result.eventDate,                     // EVENT_DATE
      result.nyrrRunnerId,                  // RUNNER_ID (populated with runnerId)
      result.runnerName,                    // RUNNER_NAME
      result.age ?? '',                     // AGE
      result.gender,                        // GENDER
      result.state,                         // STATE
      result.finishTime,                    // FINISH_TIME
      result.pace,                          // PACE
      result.bibNumber,                     // BIB_NUMBER
      result.overallPlace ?? '',            // OVERALL_PLACE
      result.genderPlace ?? '',             // GENDER_PLACE
      result.isMMRClub,                     // IS_MMR_CLUB
      result.mmrMemberId,                   // MMR_MEMBER_ID (blank, Phase 2)
      result.isRegisteredOnly,              // IS_REGISTERED_ONLY
      result.scanTimestamp || nowIso(),     // SCAN_TIMESTAMP
    ];

    if (rowIndex === -1) {
      sheet.appendRow(rowData);
      logDebug(`[upsertNyrrResult] INSERTED: ${result.eventName} | ${result.runnerName} (NYRR ID: ${result.nyrrRunnerId})`);
    } else {
      sheet.getRange(rowIndex + 1, 1, 1, rowData.length).setValues([rowData]);
      logDebug(`[upsertNyrrResult] UPDATED: ${result.eventName} | ${result.runnerName} (NYRR ID: ${result.nyrrRunnerId})`);
    }
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    logDebug(`[upsertNyrrResult] ERROR writing result for ${result.runnerName}: ${error}`);
    throw e;
  }
}

/**
 * Batch-upserts multiple results with smart deduplication.
 * Loads existing results once and only writes new/changed rows.
 */
function upsertNyrrResults(results: NyrrResult[]): void {
  logDebug(`[upsertNyrrResults.start] Processing ${results.length} results with deduplication`);

  // Group results by year for efficient sheet access
  const resultsByYear = new Map<number, NyrrResult[]>();
  for (const result of results) {
    let year = parseInt(result.eventDate.split('-')[0], 10);
    if (isNaN(year)) {
      const yearMatch = result.eventName.match(/(\d{4})/);
      year = yearMatch ? parseInt(yearMatch[1], 10) : new Date().getFullYear();
    }

    if (!resultsByYear.has(year)) {
      resultsByYear.set(year, []);
    }
    resultsByYear.get(year)!.push(result);
  }

  let totalInserted = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  // Process each year's results
  for (const [year, yearResults] of resultsByYear) {
    logDebug(`[upsertNyrrResults.year] Processing ${yearResults.length} results for year ${year}`);
    const sheet = getResultsSheetForYear(year);
    const existingData = sheet.getDataRange().getValues() as unknown[][];

    // Build map of existing results for fast lookup
    const existingMap = new Map<string, number>();
    for (let i = 1; i < existingData.length; i++) {
      const key = `${existingData[i][RESULTS_COL.NYRR_EVENT_ID]}|${existingData[i][RESULTS_COL.RUNNER_ID]}`;
      existingMap.set(key, i);
    }

    // Separate new and updated results
    const rowsToInsert: unknown[][] = [];
    for (const result of yearResults) {
      const key = `${result.nyrrEventId}|${result.nyrrRunnerId}`;
      const rowIndex = existingMap.get(key);

      const rowData = [
        result.resultId || uid('NYRR-RES'),  // RESULT_ID
        result.nyrrEventId,                   // NYRR_EVENT_ID
        result.eventName,                     // EVENT_NAME
        result.eventDate,                     // EVENT_DATE
        result.nyrrRunnerId,                  // RUNNER_ID (populated with runnerId)
        result.runnerName,                    // RUNNER_NAME
        result.age ?? '',                     // AGE
        result.gender,                        // GENDER
        result.state,                         // STATE
        result.finishTime,                    // FINISH_TIME
        result.pace,                          // PACE
        result.bibNumber,                     // BIB_NUMBER
        result.overallPlace ?? '',            // OVERALL_PLACE
        result.genderPlace ?? '',             // GENDER_PLACE
        result.isMMRClub,                     // IS_MMR_CLUB
        result.mmrMemberId,                   // MMR_MEMBER_ID (blank, Phase 2)
        result.isRegisteredOnly,              // IS_REGISTERED_ONLY
        result.scanTimestamp || nowIso(),     // SCAN_TIMESTAMP
      ];

      try {
        if (rowIndex === undefined) {
          // New row
          rowsToInsert.push(rowData);
          totalInserted++;
          logDebug(`[upsertNyrrResults.new] ${result.eventName} | ${result.runnerName}`);
        } else {
          // Update existing row
          sheet.getRange(rowIndex + 1, 1, 1, rowData.length).setValues([rowData]);
          totalUpdated++;
          logDebug(`[upsertNyrrResults.update] ${result.eventName} | ${result.runnerName}`);
        }
      } catch (e: unknown) {
        totalErrors++;
        const error = e instanceof Error ? e.message : String(e);
        logDebug(`[upsertNyrrResults.ERROR] ${result.runnerName}: ${error}`);
      }
    }

    // Bulk insert new rows at once
    if (rowsToInsert.length > 0) {
      try {
        logDebug(`[upsertNyrrResults.bulkInsert] Inserting ${rowsToInsert.length} new rows for year ${year}`);
        sheet.getRange(existingData.length + 1, 1, rowsToInsert.length, rowsToInsert[0].length).setValues(rowsToInsert);
      } catch (e: unknown) {
        totalErrors++;
        const error = e instanceof Error ? e.message : String(e);
        logDebug(`[upsertNyrrResults.bulkInsertError] Failed: ${error}`);
      }
    }

    // Handle skipped (duplicates)
    totalSkipped = results.length - totalInserted - totalUpdated - totalErrors;
  }

  logDebug(`[upsertNyrrResults.end] Complete: ${totalInserted} inserted, ${totalUpdated} updated, ${totalSkipped} skipped, ${totalErrors} errors`);
}

/**
 * Returns all NYRR-Results rows for a given MMR MemberID or NYRRMemberID.
 * Used by getMemberNYRRHistory() to power page_nyrr_history.html.
 * Searches across all year-specific NYRR-Results-{year} sheets.
 */
function getResultsForMember(
  mmrMemberId: string,
  nyrrMemberId?: string
): NyrrResult[] {
  const ss = getNyrrSpreadsheet();
  const allResults: NyrrResult[] = [];

  // Get all sheets that match "NYRR-Results-{year}" pattern
  const sheetNames = ss.getSheets().map((s) => s.getName());
  const resultSheets = sheetNames.filter((name) =>
    name.match(/^NYRR-Results-\d{4}$/)
  );

  // If no year-specific sheets exist, try the base sheet for backwards compatibility
  if (resultSheets.length === 0) {
    const baseSheet = ss.getSheetByName(NYRR_SHEET.RESULTS);
    if (baseSheet) {
      resultSheets.push(NYRR_SHEET.RESULTS);
    } else {
      return [];
    }
  }

  // Aggregate results from all year-specific sheets
  for (const sheetName of resultSheets) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

    const data = sheet.getDataRange().getValues() as unknown[][];
    if (data.length <= 1) continue;

    const sheetResults = data.slice(1)
      .filter((r) => {
        const matchesMmr =
          mmrMemberId && String(r[RESULTS_COL.MMR_MEMBER_ID]) === mmrMemberId;
        const matchesNyrr =
          nyrrMemberId && String(r[RESULTS_COL.RUNNER_ID]) === nyrrMemberId;
        return matchesMmr || matchesNyrr;
      })
      .map((r) => ({
        resultId: String(r[RESULTS_COL.RESULT_ID]),
        nyrrEventId: String(r[RESULTS_COL.NYRR_EVENT_ID]),
        eventName: String(r[RESULTS_COL.EVENT_NAME]),
        eventDate: String(r[RESULTS_COL.EVENT_DATE]),
        nyrrRunnerId: String(r[RESULTS_COL.RUNNER_ID]),
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

    allResults.push(...sheetResults);
  }

  return allResults;
}

// ---------------------------------------------------------------------------
// NYRR-ProcessingLog sheet
// ---------------------------------------------------------------------------

/** Appends a new row to the processing log. */
function appendProcessingLog(entry: Omit<NyrrProcessingLog, 'logId'>): void {
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
function verifyProcessingLog(
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
function getMembersWithNyrrId(): MmrMember[] {
  logDebug(`[getMembersWithNyrrId] Reading Membership-Master sheet...`);
  const sheet = getMembershipMasterSheet();
  const data = sheet.getDataRange().getValues() as unknown[][];
  if (data.length <= 1) {
    logDebug(`[getMembersWithNyrrId] Membership-Master sheet is empty or header-only`);
    return [];
  }

  const result = data.slice(1)
    .filter((r) => String(r[MEMBER_COL.NYRR_MEMBER_ID]).trim() !== '')
    .map((r) => ({
      memberId: String(r[MEMBER_COL.MEMBER_ID]),
      firstName: String(r[MEMBER_COL.FIRST_NAME]),
      lastName: String(r[MEMBER_COL.LAST_NAME]),
      nyrrMemberId: String(r[MEMBER_COL.NYRR_MEMBER_ID]).trim(),
      nyrrMemberName: String(r[MEMBER_COL.NYRR_MEMBER_NAME]).trim(),
    }));

  logDebug(`[getMembersWithNyrrId] Found ${result.length} members with NYRR IDs set`);
  return result;
}

/**
 * Writes the matched MMRMemberID back to a NYRR-Results row.
 * Called by matchNyrrResultsToMembers() after a match is found.
 */
/**
 * Sets the MMR Member ID on a NYRR-Results row.
 * Searches across all year-specific NYRR-Results-{year} sheets.
 *
 * @returns true if a match was found and updated, false otherwise
 */
function setMmrMemberIdOnResult(
  nyrrEventId: string,
  nyrrMemberId: string,
  mmrMemberId: string
): boolean {
  const ss = getNyrrSpreadsheet();

  // Get all sheets that match "NYRR-Results-{year}" pattern
  const sheetNames = ss.getSheets().map((s) => s.getName());
  const resultSheets = sheetNames.filter((name) =>
    name.match(/^NYRR-Results-\d{4}$/)
  );

  // Also check the base sheet for backwards compatibility
  if (ss.getSheetByName(NYRR_SHEET.RESULTS)) {
    resultSheets.push(NYRR_SHEET.RESULTS);
  }

  // Search across all sheets
  for (const sheetName of resultSheets) {
    const sheet = ss.getSheetByName(sheetName);
    if (!sheet) continue;

    const data = sheet.getDataRange().getValues() as unknown[][];
    const rowIndex = data.findIndex(
      (r, i) =>
        i > 0 &&
        String(r[RESULTS_COL.NYRR_EVENT_ID]) === nyrrEventId &&
        String(r[RESULTS_COL.RUNNER_ID]) === nyrrMemberId
    );

    if (rowIndex !== -1) {
      sheet
        .getRange(rowIndex + 1, RESULTS_COL.MMR_MEMBER_ID + 1)
        .setValue(mmrMemberId);
      logDebug(`[setMmrMemberIdOnResult] Matched NYRR ID ${nyrrMemberId} to MMR ID ${mmrMemberId} in sheet ${sheetName}`);
      return true;  // Found and updated
    }
  }

  return false; // Not found
}


