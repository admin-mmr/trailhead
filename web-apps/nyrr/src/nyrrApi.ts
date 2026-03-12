/**
 * nyrr/src/nyrrApi.ts
 *
 * Thin wrappers around results.nyrr.org's undocumented REST API.
 * Uses GAS UrlFetchApp (NOT fetch / axios / node-http).
 *
 * HOW TO FIND THE REAL ENDPOINTS:
 *   1. Open results.nyrr.org in Chrome.
 *   2. Open DevTools → Network tab → filter by "Fetch/XHR".
 *   3. Browse to an event finishers page and a runner profile page.
 *   4. Copy the request URLs and response shapes.
 *   5. Update the URL constants below and the response interfaces in types.ts.
 *
 * The placeholder URLs below match the pattern observed in public tooling
 * (e.g. tedbrakob/nyrr-results-api). Replace with confirmed values after
 * doing the network-tab inspection.
 */

/// <reference path="./types.ts" />
/// <reference path="./config.ts" />



// ---------------------------------------------------------------------------
// Internal HTTP helpers
// ---------------------------------------------------------------------------

// NYRR API v2 base URL
const NYRR_API_BASE = 'https://rmsprodapi.nyrr.org/api/v2';

function fetchJsonGet<T>(url: string, params?: Record<string, string>): T {
  // Build query string
  let fullUrl = url;
  if (params && Object.keys(params).length > 0) {
    const qs = Object.entries(params)
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    fullUrl = `${url}?${qs}`;
  }

  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'get',
    headers: {
      Accept: 'application/json',
    },
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(fullUrl, options);
  const code = response.getResponseCode();

  if (code !== 200) {
    throw new Error(`NYRR API error: HTTP ${code} for ${fullUrl}`);
  }

  return JSON.parse(response.getContentText()) as T;
}

function fetchJsonPost<T>(url: string, body: Record<string, unknown>): T {
  const options: GoogleAppsScript.URL_Fetch.URLFetchRequestOptions = {
    method: 'post',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    payload: JSON.stringify(body),
    muteHttpExceptions: true,
  };

  const response = UrlFetchApp.fetch(url, options);
  const code = response.getResponseCode();

  if (code !== 200) {
    throw new Error(`NYRR API error: HTTP ${code} for ${url}`);
  }

  return JSON.parse(response.getContentText()) as T;
}

// ---------------------------------------------------------------------------
// Endpoint: list of all races / events
// ---------------------------------------------------------------------------

/**
 * Returns the full list of NYRR events (past and upcoming).
 *
 * Confirmed endpoint:
 *   POST https://rmsprodapi.nyrr.org/api/v2/events/search
 *   Request: {
 *     searchString: string | null,
 *     distance: string | null,
 *     year: number | null,
 *     notOlderDays: number | null,
 *     sortColumn: string,
 *     sortDescending: boolean,
 *     pageIndex: number,
 *     pageSize: number
 *   }
 *
 * Pagination is automatic. Returns all events across all pages.
 */
function getAllEvents(): NyrrApiEvent[] {
  const PAGE_SIZE = 51; // matches API's default
  const allEvents: NyrrApiEvent[] = [];
  let pageIndex = 1;

  while (true) {
    const raw = fetchJsonPost<{
      totalItems: number;
      items: NyrrApiEvent[];
    }>(NYRR_API_BASE + '/events/search', {
      searchString: null,
      distance: null,
      year: null,
      notOlderDays: null,
      sortColumn: 'StartDateTime',
      sortDescending: true,  // Most recent first
      pageIndex,
      pageSize: PAGE_SIZE,
    });

    allEvents.push(...raw.items);

    // Stop when we've received fewer items than a full page or all items
    if (raw.items.length < PAGE_SIZE || allEvents.length >= raw.totalItems) {
      break;
    }
    pageIndex++;

    // Rate-limit between page fetches
    Utilities.sleep(getNyrrConfig().NYRRSleepMs);
  }

  return allEvents;
}

// ---------------------------------------------------------------------------
// Endpoint: event details
// ---------------------------------------------------------------------------

/**
 * Returns details for a specific NYRR event.
 *
 * Confirmed endpoint:
 *   POST https://rmsprodapi.nyrr.org/api/v2/events/details
 *   Request: { eventCode: string }
 *
 * @param eventCode - NYRR event code, e.g. "26WASH", "M2024"
 */
