/**
 * nyrr/src/main.ts
 *
 * Global GAS entry points.
 * All functions here are in global scope — required for GAS time triggers
 * and for calls from the membership portal via google.script.run.
 *
 * Trigger setup (do in GAS UI or via setup() below):
 *   processAllPendingNyrrEvents  → weekly, Sunday 2–3am
 *   refreshUpcomingNyrrEvents    → daily, 3–4am
 *   promoteCompletedEvents       → daily, 1–2am
 */

/// <reference path="./types.ts" />
/// <reference path="./config.ts" />
/// <reference path="./sheets.ts" />
/// <reference path="./pipeline.ts" />
/// <reference path="./nyrrApi.ts" />



// ---------------------------------------------------------------------------
// Scheduled triggers (called by GAS time-based triggers)
// ---------------------------------------------------------------------------

// Weekly: discover + ingest new events for MMR club
function runWeeklyPipeline(): void {
  processAllPendingNyrrEvents();
}

// Daily: refresh upcoming event registrant lists
function runDailyRefresh(): void {
  refreshUpcomingNyrrEvents();
}

// Daily: flip past upcoming events to pending-result-ingestion
function runDailyPromotion(): void {
  promoteCompletedEvents();
}

// ---------------------------------------------------------------------------
// Manual / admin-triggered entry points
// ---------------------------------------------------------------------------

/**
 * Admin calls this to manually re-process a specific event by event code.
 * Can be called from the GAS script editor or from an admin UI button.
 */
function manuallyProcessEvent(eventCode: string, adminEmail: string): string {
  const event = getAllNyrrEvents().find((e) => e.eventCode === eventCode);
  if (!event) return `Event "${eventCode}" not found in NYRR-Events sheet.`;

  const result = ingestEvent(event, adminEmail);
  matchNyrrResultsToMembers();

  if (result.error) return `Error: ${result.error}`;
  return `Done. ${result.rowsWritten} rows written for "${event.eventName}".`;
}

/**
 * Called by the membership portal (nyrr.ts) when a member saves a new
 * NYRRMemberID on their profile. Passed as a fire-and-forget background call.
 */
function triggerMemberBackfill(nyrrMemberId: string, mmrMemberId: string): void {
  backfillMemberResults(nyrrMemberId, mmrMemberId);
}

// ---------------------------------------------------------------------------
// API surface — called by the membership portal frontend via google.script.run
// ---------------------------------------------------------------------------

/**
 * Returns all NYRR results for a given member as a JSON string.
 * The membership portal's page_nyrr_history.html calls this.
 *
 * @param jsonRequest - JSON string: { mmrMemberId: string, nyrrMemberId?: string }
 * @returns JSON string: { ok: true, results: NyrrResult[] } | { ok: false, error: string }
 */
function getMemberNYRRHistory(jsonRequest: string): string {
  try {
    const { mmrMemberId, nyrrMemberId } = JSON.parse(jsonRequest) as {
      mmrMemberId: string;
      nyrrMemberId?: string;
    };
    const results = getResultsForMember(mmrMemberId, nyrrMemberId);
    // Sort descending by event date
    results.sort((a, b) => (a.eventDate < b.eventDate ? 1 : -1));
    return JSON.stringify({ ok: true, results });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: msg });
  }
}

/**
 * Returns the list of all NYRR events with their processing status.
 * Used by the admin panel NYRR tab.
 */
function getNYRREventList(_jsonRequest: string): string {
  try {
    const events = getAllNyrrEvents();
    return JSON.stringify({ ok: true, events });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return JSON.stringify({ ok: false, error: msg });
  }
}

// ---------------------------------------------------------------------------
// One-time setup: install time-based triggers
// ---------------------------------------------------------------------------

/**
 * Run this ONCE from the GAS script editor to register all triggers.
 * After running, delete or comment out to avoid duplicate triggers.
 */
function setupTriggers(): void {
  // Remove existing triggers to avoid duplication
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));

  // Promote completed events: daily at 1am
  ScriptApp.newTrigger('runDailyPromotion')
    .timeBased()
    .everyDays(1)
    .atHour(1)
    .create();

  // Refresh upcoming event registrant lists: daily at 3am
  ScriptApp.newTrigger('runDailyRefresh')
    .timeBased()
    .everyDays(1)
    .atHour(3)
    .create();

  // Full weekly pipeline: every Sunday
  ScriptApp.newTrigger('runWeeklyPipeline')
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.SUNDAY)
    .atHour(2)
    .create();
}
