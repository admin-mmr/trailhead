/**
 * Contract tests for GET /api/hof/series — public race-series listing.
 * No auth. Reads default `db` export from @/lib/db/connection.
 */

jest.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: {
    json: jest.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    })),
  },
}))

jest.mock('@/lib/db/connection', () => ({
  __esModule: true,
  default: { execute: jest.fn() },
  pool: {},
  getDb: jest.fn(),
}))

import { GET } from '@/app/api/hof/series/route'
import db from '@/lib/db/connection'

type Res = { status: number; body: any }
const get = GET as unknown as () => Promise<Res>
const execute = (db as any).execute as jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
})

describe('GET /api/hof/series', () => {
  it('200 with the series list (public, no auth)', async () => {
    const rows = [{ id: 1, name: 'Fifth Avenue Mile', slug: 'fifth-ave-mile', event_count: 3 }]
    execute.mockResolvedValue([rows, []])
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, series: rows })
  })

  it('queries nyrr_event_series', async () => {
    execute.mockResolvedValue([[], []])
    await get()
    expect(execute.mock.calls[0][0]).toMatch(/FROM nyrr_event_series/)
  })

  it('200 with an empty list when there are no series', async () => {
    execute.mockResolvedValue([[], []])
    const res = await get()
    expect(res.body).toEqual({ ok: true, series: [] })
  })

  it('500 on DB error', async () => {
    execute.mockRejectedValue(new Error('db down'))
    const res = await get()
    expect(res.status).toBe(500)
    expect(res.body.ok).toBe(false)
  })
})
