/**
 * nyrr/src/config.ts
 * Reads NYRR pipeline config from the membership Sheets Config tab.
 * Script property MEMBERSHIP_SHEET_ID must be set in GAS project settings.
 */

/// <reference path="./types.ts" />

// Sheet / column names
const CONFIG_SHEET_NAME = 'Config';
const MEMBERSHIP_MASTER_SHEET = 'Main';

// NYRR Sheets tab names (in the separate MMR-NYRR-Data spreadsheet)
const NYRR_SHEET = {
  EVENTS: 'NYRR-Events',
  RESULTS: 'NYRR-Results',
  PROCESSING_LOG: 'NYRR-ProcessingLog',
} as const;

// Column indices for NYRR-Events (0-based)
const EVENTS_COL = {
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
const RESULTS_COL = {
  RESULT_ID: 0,
  NYRR_EVENT_ID: 1,
  EVENT_NAME: 2,
  EVENT_DATE: 3,
  RUNNER_ID: 4,              // runnerId from NYRR (e.g., 50459996)
  RUNNER_NAME: 5,            // (was 6, shifted up by 1)
  AGE: 6,
  GENDER: 7,
  STATE: 8,
  FINISH_TIME: 9,
  PACE: 10,
  BIB_NUMBER: 11,
  OVERALL_PLACE: 12,
  GENDER_PLACE: 13,
  IS_MMR_CLUB: 14,
  MMR_MEMBER_ID: 15,         // MMR system member ID (blank until Phase 2, shifted up by 1)
  IS_REGISTERED_ONLY: 16,
  SCAN_TIMESTAMP: 17,
} as const;

// Column indices for NYRR-ProcessingLog (0-based)
const LOG_COL = {
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
const MEMBER_COL = {
  MEMBER_ID: 0,
  FIRST_NAME: 4,
  LAST_NAME: 5,
  NYRR_MEMBER_ID: 23,   // append position — adjust after columns are added
  NYRR_MEMBER_NAME: 24, // adjust after columns are added
} as const;

// ---------------------------------------------------------------------------
// Logging & State Management
// ---------------------------------------------------------------------------

/**
 * Logs a message with timestamp and function context.
 * Also appends to a log in PropertiesService for persistent tracking.
 */
function logDebug(message: string): void {
  const timestamp = new Date().toISOString();
  const logMessage = `[${timestamp}] ${message}`;
  Logger.log(logMessage);

  // Also store in PropertiesService for debugging long runs
  const props = PropertiesService.getScriptProperties();
  const existingLog = props.getProperty('NYRR_DEBUG_LOG') || '';
  const logLines = existingLog.split('\n').slice(-99); // Keep last 100 lines
  logLines.push(logMessage);
  props.setProperty('NYRR_DEBUG_LOG', logLines.join('\n'));
}

/**
 * Gets the current execution state (for resuming interrupted runs).
 */
function getExecutionState(): Record<string, string> {
  const props = PropertiesService.getScriptProperties();
  const stateJson = props.getProperty('NYRR_EXECUTION_STATE') || '{}';
  return JSON.parse(stateJson);
}

/**
 * Saves execution state for resuming interrupted runs.
 */
function saveExecutionState(state: Record<string, string>): void {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('NYRR_EXECUTION_STATE', JSON.stringify(state));
  logDebug(`State saved: ${JSON.stringify(state)}`);
}

/**
 * Clears execution state after successful completion.
 */
function clearExecutionState(): void {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('NYRR_EXECUTION_STATE');
  logDebug('Execution state cleared (run completed)');
}

/**
 * Gets the debug log for reviewing long-running executions.
 */
function getDebugLog(): string {
  const props = PropertiesService.getScriptProperties();
  return props.getProperty('NYRR_DEBUG_LOG') || '(No debug log)';
}

/**
 * Clears the debug log.
 */
function clearDebugLog(): void {
  const props = PropertiesService.getScriptProperties();
  props.deleteProperty('NYRR_DEBUG_LOG');
}

/**
 * Shows current pipeline progress. Call this from the GAS console while a pipeline is running.
 * Usage: In GAS editor console, run: showProgress()
 * This will display the last 30 lines of the debug log showing current progress.
 */
function showProgress(): void {
  const fullLog = getDebugLog();
  const lines = fullLog.split('\n');
  const recentLines = lines.slice(-30); // Last 30 lines
  const output = recentLines.join('\n');
  Logger.log('========== NYRR PIPELINE PROGRESS ==========');
  Logger.log(output);
  Logger.log('=========== (call showProgress() again to refresh) ===========');
}

/**
 * Shows the current execution state (for debugging interrupted runs).
 * Usage: In GAS editor console, run: showExecutionState()
 */
function showExecutionState(): void {
  const state = getExecutionState();
  Logger.log('========== NYRR EXECUTION STATE ==========');
  Logger.log(JSON.stringify(state, null, 2));
}

/**
 * Convenience function: cancel current pipeline run and reset state.
 * This clears the execution state but does NOT stop the currently running function.
 * Note: To actually stop a running function in GAS, you must press "Stop" button in execution log.
 */
function resetPipelineState(): void {
  clearExecutionState();
  clearDebugLog();
  Logger.log('Pipeline state cleared. Next run will start fresh.');
}

// ---------------------------------------------------------------------------
// Config loader
// ---------------------------------------------------------------------------

let _configCache: NyrrConfig | null = null;

/**
 * Reads NYRR pipeline config from the membership Sheets Config tab.
 * Uses a script property MEMBERSHIP_SHEET_ID set in GAS project settings.
 */
function getNyrrConfig(): NyrrConfig {
  if (_configCache) return _configCache;

  const membershipSheetId =
    PropertiesService.getScriptProperties().getProperty('MEMBERSHIP_SHEET_ID') ?? '11SFvgApmDtEv4jz5bTYI9_zEhCFMQAXC4b2z_4s3ljk';

  const ss = SpreadsheetApp.openById(membershipSheetId);
  const configSheet = ss.getSheetByName(CONFIG_SHEET_NAME);
  if (!configSheet) throw new Error(`Config sheet "${CONFIG_SHEET_NAME}" not found.`);

  const rows = configSheet.getDataRange().getValues() as string[][];
  const map: Record<string, string> = {};
  for (const row of rows) {
    if (row[0]) map[String(row[0]).trim()] = String(row[1]).trim();
  }

  _configCache = {
    NYRRDataSheetId: map['NYRRDataSheetId'] ?? '1t4hea56TRr0YxWyOVrGX9TRMjK1e4-_gw2-_Fk9kYTA',
    NYRRClubName: map['NYRRClubName'] ?? 'Misty Mountain Runners',
    NYRRResultsBaseURL: map['NYRRResultsBaseURL'] ?? 'https://results.nyrr.org',
    NYRRBatchSize: parseInt(map['NYRRBatchSize'] ?? '10', 10),
    NYRRSleepMs: parseInt(map['NYRRSleepMs'] ?? '2000', 10),
    MembershipSheetId: membershipSheetId,
  };
  return _configCache;
}

/** Returns the NYRR data spreadsheet. */
function getNyrrSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  const config = getNyrrConfig();
  return SpreadsheetApp.openById(config.NYRRDataSheetId);
}

/** Returns the membership master spreadsheet. */
function getMembershipSpreadsheet(): GoogleAppsScript.Spreadsheet.Spreadsheet {
  const config = getNyrrConfig();
  return SpreadsheetApp.openById(config.MembershipSheetId);
}

/** Returns the named sheet from the NYRR data spreadsheet. */
function getNyrrSheet(
  name: string
): GoogleAppsScript.Spreadsheet.Sheet {
  const ss = getNyrrSpreadsheet();
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error(`NYRR sheet "${name}" not found.`);
  return sheet;
}

/** Returns the Membership-Master sheet. */
function getMembershipMasterSheet(): GoogleAppsScript.Spreadsheet.Sheet {
  const ss = getMembershipSpreadsheet();
  const sheet = ss.getSheetByName(MEMBERSHIP_MASTER_SHEET);
  if (!sheet) throw new Error(`Sheet "${MEMBERSHIP_MASTER_SHEET}" not found.`);
  return sheet;
}