function getEventDetails(eventCode: string): NyrrApiEvent {
  const raw = fetchJsonPost<{
    eventDetails: NyrrApiEvent;
    success: boolean;
    message: string | null;
  }>(NYRR_API_BASE + '/events/details', { eventCode });

  if (!raw.success || !raw.eventDetails) {
    throw new Error(`Failed to fetch event details for ${eventCode}`);
  }

  return raw.eventDetails;
}

// ---------------------------------------------------------------------------
// Endpoint: finishers for a specific event (with optional club filter)
// ---------------------------------------------------------------------------

/**
 * Returns all finishers for a given NYRR event, optionally filtered by club/search.
 *
 * Confirmed endpoint:
 *   POST https://rmsprodapi.nyrr.org/api/v2/runners/finishers-filter
 *   Request: {
 *     eventCode: string,
 *     searchString: string | null,
 *     handicap: string | null,
 *     sortColumn: string,
 *     sortDescending: boolean,
 *     pageIndex: number,
 *     pageSize: number
 *   }
 *
 * NYRR paginates results. This function handles pagination automatically.
 *
 * @param eventCode - NYRR event code, e.g. "26WASH", "M2024"
 * @param searchString - optional filter (use for club name or runner name)
 */
function getEventFinishers(
  eventCode: string,
  searchString?: string
): NyrrApiFinisher[] {
  const PAGE_SIZE = 51; // matches API's default/apparent limit
  const allFinishers: NyrrApiFinisher[] = [];
  let pageIndex = 1;

  while (true) {
    const raw = fetchJsonPost<{
      totalItems: number;
      items: NyrrApiFinisher[];
    }>(NYRR_API_BASE + '/runners/finishers-filter', {
      eventCode,
      searchString: searchString ?? null,
      handicap: null,
      sortColumn: 'overallTime',
      sortDescending: false,
      pageIndex,
      pageSize: PAGE_SIZE,
    });

    allFinishers.push(...raw.items);

    // Stop when we've received fewer items than a full page or all items
    if (raw.items.length < PAGE_SIZE || allFinishers.length >= raw.totalItems) {
      break;
    }
    pageIndex++;

    // Rate-limit between page fetches
    Utilities.sleep(getNyrrConfig().NYRRSleepMs);
  }

  return allFinishers;
}

// ---------------------------------------------------------------------------
// Endpoint: upcoming event registrants (pre-race)
// ---------------------------------------------------------------------------

/**
 * Returns the registrant list for an upcoming event, filtered by search string.
 *
 * Uses the same endpoint as getEventFinishers but with different filters.
 * For pre-race registrants, we may need to identify the event as "upcoming"
 * and apply appropriate filters.
 *
 * TODO: Confirm the exact parameters/endpoint for pre-race registrants.
 * The finishers-filter endpoint may need different parameters or a separate
 * registrants endpoint may exist.
 *
 * @param eventCode - NYRR event code
 * @param searchString - optional filter string
 */
function getEventRegistrants(
  eventCode: string,
  searchString?: string
): NyrrApiFinisher[] {
  // For now, use the same endpoint as finishers
  // May need adjustment once we confirm pre-race registrant handling
  return getEventFinishers(eventCode, searchString);
}

// ---------------------------------------------------------------------------
// Endpoint: runner profile / personal result history
// ---------------------------------------------------------------------------

/**
 * Returns all past NYRR race results for a given runner by their NYRR runner ID.
 * Used for the supplementary "search by member ID" pass to catch MMR members
 * who raced under a different club affiliation.
 *
 * Confirmed endpoint:
 *   POST https://rmsprodapi.nyrr.org/api/v2/runners/races
 *   Request: {
 *     runnerId: string | number,
 *     searchString: null,
 *     year: null,
 *     distance: null,
 *     teamCode: null,
 *     [various other optional filters],
 *     pageIndex: number,
 *     pageSize: number,
 *     sortColumn: string,
 *     sortDescending: boolean
 *   }
 *
 * @param nyrrMemberId - the runner's NYRR runner ID (numeric)
 */
