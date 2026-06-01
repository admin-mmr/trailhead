/**
 * Tests for lib/nyrr/api.ts
 *
 * Mocks global.fetch to verify:
 *   - Correct POST body shape sent to NYRR API
 *   - Pagination: multiple pages fetched until page < PAGE_SIZE
 *   - Single-page: stops after one request
 *   - Error: non-ok response throws
 *   - Bib-filter helpers (getMMRParticipants, getAllParticipantsWithBibs)
 */

import {
  getAllEvents,
  getTeamRunners,
  getEventFinishers,
  getRunnerResults,
  getRunnerDetails,
  getMMRParticipants,
  getAllParticipantsWithBibs,
} from '@/lib/nyrr/api'

// Speed up tests — the real sleep(500) would make the suite very slow.
// We replace the module-internal sleep by mocking the entire timer.
jest.useFakeTimers()

// ── fetch helper ──────────────────────────────────────────────────────────────

type PageFactory = (call: number) => object

function mockFetchPages(pageFactory: PageFactory) {
  let call = 0
  global.fetch = jest.fn().mockImplementation(() => {
    const payload = pageFactory(call++)
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(payload),
    })
  })
}

function mockFetchError(status = 500) {
  global.fetch = jest.fn().mockResolvedValue({ ok: false, status })
}

// Helper to advance timers and flush promises in alternation
async function runAllTimers() {
  // Drain promise queue, then advance timers, repeat
  await Promise.resolve()
  jest.runAllTimers()
  await Promise.resolve()
}

beforeEach(() => jest.clearAllMocks())

// ── getAllEvents ──────────────────────────────────────────────────────────────

describe('getAllEvents', () => {
  it('returns all items from a single page', async () => {
    mockFetchPages(() => ({ items: [{ eventCode: 'E1' }, { eventCode: 'E2' }] }))
    const p = getAllEvents(2025)
    await runAllTimers()
    const events = await p
    expect(events).toHaveLength(2)
    expect(events[0].eventCode).toBe('E1')
  })

  it('sends correct body with provided year', async () => {
    mockFetchPages(() => ({ items: [] }))
    const p = getAllEvents(2024)
    await runAllTimers()
    await p
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).toMatchObject({ year: 2024, pageNum: 1, pageSize: 100 })
  })

  it('defaults year to current year when not provided', async () => {
    mockFetchPages(() => ({ items: [] }))
    const p = getAllEvents()
    await runAllTimers()
    await p
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.year).toBe(new Date().getFullYear())
  })

  it('paginates: fetches pages until page has fewer than 100 items', async () => {
    // page 1: 100 items, page 2: 50 items → 2 fetches
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ eventCode: `E${i}` }))
    const halfPage = Array.from({ length: 50 },  (_, i) => ({ eventCode: `E${100 + i}` }))
    mockFetchPages(call => call === 0 ? { items: fullPage } : { items: halfPage })

    const p = getAllEvents(2025)
    // Need to tick timers twice (one sleep between page 1 and 2)
    await runAllTimers()
    await runAllTimers()
    const events = await p

    expect(events).toHaveLength(150)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('sends pageNum=2 on second request', async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({ eventCode: `E${i}` }))
    mockFetchPages(call => call === 0 ? { items: fullPage } : { items: [] })

    const p = getAllEvents(2025)
    await runAllTimers()
    await runAllTimers()
    await p

    const body2 = JSON.parse((global.fetch as jest.Mock).mock.calls[1][1].body)
    expect(body2.pageNum).toBe(2)
  })

  it('handles null items gracefully (treats as empty)', async () => {
    mockFetchPages(() => ({ items: null }))
    const p = getAllEvents(2025)
    await runAllTimers()
    const events = await p
    expect(events).toHaveLength(0)
  })

  it('throws on non-ok response', async () => {
    mockFetchError(503)
    await expect(getAllEvents(2025)).rejects.toThrow('NYRR API error 503')
  })
})

// ── getTeamRunners ────────────────────────────────────────────────────────────

describe('getTeamRunners', () => {
  it('sends correct body with eventCode and teamCode', async () => {
    mockFetchPages(() => ({ items: [] }))
    const p = getTeamRunners('26WASH', 'MMR')
    await runAllTimers()
    await p
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body).toMatchObject({ eventCode: '26WASH', teamCode: 'MMR', pageNum: 1 })
  })

  it('defaults teamCode to MMR', async () => {
    mockFetchPages(() => ({ items: [] }))
    const p = getTeamRunners('26WASH')
    await runAllTimers()
    await p
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.teamCode).toBe('MMR')
  })

  it('returns all runners across pages', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ runnerId: i }))
    const last = [{ runnerId: 100 }]
    mockFetchPages(call => call === 0 ? { items: full } : { items: last })

    const p = getTeamRunners('26WASH')
    await runAllTimers()
    await runAllTimers()
    const runners = await p

    expect(runners).toHaveLength(101)
  })

  it('throws on non-ok response', async () => {
    mockFetchError()
    await expect(getTeamRunners('26WASH')).rejects.toThrow('NYRR API error')
  })
})

