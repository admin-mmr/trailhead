/**
 * nyrr/src/config.ts
 * Reads NYRR pipeline config from the membership Sheets Config tab.
 * Script property MEMBERSHIP_SHEET_ID must be set in GAS project settings.
 */

import { NyrrConfig } from './types';

// Sheet / column names
const CONFIG_SHEET_NAME = 'Config';
const MEMBERSHIP_MASTER_SHEET = 'Membership-Master-Main-3';

// NYRR Sheets tab names (in the separate MMR-NYRR-Data spreadsheet)
export const NYRR_SHEET = {
  EVENTS: 'NYRR-Events',
  RESULTS: 'NYRR-Results',
  PROCESSING_LOG: 'NYRR-ProcessingLog',
} as const;

// Column indices for NYRR-Events (0-based)
export const EVENTS_COL = {
  NYRR_EVENT_ID: 0,
  EVENT_CODE: 1,
  EVENT_NAME: 2,
  EVENT_URL: 3,
  LOCATION: 4,
  DISTANCE: 5,
  EVENT_DATE: 6,
  EVENT_YEAR: 7,
  IS_UPCOMING: 8,
  PROCESSING_STATUS: 9,
  PROCESSED_TIMESTAMP: 10,
  PROCESSED_BY: 11,
  RESULT_COUNT: 12,
  NOTES: 13,
} as const;

// Column indices for NYRR-Results (0-based)
export const RESULTS_COL = {
  RESULT_ID: 0,
  NYRR_EVENT_ID: 1,
  EVENT_NAME: 2,
  EVENT_DATE: 3,
  NYRR_MEMBER_ID: 4,
  RUNNER_NAME: 5,
  AGE: 6,
  GENDER: 7,
  STATE: 8,
  FINISH_TIME: 9,
  PACE: 10,
  BIB_NUMBER: 11,
  OVERALL_PLACE: 12,
  GENDER_PLACE: 13,
  IS_MMR_CLUB: 14,
  MMR_MEMBER_ID: 15,
  IS_REGISTERED_ONLY: 16,
  SCAN_TIMESTAMP: 17,
} as const;

// Column indices for NYRR-ProcessingLog (0-based)
export const LOG_COL = {
  LOG_ID: 0,
  RUN_TIMESTAMP: 1,
  TRIGGERED_BY: 2,
  NYRR_EVENT_ID: 3,
  EVENT_NAME: 4,
  RUN_STATUS: 5,
  ROWS_WRITTEN: 6,
  ERROR_DETAILS: 7,
  VERIFIED_BY: 8,
  VERIFIED_TIMESTAMP: 9,
  NOTES: 10,
} as const;

// Membership-Master column indices for NYRR-relevant fields (0-based)
// Adjust these offsets when NYRRMemberID/NYRRMemberName are appended.
export const MEMBER_COL = {
  MEMBER_ID: 0,
  FIRST_NAME: 4,
  LAST_NAME: 5,
  NYRR_MEMBER_ID: 23,   // append position — adjust after columns are added
  NYRR_MEMBER_NAME: 24, // adjust after columns are added
} as const;

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

let _configCache: NyrrConfig | null = null;

/**
 * Reads NYRR pipeline config from the membership Sheets Config tab.
 * Uses a script property MEMBERSHIP_SHEET_ID set in GAS project settings.
 */
export function getNyrrConfig(): NyrrConfig {
  if (_configCache) return _configCache;

  const membershipSheetId =
    PropertiesService.getScriptProperties().getProperty('MEMBERSHIP_SHEET_ID') ?? '';

  const ss = SpreadsheetApp.openById(membershipSheetId);
  const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!configSheet) throw new Error(`Config sheet "${CONFIG_SHEET_NAME}" not found.`);

  const rows = configSheet.getDataRange().getValues() as string[][];
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row[0]) map[String(row[0]).trim()] = String(row[1]).trim();
  }

  _configCache = {
    NYRRDataSheetId: map['NYRRDataSheetId'] ?? '',
    NYRRClubName: map['NYRRClubName'] ?? 'Misty Mountain Runners',
    NYRRResultsBaseURL: map['NYRRResultsBaseURL'] ?? 'https://results.nyrr.org',
    NYRRBatchSize: parseInt(map['NYRRBatchSize'] ?? '10', 10),
    NYRRSleepMs: parseInt(map['NYRRSleepMs'] ?? '2000', 10),
    MembershipSheetId: membershipSheetId,
  };
  return _configCache;
}

/** Returns the NYRR data spreadsheet. */
export function getNyrrSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  const config = getNyrrConfig();
  return SpreadsheetApp.openById(config.NYRRDataSheetId);
}

/** Returns the membership master spreadsheet. */
export function getMembershipSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  const config = getNyrrConfig();
  return SpreadsheetApp.openById(config.MembershipSheetId);
}

/** Returns the named sheet from the NYRR data spreadsheet. */
export function getNyrrSheet(
  name: string
): GoogleAppsScript.Spreadsheet.Sheet {
  const ss = getNyrrSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`NYRR sheet "${name}" not found.`);
  return sheet;
}

/** Returns the Membership-Master sheet. */
export function getMembershipMasterSheet(): GoogleAppsScript.Spreadsheet.Sheet {
  const ss = getMembershipSpreadsheet();
  const sheet = ss.getSheetByName(MEMBERSHIP_MASTER_SHEET);
  if (!sheet) throw new Error(`Sheet "${MEMBERSHIP_MASTER_SHEET}" not found.`);
  return sheet;
}