function getRunnerResults(nyrrMemberId: string): NyrrApiRunnerRace[] {
  const PAGE_SIZE = 51;
  const allRaces: NyrrApiRunnerRace[] = [];
  let pageIndex = 1;

  while (true) {
    const raw = fetchJsonPost<{
      totalItems: number;
      items: NyrrApiRunnerRace[];
    }>(NYRR_API_BASE + '/runners/races', {
      runnerId: nyrrMemberId,
      searchString: null,
      year: null,
      distance: null,
      teamCode: null,
      overallPlaceFrom: null,
      overallPlaceTo: null,
      paceFrom: null,
      paceTo: null,
      overallTimeFrom: null,
      overallTimeTo: null,
      gunTimeFrom: null,
      gunTimeTo: null,
      ageGradedTimeFrom: null,
      ageGradedTimeTo: null,
      ageGradedPlaceFrom: null,
      ageGradedPlaceTo: null,
      ageGradedPerformanceFrom: null,
      ageGradedPerformanceTo: null,
      pageIndex,
      pageSize: PAGE_SIZE,
      sortColumn: 'EventDate',
      sortDescending: true,
    });

    allRaces.push(...raw.items);

    // Stop when we've received fewer items than a full page or all items
    if (raw.items.length < PAGE_SIZE || allRaces.length >= raw.totalItems) {
      break;
    }
    pageIndex++;

    // Rate-limit between page fetches
    Utilities.sleep(getNyrrConfig().NYRRSleepMs);
  }

  return allRaces;
}

// ---------------------------------------------------------------------------
// Endpoint: teams search
// ---------------------------------------------------------------------------

/**
 * Returns teams for a given event, optionally filtered by search word.
 *
 * Confirmed endpoint:
 *   POST https://rmsprodapi.nyrr.org/api/v2/teams/search
 *   Request: {
 *     eventCode: string,
 *     searchWord: string | null,
 *     pageIndex: number,
 *     pageSize: number,
 *     sortColumn: string | null,
 *     sortDescending: boolean
 *   }
 *
 * @param eventCode - NYRR event code
 * @param searchWord - optional filter by team name (e.g., "Misty Mountain")
 * @param pageSize - number of results per page (default 51)
 */
function getTeams(
  eventCode: string,
  searchWord?: string,
  pageSize: number = 51
): NyrrApiTeam[] {
  const allTeams: NyrrApiTeam[] = [];
  let pageIndex = 1;

  while (true) {
    const raw = fetchJsonPost<{
      totalItems: number;
      items: NyrrApiTeam[];
    }>(NYRR_API_BASE + '/teams/search', {
      eventCode,
      searchWord: searchWord ?? null,
      pageIndex,
      pageSize,
      sortColumn: null,
      sortDescending: false,
    });

    allTeams.push(...raw.items);

    // Stop when we've received fewer items than a full page
    if (raw.items.length < pageSize || allTeams.length >= raw.totalItems) {
      break;
    }
    pageIndex++;

    // Rate-limit between page fetches
    Utilities.sleep(getNyrrConfig().NYRRSleepMs);
  }

  return allTeams;
}

// ---------------------------------------------------------------------------
// Endpoint: team runners (all runners for a specific team in an event)
// ---------------------------------------------------------------------------

/**
 * Returns all runners for a specific team in a specific event.
 *
 * Confirmed endpoint:
 *   POST https://rmsprodapi.nyrr.org/api/v2/teams/teamRunners
 *   Request: { eventCode: string, teamCode: string, sortColumn: null, sortDescending: false }
 *
 * Returns runners with full details: runnerId, firstName, lastName, gender, age, city,
 * stateProvince, countryCode, iaaf, bib, overallTime, pace, overallPlace, genderPlace, etc.
 *
 * @param eventCode - NYRR event code (e.g., "26WASH")
 * @param teamCode - Team code (e.g., "MMR")
 */
