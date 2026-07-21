/**
 * Contract tests for GET /api/hof/series/[slug] — public 8-category HOF.
 * No auth. First query looks up the series by slug (404 if missing), then
 * runs one category query per CATEGORY (8). params is a plain object.
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

import { GET } from '@/app/api/hof/series/[slug]/route'
import db from '@/lib/db/connection'

type Res = { status: number; body: any }
const get = GET as unknown as (req: unknown, ctx: { params: { slug: string } }) => Promise<Res>
const execute = (db as any).execute as jest.Mock

const ctx = (slug: string) => ({ params: { slug } })
const req = {} as any

beforeEach(() => {
  jest.clearAllMocks()
})

describe('GET /api/hof/series/[slug]', () => {
  it('404 when the slug matches no series', async () => {
    execute.mockResolvedValue([[], []])
    const res = await get(req, ctx('nope'))
    expect(res.status).toBe(404)
    expect(res.body.ok).toBe(false)
  })

  it('looks up the series by slug', async () => {
    execute.mockResolvedValue([[], []])
    await get(req, ctx('fifth-ave-mile'))
    const seriesCall = execute.mock.calls[0]
    expect(seriesCall[0]).toMatch(/FROM nyrr_event_series/)
    expect(seriesCall[1]).toEqual(['fifth-ave-mile'])
  })

  it('200 with 8 categories when the series exists', async () => {
    const series = { id: 7, name: 'Fifth Avenue Mile', slug: 'fifth-ave-mile' }
    // First call = series lookup; all subsequent (category) calls = empty podiums.
    execute.mockResolvedValueOnce([[series], []]).mockResolvedValue([[], []])
    const res = await get(req, ctx('fifth-ave-mile'))
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.series).toEqual(series)
    expect(res.body.categories).toHaveLength(8)
    expect(res.body.categories[0]).toMatchObject({ key: 'men_open', podium: [], best: null })
  })

  it('maps podium rows and sets best to the top finisher', async () => {
    const series = { id: 7, name: 'X', slug: 's' }
    const podiumRow = {
      runner_name: 'Ada L',
      gender: 'M',
      age: 42,
      mmr_member_id: 'MMR-2026-0001',
      best_time: '00:05:12',
      event_name: 'Fifth Ave Mile 2025',
      event_year: 2025,
    }
    execute
      .mockResolvedValueOnce([[series], []]) // series lookup
      .mockResolvedValueOnce([[podiumRow], []]) // men_open category
      .mockResolvedValue([[], []]) // remaining 7 categories
    const res = await get(req, ctx('s'))
    expect(res.body.categories[0].best).toMatchObject({
      runner_name: 'Ada L',
      mmr_member_id: 'MMR-2026-0001',
      finish_time: '00:05:12',
      event_year: 2025,
    })
  })

  it('500 on DB error', async () => {
    execute.mockRejectedValue(new Error('db down'))
    expect((await get(req, ctx('s'))).status).toBe(500)
  })
})
