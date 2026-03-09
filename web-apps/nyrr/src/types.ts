/**
 * nyrr/src/types.ts
 * Shared types for the MMR-NYRR standalone pipeline.
 * Runs as a separate GAS project; uses UrlFetchApp (not fetch).
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Keys stored in the membership Sheets Config tab relevant to NYRR. */
export interface NyrrConfig {
  NYRRDataSheetId: string;       // Spreadsheet ID of the MMR-NYRR-Data file
  NYRRClubName: string;          // "Misty Mountain Runners"
  NYRRResultsBaseURL: string;    // "https://results.nyrr.org"
  NYRRBatchSize: number;         // events to process per scheduled run (default 10)
  NYRRSleepMs: number;           // ms to sleep between HTTP requests (default 2000)
  MembershipSheetId: string;     // Spreadsheet ID of the main membership file
}

// ---------------------------------------------------------------------------
// NYRR API response shapes (reverse-engineered from results.nyrr.org)
// ---------------------------------------------------------------------------

/** Raw event object returned by the NYRR events/races list endpoint. */
export interface NyrrApiEvent {
  eventCode: string;             // e.g. "M2024", "NYCHALF2024"
  name: string;
  date: string;                  // ISO date string
  location: string;
  distance: string;              // e.g. "Marathon", "Half Marathon", "10K"
  url: string;                   // canonical results page URL
}

/** Raw runner/finisher object returned by the NYRR finishers endpoint. */
export interface NyrrApiFinisher {
  runnerId: string;              // NYRR member ID
  firstName: string;
  lastName: string;
  age: number | null;
  gender: string;                // "M" | "F" | "NB" | ""
  state: string;                 // US state abbreviation
  finishTime: string;            // "1:52:34" or "" if DNF
  pace: string;                  // "8:34/mi" or ""
  bibNumber: string;
  overallPlace: number | null;
  genderPlace: number | null;
  club: string;                  // club name as listed on NYRR
}

/** Raw runner history item from the NYRR runner profile endpoint. */
export interface NyrrApiRunnerResult {
  eventCode: string;
  eventName: string;
  eventDate: string;
  distance: string;
  finishTime: string;
  pace: string;
  bibNumber: string;
  overallPlace: number | null;
  genderPlace: number | null;
  club: string;
}

// ---------------------------------------------------------------------------
// Internal data models (written to Google Sheets)
// ---------------------------------------------------------------------------

/** One row in the NYRR-Events sheet. */
export interface NyrrEvent {
  nyrrEventId: string;           // "NYRR-EV-{eventCode}"
  eventCode: string;             // NYRR's own event code
  eventName: string;
  eventUrl: string;
  location: string;
  distance: string;
  eventDate: string;             // ISO date
  eventYear: number;
  isUpcoming: boolean;
  processingStatus: NyrrProcessingStatus;
  processedTimestamp: string;    // ISO datetime or ""
  processedBy: string;           // "System" or admin email
  resultCount: number;
  notes: string;
}

export type NyrrProcessingStatus =
  | 'Pending'
  | 'InProgress'
  | 'Completed'
  | 'Error';

/** One row in the NYRR-Results sheet. */
export interface NyrrResult {
  resultId: string;              // "NYRR-RES-{timestamp}-{random}"
  nyrrEventId: string;
  eventName: string;
  eventDate: string;
  nyrrMemberId: string;
  runnerName: string;
  age: number | null;
  gender: string;
  state: string;
  finishTime: string;
  pace: string;
  bibNumber: string;
  overallPlace: number | null;
  genderPlace: number | null;
  isMMRClub: boolean;            // true if NYRR lists club as MMR
  mmrMemberId: string;           // matched Axxxx, or ""
  isRegisteredOnly: boolean;     // true = upcoming event, no finish time
  scanTimestamp: string;         // ISO datetime
}

/** One row in the NYRR-ProcessingLog sheet. */
export interface NyrrProcessingLog {
  logId: string;                 // "NYRR-LOG-{timestamp}-{random}"
  runTimestamp: string;
  triggeredBy: string;           // "Scheduled" or admin email
  nyrrEventId: string;
  eventName: string;
  runStatus: 'Success' | 'PartialSuccess' | 'Failed';
  rowsWritten: number;
  errorDetails: string;
  verifiedBy: string;
  verifiedTimestamp: string;
  notes: string;
}

/** Member row from Membership-Master-Main-3 (NYRR-relevant fields only). */
export interface MmrMember {
  memberId: string;              // Axxxx
  firstName: string;
  lastName: string;
  nyrrMemberId: string;          // may be blank
  nyrrMemberName: string;        // may be blank
}