function getTeamRunners(
  eventCode: string,
  teamCode: string
): NyrrApiFinisher[] {
  const PAGE_SIZE = 51;
  const allRunners: NyrrApiFinisher[] = [];
  let pageIndex = 1;

  while (true) {
    const raw = fetchJsonPost<{
      totalItems: number;
      items: NyrrApiFinisher[];
    }>(NYRR_API_BASE + '/teams/teamRunners', {
      eventCode,
      teamCode,
      pageIndex,
      pageSize: PAGE_SIZE,
      sortColumn: null,
      sortDescending: false,
    });

    allRunners.push(...raw.items);

    // Stop when we've received fewer items than a full page or all items
    if (raw.items.length < PAGE_SIZE || allRunners.length >= raw.totalItems) {
      break;
    }
    pageIndex++;

    // Rate-limit between page fetches
    Utilities.sleep(getNyrrConfig().NYRRSleepMs);
  }

  return allRunners;
}

// ---------------------------------------------------------------------------
// Endpoint: runner details for specific event
// ---------------------------------------------------------------------------

/**
 * Returns detailed information about a specific runner in a specific event.
 *
 * Confirmed endpoint:
 *   POST https://rmsprodapi.nyrr.org/api/v2/runners/details
 *   Request: { runnerId: number }
 *
 * Note: The response includes event-specific information (eventCode, eventName, etc.)
 * even though only runnerId is required. The endpoint seems context-aware.
 *
 * @param runnerId - NYRR runner ID (numeric)
 */
function getRunnerDetails(runnerId: number): NyrrApiRunnerDetails {
  try {
    const url = NYRR_API_BASE + '/runners/details';
    const payload = { runnerId };

    console.log(`[getRunnerDetails.start] Fetching details for runnerId: ${runnerId}`);
    console.log(`[getRunnerDetails.url] POST ${url}`);
    console.log(`[getRunnerDetails.payload] ${JSON.stringify(payload)}`);

    const raw = fetchJsonPost<{
      details: NyrrApiRunnerDetails;
      success: boolean;
      message: string | null;
    }>(url, payload);

    console.log(`[getRunnerDetails.response] Raw response:`, JSON.stringify(raw));
    console.log(`[getRunnerDetails.check] success=${raw.success}, hasDetails=${!!raw.details}, message=${raw.message}`);

    if (!raw.success || !raw.details) {
      const errorMsg = `Failed to fetch runner details for ID ${runnerId}. API response: success=${raw.success}, message=${raw.message}`;
      console.error(`[getRunnerDetails.error] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    console.log(`[getRunnerDetails.success] Got details for runner ${raw.details.firstName} ${raw.details.lastName}`);
    return raw.details;
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[getRunnerDetails.exception] Exception: ${error}`);
    throw e;
  }
}

/**
 * Returns a runner's profile information (recent/general profile, not event-specific).
 *
 * Confirmed endpoint:
 *   POST https://rmsprodapi.nyrr.org/api/v2/runners/recentDetails
 *   Request: { runnerId: string | number }
 *
 * Note: Returns general profile info including first/last event year.
 * Event-specific fields (eventCode, eventName, etc.) are null.
 *
 * @param runnerId - NYRR runner ID (numeric)
 */
function getRunnerProfile(runnerId: number): NyrrApiRunnerProfile {
  try {
    const url = NYRR_API_BASE + '/runners/recentDetails';
    const payload = { runnerId };

    console.log(`[getRunnerProfile.start] Fetching profile for runnerId: ${runnerId}`);
    console.log(`[getRunnerProfile.url] POST ${url}`);
    console.log(`[getRunnerProfile.payload] ${JSON.stringify(payload)}`);

    const raw = fetchJsonPost<{
      details: NyrrApiRunnerProfile;
      success: boolean;
      message: string | null;
    }>(url, payload);

    console.log(`[getRunnerProfile.response] Raw response:`, JSON.stringify(raw));
    console.log(`[getRunnerProfile.check] success=${raw.success}, hasDetails=${!!raw.details}, message=${raw.message}`);

    if (!raw.success || !raw.details) {
      const errorMsg = `Failed to fetch runner profile for ID ${runnerId}. API response: success=${raw.success}, message=${raw.message}`;
      console.error(`[getRunnerProfile.error] ${errorMsg}`);
      throw new Error(errorMsg);
    }

    console.log(`[getRunnerProfile.success] Got profile for runner ${raw.details.firstName} ${raw.details.lastName}`);
    return raw.details;
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    console.error(`[getRunnerProfile.exception] Exception: ${error}`);
    throw e;
  }
}


