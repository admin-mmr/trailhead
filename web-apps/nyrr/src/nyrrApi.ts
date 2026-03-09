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

import { NyrrApiEvent, NyrrApiFinisher, NyrrApiRunnerResult } from './types';
import { getNyrrConfig } from './config';

// ---------------------------------------------------------------------------
// Internal HTTP helper
// ---------------------------------------------------------------------------

function fetchJson<T>(url: string, params?: Record<string, string>): T {
  const config = getNyrrConfig();

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
      // Add any required headers (e.g. Origin, Referer) identified during
      // the network-tab inspection.
      Origin: config.NYRRResultsBaseURL,
      Referer: config.NYRRResultsBaseURL + '/',
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

// ---------------------------------------------------------------------------
// Endpoint: list of all races / events
// ---------------------------------------------------------------------------

/**
 * Returns the full list of NYRR events (past and upcoming).
 *
 * Confirmed endpoint pattern (verify via DevTools):
 *   GET https://results.nyrr.org/api/v1/races
 *
 * TODO: Replace with actual confirmed endpoint after network inspection.
 */
export function getAllEvents(): NyrrApiEvent[] {
  const base = getNyrrConfig().NYRRResultsBaseURL;
  // PLACEHOLDER — confirm real endpoint via DevTools network tab
  const raw = fetchJson<{ events?: NyrrApiEvent[]; races?: NyrrApiEvent[] }>(
    `${base}/api/v1/races`
  );
  return raw.events ?? raw.races ?? [];
}

// ---------------------------------------------------------------------------
// Endpoint: finishers for a specific event (with optional club filter)
// ---------------------------------------------------------------------------

/**
 * Returns all finishers for a given NYRR event, optionally filtered by club.
 *
 * Confirmed endpoint pattern (verify via DevTools):
 *   GET https://results.nyrr.org/api/v1/event/{eventCode}/finishers
 *       ?club=Misty+Mountain+Runners&page=1&pageSize=500
 *
 * NYRR paginates results. This function handles pagination automatically.
 *
 * @param eventCode - NYRR event code, e.g. "M2024", "NYCHALF2025"
 * @param clubFilter - optional club name to filter by (URL-encoded by helper)
 */
export function getEventFinishers(
  eventCode: string,
  clubFilter?: string
): NyrrApiFinisher[] {
  const base = getNyrrConfig().NYRRResultsBaseURL;
  const PAGE_SIZE = 500; // adjust based on what the API accepts
  const allFinishers: NyrrApiFinisher[] = [];
  let page = 1;

  while (true) {
    const params: Record<string, string> = {
      page: String(page),
      pageSize: String(PAGE_SIZE),
    };
    if (clubFilter) params['club'] = clubFilter;

    // PLACEHOLDER — confirm real endpoint + param names via DevTools
    const raw = fetchJson<{
      finishers?: NyrrApiFinisher[];
      results?: NyrrApiFinisher[];
      totalCount?: number;
    }>(`${base}/api/v1/event/${eventCode}/finishers`, params);

    const batch = raw.finishers ?? raw.results ?? [];
    allFinishers.push(...batch);

    // Stop when we've received fewer items than a full page
    if (batch.length < PAGE_SIZE) break;
    page++;

    // Rate-limit between page fetches
    Utilities.sleep(getNyrrConfig().NYRRSleepMs);
  }

  return allFinishers;
}

// ---------------------------------------------------------------------------
// Endpoint: upcoming event registrants (pre-race)
// ---------------------------------------------------------------------------

/**
 * Returns the registrant list for an upcoming event, filtered by club.
 *
 * Pre-race registrant lists may use a different endpoint than finishers.
 * Confirm via DevTools on an upcoming event's results page.
 *
 * @param eventCode - NYRR event code
 * @param clubFilter - optional club name filter
 */
export function getEventRegistrants(
  eventCode: string,
  clubFilter?: string
): NyrrApiFinisher[] {
  const base = getNyrrConfig().NYRRResultsBaseURL;
  const PAGE_SIZE = 500;
  const allRegistrants: NyrrApiFinisher[] = [];
  let page = 1;

  while (true) {
    const params: Record<string, string> = {
      page: String(page),
      pageSize: String(PAGE_SIZE),
    };
    if (clubFilter) params['club'] = clubFilter;

    // PLACEHOLDER — may be same endpoint as finishers, or a separate
    // /registrants endpoint. Confirm via DevTools.
    const raw = fetchJson<{
      registrants?: NyrrApiFinisher[];
      finishers?: NyrrApiFinisher[];
    }>(`${base}/api/v1/event/${eventCode}/registrants`, params);

    const batch = raw.registrants ?? raw.finishers ?? [];
    allRegistrants.push(...batch);

    if (batch.length < PAGE_SIZE) break;
    page++;
    Utilities.sleep(getNyrrConfig().NYRRSleepMs);
  }

  return allRegistrants;
}

// ---------------------------------------------------------------------------
// Endpoint: runner profile / personal result history
// ---------------------------------------------------------------------------

/**
 * Returns all past NYRR results for a given runner by their NYRR member ID.
 * Used for the supplementary "search by member ID" pass to catch MMR members
 * who raced under a different club affiliation.
 *
 * Confirmed endpoint pattern (verify via DevTools on a runner profile page):
 *   GET https://results.nyrr.org/api/v1/runner/{runnerId}/results
 *
 * @param nyrrMemberId - the runner's NYRR member ID
 */
export function getRunnerResults(nyrrMemberId: string): NyrrApiRunnerResult[] {
  const base = getNyrrConfig().NYRRResultsBaseURL;

  // PLACEHOLDER — confirm real endpoint + response shape via DevTools
  const raw = fetchJson<{
    results?: NyrrApiRunnerResult[];
    races?: NyrrApiRunnerResult[];
  }>(`${base}/api/v1/runner/${encodeURIComponent(nyrrMemberId)}/results`);

  return raw.results ?? raw.races ?? [];
}
