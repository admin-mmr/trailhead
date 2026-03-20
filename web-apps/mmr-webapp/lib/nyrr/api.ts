/**
 * NYRR API client — migrated from Google Apps Script (UrlFetchApp → fetch)
 * Endpoint: https://rmsprodapi.nyrr.org/api/v2
 */

const BASE_URL = 'https://rmsprodapi.nyrr.org/api/v2'
const PAGE_SIZE = 100
const DELAY_MS  = 500 // Rate-limit buffer (was Utilities.sleep)

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

async function nyrrPost<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`NYRR API error ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

// ─── Event search ────────────────────────────────────────────
export async function getAllEvents(year?: number) {
  const results: any[] = []
  let page = 1

  while (true) {
    const data = await nyrrPost<any>('/events/search', {
      year:     year ?? new Date().getFullYear(),
      pageNum:  page,
      pageSize: PAGE_SIZE,
    })
    const events = data?.items ?? []
    results.push(...events)
    if (events.length < PAGE_SIZE) break
    page++
    await sleep(DELAY_MS)
  }
  return results
}

// ─── Team runners (MMR club team) ────────────────────────────
export async function getTeamRunners(eventCode: string, teamCode = 'MMR') {
  const runners: any[] = []
  let page = 1

  while (true) {
    const data = await nyrrPost<any>('/teams/teamRunners', {
      eventCode, teamCode, pageNum: page, pageSize: PAGE_SIZE,
    })
    const items = data?.items ?? []
    runners.push(...items)
    if (items.length < PAGE_SIZE) break
    page++
    await sleep(DELAY_MS)
  }
  return runners
}

// ─── Event finishers ─────────────────────────────────────────
export async function getEventFinishers(eventCode: string) {
  const finishers: any[] = []
  let page = 1

  while (true) {
    const data = await nyrrPost<any>('/runners/finishers-filter', {
      eventCode, pageNum: page, pageSize: PAGE_SIZE,
    })
    const items = data?.items ?? []
    finishers.push(...items)
    if (items.length < PAGE_SIZE) break
    page++
    await sleep(DELAY_MS)
  }
  return finishers
}

// ─── Runner results (by NYRR runner ID) ──────────────────────
export async function getRunnerResults(nyrrRunnerId: string) {
  const results: any[] = []
  let page = 1

  while (true) {
    const data = await nyrrPost<any>('/runners/races', {
      runnerId: nyrrRunnerId, pageNum: page, pageSize: PAGE_SIZE,
    })
    const items = data?.items ?? []
    results.push(...items)
    if (items.length < PAGE_SIZE) break
    page++
    await sleep(DELAY_MS)
  }
  return results
}

// ─── Runner profile ───────────────────────────────────────────
export async function getRunnerDetails(nyrrRunnerId: string) {
  return nyrrPost<any>('/runners/details', { runnerId: nyrrRunnerId })
}

// ─── Event participants with bib numbers ──────────────────────
// Returns all runners for an event with their bib numbers.
// Used by the nightly bib-assignment sync to populate member_bib_assignments.
//
// Strategy: use getTeamRunners for MMR members first (smaller, faster),
// then getEventFinishers for any remaining unmatched bibs.
//
// Each item returned has: { runnerId, bibNumber, firstName, lastName, teamCode }

export interface NyrrParticipant {
  runnerId:   string
  bibNumber:  string
  firstName:  string
  lastName:   string
  teamCode?:  string
}

export async function getMMRParticipants(eventCode: string): Promise<NyrrParticipant[]> {
  const runners = await getTeamRunners(eventCode, 'MMR')
  return runners.map((r: any) => ({
    runnerId:  String(r.runnerId  ?? r.RunnerId  ?? ''),
    bibNumber: String(r.bibNumber ?? r.BibNumber ?? ''),
    firstName: String(r.firstName ?? r.FirstName ?? ''),
    lastName:  String(r.lastName  ?? r.LastName  ?? ''),
    teamCode:  'MMR',
  })).filter((r: NyrrParticipant) => r.bibNumber)
}

export async function getAllParticipantsWithBibs(eventCode: string): Promise<NyrrParticipant[]> {
  const finishers = await getEventFinishers(eventCode)
  return finishers.map((r: any) => ({
    runnerId:  String(r.runnerId  ?? r.RunnerId  ?? ''),
    bibNumber: String(r.bibNumber ?? r.BibNumber ?? ''),
    firstName: String(r.firstName ?? r.FirstName ?? ''),
    lastName:  String(r.lastName  ?? r.LastName  ?? ''),
    teamCode:  String(r.teamCode  ?? r.TeamCode  ?? ''),
  })).filter((r: NyrrParticipant) => r.bibNumber)
}
