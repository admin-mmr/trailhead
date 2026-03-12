/**
 * nyrr/src/types.ts
 * Shared types for the MMR-NYRR standalone pipeline.
 * Runs as a separate GAS project; uses UrlFetchApp (not fetch).
 */

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Keys stored in the membership Sheets Config tab relevant to NYRR. */
interface NyrrConfig {
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

/** Raw event object returned by the NYRR events details endpoint. */
interface NyrrApiEvent {
  eventCode: string;             // e.g. "M2024", "NYCHALF2024"
  eventName: string;
  startDateTime: string;         // ISO datetime
  venue: string;
  distanceName: string;          // e.g. "5 kilometers"
  distanceUnitCode: string;      // e.g. "5K", "Marathon"
  distanceDimension: number;
  runnerAwardsCount: number;
}

/** Raw runner/finisher object returned by the NYRR finishers endpoint. */
interface NyrrApiFinisher {
  runnerId: number;              // NYRR member ID (numeric)
  firstName: string;
  lastName: string;
  bib: string;                   // bib number
  age: number | null;
  gender: string;                // "M" | "F"
  city: string;
  countryCode: string;           // e.g. "USA"
  stateProvince: string;         // US state abbreviation, e.g. "NJ"
  iaaf: string;                  // country code, e.g. "MAR"
  overallPlace: number | null;   // Can be null for synthetic/incomplete records
  overallTime: string;           // e.g. "0:14:46"
  pace: string;                  // e.g. "04:45"
  genderPlace: number | null;    // Can be null for synthetic/incomplete records
  ageGradeTime?: string;
  ageGradePlace?: number;
  ageGradePercent?: number;
  racesCount?: number;
}

/** Raw runner history item from the NYRR runner profile endpoint. */
interface NyrrApiRunnerResult {
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

/** Team object returned by the teams/search endpoint. */
interface NyrrApiTeam {
  teamCode: string;              // e.g. "MMR"
  teamName: string;
  teamType: string;              // e.g. "Club Team"
  runnersCount: number;
}

/** Runner details object returned by the runners/details endpoint. */
interface NyrrApiRunnerDetails {
  runnerId: number;
  firstName: string;
  lastName: string;
  age: number;
  gender: string;
  city: string;
  countryCode: string;
  countryName: string;
  stateProvince: string;
  teamName: string;
  bib: string;
  // Note: memberId field exists in API response but not used in Phase 1
  // Phase 2 will use memberId from this endpoint to map to MMR Member ID
  firstEventYear: number;
  lastEventYear: number;
  photoUrl: string;
  basnoPhotoUrl: string;
  eventCode: string;
  eventName: string;
  distanceName: string;
  startDateTime: string;
}

/** Runner profile object returned by the runners/recentDetails endpoint. */
interface NyrrApiRunnerProfile {
  runnerId: number;
  firstName: string;
  lastName: string;
  age: number;
  gender: string;
  city: string;
  countryCode: string | null;
  countryName: string;
  stateProvince: string;
  teamName: string;
  bib: string;
  // Note: memberId field exists in API response but not used in Phase 1
  // Phase 2 will use memberId from this endpoint to map to MMR Member ID
  firstEventYear: number;
  lastEventYear: number;
  photoUrl: string;
  basnoPhotoUrl: string;
  eventCode: string | null;      // null for profile endpoint
  eventName: string | null;      // null for profile endpoint
  distanceName: string | null;   // null for profile endpoint
  startDateTime: string;         // "0001-01-01T00:00:00" for profile endpoint
}

/** Runner race history item from the runners/races endpoint. */
interface NyrrApiRunnerRace {
  runnerId: string;              // numeric as string
  bib: string;
  eventCode: string;
  eventName: string;
  venue: string;
  distanceName: string;
  startDateTime: string;
  actualTime: string;            // e.g. "2:00:33"
  actualPace: string;            // e.g. "09:12"
}

// ---------------------------------------------------------------------------
// Internal data models (written to Google Sheets)
// ---------------------------------------------------------------------------

/** One row in the NYRR-Events sheet. */
interface NyrrEvent {
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

type NyrrProcessingStatus =
  | 'Pending'
  | 'InProgress'
  | 'Completed'
  | 'Error';

/** One row in the NYRR-Results sheet. */
interface NyrrResult {
  resultId: string;              // "NYRR-RES-{timestamp}-{random}"
  nyrrEventId: string;
  eventName: string;
  eventDate: string;
  nyrrRunnerId: string;          // string representation of NYRR runner ID
  runnerName: string;
  age: number | null;
  gender: string;
  state: string;                 // state/province from API (e.g. "NJ")
  finishTime: string;            // e.g. "0:14:46"
  pace: string;                  // e.g. "04:45"
  bibNumber: string;             // bib number as string
  overallPlace: number | null;   // overall place (can be null for registrants)
  genderPlace: number | null;    // gender place (can be null for registrants)
  isMMRClub: boolean;            // true if NYRR lists club as MMR
  mmrMemberId: string;           // matched Axxxx, or ""
  isRegisteredOnly: boolean;     // true = upcoming event, no finish time
  scanTimestamp: string;         // ISO datetime
}

/** One row in the NYRR-ProcessingLog sheet. */
interface NyrrProcessingLog {
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
interface MmrMember {
  memberId: string;              // Axxxx
  firstName: string;
  lastName: string;
  nyrrMemberId: string;          // may be blank
  nyrrMemberName: string;        // may be blank
}
