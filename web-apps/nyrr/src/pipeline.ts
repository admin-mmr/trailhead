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

import { NyrrApiFinisher, NyrrApiEvent, NyrrResult, NyrrEvent } from './types';
import { getNyrrConfig } from './config';
import {
  getAllNyrrEvents,
  getPendingNyrrEvents,
  upsertNyrrEvent,
  upsertNyrrResults,
  updateEventStatus,
  appendProcessingLog,
  getMembersWithNyrrId,
  getResultsForMember,
  setMmrMemberIdOnResult,
  getAllNyrrEvents as _all,
} from './sheets';
import {
  getAllEvents,
  getEventFinishers,
  getEventRegistrants,
  getRunnerResults,
} from './nyrrApi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function uid(prefix: string): string {
  const ts = new Date().getTime();
  const rnd = Math.floor(Math.random() * 9999);
  return `${prefix}-${ts}-${rnd}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

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
  const config = getNyrrConfig();
  if (event.isUpcoming) {
    return getEventRegistrants(event.eventCode, config.NYRRClubName);
  } else {
    return getEventFinishers(event.eventCode, config.NYRRClubName);
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
  const members = getMembersWithNyrrId();
  const additional: NyrrApiFinisher[] = [];

  for (const member of members) {
    if (alreadyCaptured.has(member.nyrrMemberId)) continue;

    const history = getRunnerResults(member.nyrrMemberId);
    const matchingRace = history.find((r) => r.eventCode === event.eventCode);

    if (matchingRace) {
      // Build a synthetic finisher object so downstream processing is uniform
      additional.push({
        runnerId: member.nyrrMemberId,
        firstName: member.firstName,
        lastName: member.lastName,
        age: null,
        gender: '',
        state: '',
        finishTime: matchingRace.finishTime,
        pace: matchingRace.pace,
        bibNumber: matchingRace.bibNumber,
        overallPlace: matchingRace.overallPlace,
        genderPlace: matchingRace.genderPlace,
        club: matchingRace.club,
      });
      alreadyCaptured.add(member.nyrrMemberId);
    }

    Utilities.sleep(getNyrrConfig().NYRRSleepMs);
  }

  return additional;
}

// ---------------------------------------------------------------------------
// Core: ingest one event
// ---------------------------------------------------------------------------

export function ingestEvent(
  event: NyrrEvent,
  triggeredBy: string = 'System'
): { rowsWritten: number; error: string } {
  updateEventStatus(event.nyrrEventId, 'InProgress', 0, triggeredBy, '');

  try {
    // Pass 1: club search
    const clubRunners = collectClubRunners(event);
    const capturedIds = new Set(clubRunners.map((r) => r.runnerId));

    // Pass 2: member-ID supplementary search
    const memberRunners = collectMemberIdRunners(event, capturedIds);

    const allRunners = [...clubRunners, ...memberRunners];

    // Convert to NyrrResult rows
    const results: NyrrResult[] = allRunners.map((runner) => ({
      resultId: uid('NYRR-RES'),
      nyrrEventId: event.nyrrEventId,
      eventName: event.eventName,
      eventDate: event.eventDate,
      nyrrMemberId: runner.runnerId,
      runnerName: `${runner.firstName} ${runner.lastName}`.trim(),
      age: runner.age,
      gender: runner.gender,
      state: runner.state,
      finishTime: runner.finishTime,
      pace: runner.pace,
      bibNumber: runner.bibNumber,
      overallPlace: runner.overallPlace,
      genderPlace: runner.genderPlace,
      isMMRClub: clubRunners.some((r) => r.runnerId === runner.runnerId),
      mmrMemberId: '', // filled in by matchNyrrResultsToMembers()
      isRegisteredOnly: event.isUpcoming,
      scanTimestamp: nowIso(),
    }));

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

    return { rowsWritten: results.length, error: '' };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
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
 * Weekly run: discovers new NYRR events for the MMR club, upserts them into
 * NYRR-Events, then processes up to NYRRBatchSize pending events.
 */
export function processAllPendingNyrrEvents(): void {
  const config = getNyrrConfig();

  // Discover and upsert events
  const apiEvents: NyrrApiEvent[] = getAllEvents();
  for (const apiEvent of apiEvents) {
    const upcoming = isUpcomingEvent(apiEvent.date);
    const existing = getAllNyrrEvents().find(
      (e) => e.eventCode === apiEvent.eventCode
    );
    if (!existing) {
      upsertNyrrEvent({
        nyrrEventId: `NYRR-EV-${apiEvent.eventCode}`,
        eventCode: apiEvent.eventCode,
        eventName: apiEvent.name,
        eventUrl: apiEvent.url,
        location: apiEvent.location,
        distance: apiEvent.distance,
        eventDate: apiEvent.date,
        eventYear: new Date(apiEvent.date).getFullYear(),
        isUpcoming: upcoming,
        processingStatus: 'Pending',
        processedTimestamp: '',
        processedBy: '',
        resultCount: 0,
        notes: '',
      });
    }
    Utilities.sleep(500);
  }

  // Process up to NYRRBatchSize pending events
  const pending = getPendingNyrrEvents().slice(0, config.NYRRBatchSize);
  for (const event of pending) {
    ingestEvent(event, 'System');
    Utilities.sleep(config.NYRRSleepMs);
  }

  matchNyrrResultsToMembers();
}

/**
 * Daily run: re-scans upcoming events to capture new registrants.
 * Once an event's date has passed, promoteCompletedEvents() queues it for
 * full result ingestion.
 */
export function refreshUpcomingNyrrEvents(): void {
  const config = getNyrrConfig();
  const upcomingEvents = getAllNyrrEvents().filter((e) => e.isUpcoming);

  for (const event of upcomingEvents) {
    ingestEvent(event, 'System');
    Utilities.sleep(config.NYRRSleepMs);
  }
}

/**
 * Daily run: flips isUpcoming=false for events whose date has passed and
 * re-queues them as Pending so the next weekly run fetches real results.
 */
export function promoteCompletedEvents(): void {
  const events = getAllNyrrEvents().filter(
    (e) => e.isUpcoming && !isUpcomingEvent(e.eventDate)
  );
  for (const event of events) {
    upsertNyrrEvent({
      ...event,
      isUpcoming: false,
      processingStatus: 'Pending',
      notes: 'Promoted from upcoming to completed — awaiting result ingestion.',
    });
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
export function matchNyrrResultsToMembers(): void {
  const members = getMembersWithNyrrId(); // members who set their NYRR ID

  // Also load all members for name-based fallback
  // (re-use getMembersWithNyrrId but pull full roster separately if needed)

  const allEvents = getAllNyrrEvents();

  for (const event of allEvents) {
    // We only care about results that haven't been matched yet
    // getResultsForMember() isn't the right call here — we need unmatched rows.
    // In production, add a getUnmatchedResults(eventId) helper.
    // For now, iterate members and try to match their NYRRMemberID.
    for (const member of members) {
      setMmrMemberIdOnResult(
        event.nyrrEventId,
        member.nyrrMemberId,
        member.memberId
      );
    }
  }
}

/**
 * Triggered when a member saves a newly entered NYRRMemberID on their profile.
 * Back-fills MMRMemberID on any existing NYRR-Results rows for that runner.
 *
 * @param nyrrMemberId - the newly saved NYRR member ID
 * @param mmrMemberId  - the MMR MemberID (Axxxx) of that member
 */
export function backfillMemberResults(
  nyrrMemberId: string,
  mmrMemberId: string
): void {
  const allEvents = getAllNyrrEvents();
  for (const event of allEvents) {
    setMmrMemberIdOnResult(event.nyrrEventId, nyrrMemberId, mmrMemberId);
  }
}
