/**
 * nyrr/src/pipeline.ts
 *
 * Core pipeline logic:
 *   - Two-pass runner collection (club search + member-ID search)
 *   - Event ingestion
 *   - MMR member matching
 *
 * Entry points (called from main.ts, which GAS time triggers fire):
 *   processAllPendingNyrrEvents()   — weekly scheduled run
 *   refreshUpcomingNyrrEvents()     — daily: re-scan upcoming registrant lists
 *   promoteCompletedEvents()        — daily: flip isUpcoming=false after race date
 *   matchNyrrResultsToMembers()     — runs after each ingestion pass
 *   backfillMemberResults(nyrrId)   — triggered when a member saves their NYRR ID
 */

/// <reference path="./types.ts" />
/// <reference path="./config.ts" />
/// <reference path="./sheets.ts" />
/// <reference path="./nyrrApi.ts" />



// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isUpcomingEvent(eventDate: string): boolean {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(eventDate) > today;
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

// ---------------------------------------------------------------------------
// Pass 1: Club search — fetch all MMR finishers/registrants for an event
// ---------------------------------------------------------------------------

function collectClubRunners(
  event: NyrrEvent
): NyrrApiFinisher[] {
  const TEAM_CODE = 'MMR'; // Hardcoded team code (no need to look up every time)
  logDebug(`[collectClubRunners.start] Event: ${event.eventCode}, IsUpcoming: ${event.isUpcoming}`);

  try {
    logDebug(`[collectClubRunners.call] getTeamRunners(eventCode="${event.eventCode}", teamCode="${TEAM_CODE}")`);
    const results = getTeamRunners(event.eventCode, TEAM_CODE);
    logDebug(`[collectClubRunners.result] getTeamRunners returned ${results.length} runners from team ${TEAM_CODE}`);
    return results;
  } catch (e: unknown) {
    const error = e instanceof Error ? e.message : String(e);
    logDebug(`[collectClubRunners.ERROR] ${error}`);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Pass 2: Member-ID search — fetch results for members who set their NYRR ID
// ---------------------------------------------------------------------------

/**
 * For a specific event, collects additional runners by cross-referencing
 * Membership-Master rows that have NYRRMemberID set, but were not captured
 * in the club search (i.e., they race under a different club on NYRR).
 *
 * Returns an array of synthetic NyrrApiFinisher objects built from the
 * runner's profile history, filtered to the given event.
 */
function collectMemberIdRunners(
  event: NyrrEvent,
  alreadyCaptured: Set<string>
): NyrrApiFinisher[] {
  logDebug(`[collectMemberIdRunners.start] Starting member-ID search for event ${event.eventCode}`);
  const members = getMembersWithNyrrId();
  logDebug(`[collectMemberIdRunners.getMembersWithNyrrId] Found ${members.length} members with NYRR IDs`);
  const additional: NyrrApiFinisher[] = [];

  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    if (alreadyCaptured.has(member.nyrrMemberId)) {
      logDebug(`[collectMemberIdRunners.skip] Skipping ${member.firstName} ${member.lastName} (NYRR ID: ${member.nyrrMemberId}) - already in club results`);
      continue;
    }

    logDebug(`[collectMemberIdRunners.call] getRunnerResults(nyrrMemberId="${member.nyrrMemberId}") for ${member.firstName} ${member.lastName}`);
    const history = getRunnerResults(member.nyrrMemberId);
    logDebug(`[collectMemberIdRunners.result] getRunnerResults returned ${history.length} total races`);

    const matchingRace = history.find((r) => r.eventCode === event.eventCode);

    if (matchingRace) {
      logDebug(`[collectMemberIdRunners.match] ✓ Found ${member.firstName} ${member.lastName} in event ${event.eventCode}`);
      // Build a synthetic finisher object so downstream processing is uniform
      additional.push({
        runnerId: parseInt(member.nyrrMemberId) || 0,  // Convert to number, default 0
        firstName: member.firstName,
        lastName: member.lastName,
        bib: matchingRace.bib,
        age: null,
        gender: '',
        city: '',
        countryCode: 'USA',
        stateProvince: '',
        iaaf: '',
        overallPlace: null,  // Not available from races endpoint
        overallTime: matchingRace.actualTime,  // Map actualTime to overallTime
        pace: matchingRace.actualPace,  // Map actualPace to pace
        genderPlace: null,  // Not available from races endpoint
      });
      alreadyCaptured.add(member.nyrrMemberId);
    } else {
      logDebug(`[collectMemberIdRunners.nomatch] ✗ ${member.firstName} ${member.lastName} not found in event ${event.eventCode} (searched ${history.length} races)`);
    }

    Utilities.sleep(getNyrrConfig().NYRRSleepMs);
  }

  logDebug(`[collectMemberIdRunners.end] Collected ${additional.length} additional runners from member-ID search`);
  return additional;
}

// ---------------------------------------------------------------------------
// Core: ingest one event
// ---------------------------------------------------------------------------

function ingestEvent(
  event: NyrrEvent,
  triggeredBy: string = 'System'
): { rowsWritten: number; error: string } {
  logDebug(`[ingestEvent.start] ========== Ingesting ${event.eventCode} "${event.eventName}" ==========`);
  updateEventStatus(event.nyrrEventId, 'InProgress', 0, triggeredBy, '');

  try {
    // Get team runners from NYRR
    logDebug(`[ingestEvent.fetchRunners] --- FETCHING TEAM RUNNERS ---`);
    const allRunners = collectClubRunners(event);
    logDebug(`[ingestEvent.fetchRunners] Fetched ${allRunners.length} runners from team`);

    // Convert to NyrrResult rows
    logDebug(`[ingestEvent.eventDate] Event ${event.eventCode} has eventDate: "${event.eventDate}"`);
    const results: NyrrResult[] = allRunners.map((runner) => ({
      resultId: uid('NYRR-RES'),
      nyrrEventId: event.nyrrEventId,
      eventName: event.eventName,
      eventDate: event.eventDate,
      nyrrRunnerId: String(runner.runnerId),  // Convert numeric ID to string
      runnerName: `${runner.firstName} ${runner.lastName}`.trim(),
      age: runner.age,
      gender: runner.gender,
      state: runner.stateProvince,  // Map stateProvince to state
      finishTime: runner.overallTime,  // Map overallTime to finishTime
      pace: runner.pace,
      bibNumber: runner.bib,  // Map bib to bibNumber
      overallPlace: runner.overallPlace,
      genderPlace: runner.genderPlace,
      isMMRClub: true, // All runners come from our team roster
      mmrMemberId: '', // To be filled in Phase 2
      isRegisteredOnly: event.isUpcoming,
      scanTimestamp: nowIso(),
    }));

    logDebug(`[ingestEvent.write.start] Writing ${results.length} results to sheet...`);
    upsertNyrrResults(results);

    updateEventStatus(event.nyrrEventId, 'Completed', results.length, triggeredBy, '');

    appendProcessingLog({
      runTimestamp: nowIso(),
      triggeredBy,
      nyrrEventId: event.nyrrEventId,
      eventName: event.eventName,
      runStatus: 'Success',
      rowsWritten: results.length,
      errorDetails: '',
      verifiedBy: '',
      verifiedTimestamp: '',
      notes: '',
    });

    logDebug(`[ingestEvent.end] ✓ SUCCESS: ${results.length} rows written for ${event.eventCode}`);
    return { rowsWritten: results.length, error: '' };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    logDebug(`[ingestEvent.error] ✗ FAILED: ${msg}`);
    updateEventStatus(event.nyrrEventId, 'Error', 0, triggeredBy, msg);

    appendProcessingLog({
      runTimestamp: nowIso(),
      triggeredBy,
      nyrrEventId: event.nyrrEventId,
      eventName: event.eventName,
      runStatus: 'Failed',
      rowsWritten: 0,
      errorDetails: msg,
      verifiedBy: '',
      verifiedTimestamp: '',
      notes: '',
    });

    return { rowsWritten: 0, error: msg };
  }
}

// ---------------------------------------------------------------------------
// Scheduled entry points
// ---------------------------------------------------------------------------

/**
 * Weekly run: intelligently processes NYRR events.
 *
 * NEW WORKFLOW (optimized):
 * 1. Check if we have pending events already
 * 2. If YES → process them immediately (skip API fetch)
 * 3. If NO → fetch new events from API, add as Pending, then process
 * 4. Match results to MMR members
 *
 * This avoids wasteful API calls if we already have events to process.
 */
function processAllPendingNyrrEvents(): void {
  logDebug('========== WEEKLY PIPELINE START ==========');
  const config = getNyrrConfig();
  let totalRowsWritten = 0;

  try {
    // STEP 1: Check if we already have pending events
    logDebug('[step1.checkPending] Checking for existing pending events...');
    const pendingBefore = getPendingNyrrEvents();
    logDebug(`[step1.checkPending] Found ${pendingBefore.length} pending events`);

    // STEP 2: Decide whether to fetch new events
    let pending = pendingBefore.slice(0, config.NYRRBatchSize);

    if (pending.length === 0) {
      // NO pending events → fetch new ones from API
      logDebug('[step2.fetchNewEvents] No pending events. Fetching new events from API...');

      const existingEvents = getAllNyrrEvents();
      const existingEventCodes = new Set(existingEvents.map((e) => e.eventCode));
      logDebug(`[step2.loadExisting] Loaded ${existingEventCodes.size} existing events into memory`);

      logDebug('[step2.getAllEvents] Calling getAllEvents() from API...');
      const apiEvents: NyrrApiEvent[] = getAllEvents();
      logDebug(`[step2.getAllEvents] SUCCESS - found ${apiEvents.length} events from API`);

      let eventsCreated = 0;
      let eventsSkipped = 0;
      for (let i = 0; i < apiEvents.length; i++) {
        const apiEvent = apiEvents[i];

        // Fast in-memory check (no sheet read!)
        if (existingEventCodes.has(apiEvent.eventCode)) {
          eventsSkipped++;
          continue; // Already in sheet, skip
        }

        const eventDateStr = apiEvent.startDateTime.split('T')[0];
        const upcoming = isUpcomingEvent(eventDateStr);

        upsertNyrrEvent({
          nyrrEventId: `NYRR-EV-${apiEvent.eventCode}`,
          eventCode: apiEvent.eventCode,
          eventName: apiEvent.eventName,
          eventUrl: `https://results.nyrr.org/events/${apiEvent.eventCode}`,
          location: apiEvent.venue,
          distance: apiEvent.distanceUnitCode,
          eventDate: eventDateStr,
          eventYear: new Date(apiEvent.startDateTime).getFullYear(),
          isUpcoming: upcoming,
          processingStatus: 'Pending',
          processedTimestamp: '',
          processedBy: '',
          resultCount: 0,
          notes: '',
        });
        eventsCreated++;
        Utilities.sleep(500);
      }
      logDebug(`[step2.upsertNewEvents] Created ${eventsCreated} new events, skipped ${eventsSkipped} duplicates`);

      // Re-fetch pending events after adding new ones
      logDebug('[step2.refetchPending] Re-fetching pending events after API fetch...');
      pending = getPendingNyrrEvents().slice(0, config.NYRRBatchSize);
      logDebug(`[step2.refetchPending] Now have ${pending.length} pending events to process`);
    } else {
      // YES pending events → skip API fetch and go straight to processing
      logDebug(`[step2.skipFetch] ✓ Already have ${pending.length} pending events. Skipping API fetch.`);
    }

    // STEP 3: Process pending events (up to batch size)
    logDebug(`[step3.processEvents] Processing ${pending.length} pending events (batch size: ${config.NYRRBatchSize})...`);
    for (let i = 0; i < pending.length; i++) {
      const event = pending[i];
      logDebug(`[step3.ingestEvent] ${i + 1}/${pending.length}: ${event.eventCode} "${event.eventName}"`);
      const result = ingestEvent(event, 'System');
      totalRowsWritten += result.rowsWritten;
      logDebug(`  └─ ${result.rowsWritten} rows written${result.error ? ` | ERROR: ${result.error}` : ''}`);
      Utilities.sleep(config.NYRRSleepMs);
    }

    logDebug(`[step3.complete] Batch processing complete: ${totalRowsWritten} total rows written`);
    logDebug(`[step3.note] Member matching deferred to Phase 2 (will use runner details endpoint)`);

    clearExecutionState();
    logDebug(`========== WEEKLY PIPELINE SUCCESS - Processed ${pending.length} events, wrote ${totalRowsWritten} rows ==========`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logDebug(`========== WEEKLY PIPELINE FAILED ==========`);
    logDebug(`ERROR: ${error}`);
    saveExecutionState({
      timestamp: new Date().toISOString(),
      error: error,
      rowsProcessed: String(totalRowsWritten),
      status: 'interrupted - run setupTriggers() again to retry',
    });
    throw e;
  }
}

/**
 * BACKFILL FUNCTION: Processes ALL pending events in one run (no batch limit).
 * Use this to clear backlogs of pending events.
 * WARNING: May timeout if there are too many pending events (GAS limit: 6 minutes).
 * If it times out, break into smaller batches and run multiple times.
 *
 * Usage: Run from GAS console: backfillAllPendingEvents()
 */
function backfillAllPendingEvents(): void {
  logDebug('========== BACKFILL: PROCESSING ALL PENDING EVENTS ==========');
  let totalRowsWritten = 0;
  let totalEventsProcessed = 0;
  let totalEventsFailed = 0;

  try {
    // Get ALL pending events (no batch limit)
    logDebug('[backfill.getPending] Fetching ALL pending events...');
    const pending = getPendingNyrrEvents();
    logDebug(`[backfill.getPending] Found ${pending.length} pending events to process`);

    if (pending.length === 0) {
      logDebug('[backfill.noPending] ✓ No pending events to process');
      logDebug('========== BACKFILL: COMPLETE - No pending events ==========');
      return;
    }

    // Process ALL pending events
    const config = getNyrrConfig();
    logDebug(`[backfill.start] Processing ${pending.length} events...`);
    logDebug(`[backfill.note] Sleeping ${config.NYRRSleepMs}ms between requests`);

    for (let i = 0; i < pending.length; i++) {
      const event = pending[i];
      const progress = `${i + 1}/${pending.length}`;

      logDebug(`[backfill.event] ${progress}: ${event.eventCode} "${event.eventName}"`);

      try {
        const result = ingestEvent(event, 'Backfill');
        totalRowsWritten += result.rowsWritten;
        totalEventsProcessed++;
        logDebug(`  └─ ✓ ${result.rowsWritten} rows written`);
      } catch (e: unknown) {
        totalEventsFailed++;
        const error = e instanceof Error ? e.message : String(e);
        logDebug(`  └─ ✗ ERROR: ${error}`);
      }

      // Rate limit between requests
      Utilities.sleep(config.NYRRSleepMs);
    }

    clearExecutionState();
    logDebug(`[backfill.summary] Processed: ${totalEventsProcessed} events, ${totalRowsWritten} rows written, ${totalEventsFailed} failed`);
    logDebug(`========== BACKFILL: COMPLETE - ${totalEventsProcessed}/${pending.length} events processed ==========`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logDebug(`========== BACKFILL: FAILED ==========`);
    logDebug(`ERROR: ${error}`);
    saveExecutionState({
      timestamp: new Date().toISOString(),
      error: error,
      eventsProcessed: String(totalEventsProcessed),
      rowsWritten: String(totalRowsWritten),
      status: 'backfill interrupted - run backfillAllPendingEvents() again to retry',
    });
    throw e;
  }
}

/**
 * Daily run: re-scans upcoming events to capture new registrants.
 * Once an event's date has passed, promoteCompletedEvents() queues it for
 * full result ingestion.
 */
function refreshUpcomingNyrrEvents(): void {
  logDebug('========== DAILY REFRESH START ==========');
  try {
    const config = getNyrrConfig();
    logDebug('[getAllNyrrEvents] Fetching events...');
    const upcomingEvents = getAllNyrrEvents().filter((e) => e.isUpcoming);
    logDebug(`[refreshUpcomingNyrrEvents] Found ${upcomingEvents.length} upcoming events`);

    let rowsWritten = 0;
    for (let i = 0; i < upcomingEvents.length; i++) {
      const event = upcomingEvents[i];
      logDebug(`[ingestEvent] ${i + 1}/${upcomingEvents.length}: ${event.eventCode}`);
      const result = ingestEvent(event, 'System');
      rowsWritten += result.rowsWritten;
      Utilities.sleep(config.NYRRSleepMs);
    }

    logDebug(`========== DAILY REFRESH END - ${rowsWritten} rows written ==========`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logDebug(`========== DAILY REFRESH FAILED: ${error} ==========`);
    throw e;
  }
}

/**
 * Daily run: flips isUpcoming=false for events whose date has passed and
 * re-queues them as Pending so the next weekly run fetches real results.
 */
function promoteCompletedEvents(): void {
  logDebug('========== DAILY PROMOTION START ==========');
  try {
    logDebug('[getAllNyrrEvents] Fetching all events...');
    const events = getAllNyrrEvents().filter(
      (e) => e.isUpcoming && !isUpcomingEvent(e.eventDate)
    );
    logDebug(`[promoteCompletedEvents] Found ${events.length} completed events to promote`);

    for (let i = 0; i < events.length; i++) {
      const event = events[i];
      logDebug(`[upsertNyrrEvent] ${i + 1}/${events.length}: promoting ${event.eventCode}`);
      upsertNyrrEvent({
        ...event,
        isUpcoming: false,
        processingStatus: 'Pending',
        notes: 'Promoted from upcoming to completed — awaiting result ingestion.',
      });
    }

    logDebug(`========== DAILY PROMOTION END - ${events.length} events promoted ==========`);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    logDebug(`========== DAILY PROMOTION FAILED: ${error} ==========`);
    throw e;
  }
}

// ---------------------------------------------------------------------------
// Member matching
// ---------------------------------------------------------------------------

/**
 * Scans all NYRR-Results rows with a blank MMRMemberID and attempts to match
 * them to an MMR member profile via NYRRMemberID or name.
 *
 * Match priority:
 *   1. Exact NYRRMemberID match against Membership-Master.NYRRMemberID
 *   2. Normalized name match: NYRR RunnerName vs. MMR NYRRMemberName (if set)
 *   3. Normalized name match: NYRR RunnerName vs. MMR First+Last name
 */
function matchNyrrResultsToMembers(): void {
  logDebug('[matchNyrrResultsToMembers.start] Loading members with NYRR IDs...');
  const members = getMembersWithNyrrId(); // members who set their NYRR ID
  logDebug(`[matchNyrrResultsToMembers] Found ${members.length} members with NYRR IDs`);

  logDebug('[matchNyrrResultsToMembers] Loading all events...');
  const allEvents = getAllNyrrEvents();
  logDebug(`[matchNyrrResultsToMembers] Found ${allEvents.length} total events`);

  let totalMatches = 0;
  for (const event of allEvents) {
    logDebug(`[matchNyrrResultsToMembers.event] Matching event: ${event.eventCode}`);
    let eventMatches = 0;

    // We only care about results that haven't been matched yet
    // getResultsForMember() isn't the right call here — we need unmatched rows.
    // In production, add a getUnmatchedResults(eventId) helper.
    // For now, iterate members and try to match their NYRRMemberID.
    for (const member of members) {
      const matched = setMmrMemberIdOnResult(
        event.nyrrEventId,
        member.nyrrMemberId,
        member.memberId
      );
      if (matched) {
        eventMatches++;
        totalMatches++;
        logDebug(`  └─ Matched: ${member.firstName} ${member.lastName} (NYRR ID: ${member.nyrrMemberId})`);
      }
    }

    if (eventMatches === 0) {
      logDebug(`  └─ No matches for ${event.eventCode}`);
    }
  }

  logDebug(`[matchNyrrResultsToMembers.end] Total matches across all events: ${totalMatches}`);
}

/**
 * Triggered when a member saves a newly entered NYRRMemberID on their profile.
 * Back-fills MMRMemberID on any existing NYRR-Results rows for that runner.
 *
 * @param nyrrMemberId - the newly saved NYRR member ID
 * @param mmrMemberId  - the MMR MemberID (Axxxx) of that member
 */
function backfillMemberResults(
  nyrrMemberId: string,
  mmrMemberId: string
): void {
  const allEvents = getAllNyrrEvents();
  for (const event of allEvents) {
    setMmrMemberIdOnResult(event.nyrrEventId, nyrrMemberId, mmrMemberId);
  }
}