// ── getEventFinishers ─────────────────────────────────────────────────────────

describe('getEventFinishers', () => {
  it('sends correct path and eventCode', async () => {
    mockFetchPages(() => ({ items: [] }))
    const p = getEventFinishers('26FRED')
    await runAllTimers()
    await p
    const [url, opts] = (global.fetch as jest.Mock).mock.calls[0]
    expect(url).toContain('/runners/finishers-filter')
    const body = JSON.parse(opts.body)
    expect(body.eventCode).toBe('26FRED')
  })

  it('concatenates items across two pages', async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ runnerId: i }))
    const last = Array.from({ length: 3 },   (_, i) => ({ runnerId: 100 + i }))
    mockFetchPages(call => call === 0 ? { items: full } : { items: last })

    const p = getEventFinishers('26FRED')
    await runAllTimers()
    await runAllTimers()
    expect(await p).toHaveLength(103)
  })
})

// ── getRunnerResults ──────────────────────────────────────────────────────────

describe('getRunnerResults', () => {
  it('sends correct runnerId', async () => {
    mockFetchPages(() => ({ items: [] }))
    const p = getRunnerResults('R999')
    await runAllTimers()
    await p
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.runnerId).toBe('R999')
  })

  it('returns empty array when no results', async () => {
    mockFetchPages(() => ({ items: [] }))
    const p = getRunnerResults('R999')
    await runAllTimers()
    expect(await p).toEqual([])
  })
})

// ── getRunnerDetails ──────────────────────────────────────────────────────────

describe('getRunnerDetails', () => {
  it('sends runnerId and returns parsed JSON', async () => {
    const profile = { runnerId: 'R42', name: 'Jane Doe' }
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve(profile) })
    const result = await getRunnerDetails('R42')
    expect(result).toEqual(profile)
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body)
    expect(body.runnerId).toBe('R42')
  })

  it('throws on error', async () => {
    mockFetchError(404)
    await expect(getRunnerDetails('R42')).rejects.toThrow()
  })
})

// ── getMMRParticipants ────────────────────────────────────────────────────────

describe('getMMRParticipants', () => {
  it('maps runnerId/bibNumber/name fields and filters out rows with no bib', async () => {
    mockFetchPages(() => ({
      items: [
        { runnerId: '1', bibNumber: 'B001', firstName: 'Jane', lastName: 'Doe' },
        { runnerId: '2', bibNumber: '',     firstName: 'No',   lastName: 'Bib' },  // no bib → filtered
        { RunnerId: '3', BibNumber: 'B003', FirstName: 'Alt',  LastName: 'Case' }, // PascalCase keys
      ],
    }))
    const p = getMMRParticipants('26WASH')
    await runAllTimers()
    const result = await p

    expect(result).toHaveLength(2)
    expect(result[0]).toMatchObject({ runnerId: '1', bibNumber: 'B001', firstName: 'Jane', lastName: 'Doe', teamCode: 'MMR' })
    expect(result[1]).toMatchObject({ runnerId: '3', bibNumber: 'B003', firstName: 'Alt', lastName: 'Case' })
  })

  it('returns empty array when no MMR runners', async () => {
    mockFetchPages(() => ({ items: [] }))
    const p = getMMRParticipants('26WASH')
    await runAllTimers()
    expect(await p).toEqual([])
  })
})

// ── getAllParticipantsWithBibs ─────────────────────────────────────────────────

describe('getAllParticipantsWithBibs', () => {
  it('maps finisher rows and filters out those with no bibNumber', async () => {
    mockFetchPages(() => ({
      items: [
        { runnerId: '10', bibNumber: 'B010', firstName: 'A', lastName: 'B', teamCode: 'MMR' },
        { runnerId: '11', bibNumber: '0',    firstName: 'C', lastName: 'D', teamCode: 'XYZ' }, // '0' → falsy after filter? no — '0' is truthy string
        { runnerId: '12', bibNumber: '',     firstName: 'E', lastName: 'F' },  // empty → filtered
      ],
    }))
    const p = getAllParticipantsWithBibs('26FRED')
    await runAllTimers()
    const result = await p

    // '0' is a valid (truthy) bib string; '' is filtered
    expect(result).toHaveLength(2)
    expect(result[0].bibNumber).toBe('B010')
    expect(result[1].bibNumber).toBe('0')
  })
})
