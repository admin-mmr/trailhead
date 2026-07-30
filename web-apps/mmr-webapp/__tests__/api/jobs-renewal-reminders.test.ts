/**
 * Contract tests for POST /api/jobs/renewal-reminders and the JOB_SECRET gate.
 *
 * This is a route with no session that can email hundreds of members, so the
 * auth behaviour is the headline: a missing secret must DENY (fail closed), a
 * wrong token must 401, and the comparison must not depend on token length.
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
jest.mock('@/lib/notifications/renewal-reminders', () => ({
  runRenewalReminders: jest.fn(),
}))

import { POST } from '@/app/api/jobs/renewal-reminders/route'
import { runRenewalReminders } from '@/lib/notifications/renewal-reminders'
import { authorizeJobRequest } from '@/lib/jobs/auth'

const mockRun = runRenewalReminders as jest.Mock
type Res = { status: number; body: any }
const post = POST as unknown as (req: unknown) => Promise<Res>

const SECRET = 'test-secret-value-do-not-use'

/** Minimal stand-in for NextRequest: headers + json(). */
function request(opts: { token?: string | null; body?: unknown; raw?: string } = {}) {
  const headers = new Map<string, string>()
  if (opts.token !== null && opts.token !== undefined) {
    headers.set('authorization', `Bearer ${opts.token}`)
  }
  return {
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    json: async () => {
      if (opts.raw !== undefined) return JSON.parse(opts.raw)
      if (opts.body === undefined) throw new Error('no body')
      return opts.body
    },
  }
}

const RESULT = {
  ranAt: '2027-03-01', enabled: true, dryRun: false,
  considered: 3, sent: 3, skipped: 0, failed: 0,
  cappedAt: null, byStage: { T30: 3 }, errors: [],
}

beforeEach(() => {
  jest.clearAllMocks()
  process.env.JOB_SECRET = SECRET
  mockRun.mockResolvedValue(RESULT)
})

afterAll(() => { delete process.env.JOB_SECRET })

describe('authorization', () => {
  it('runs the job with a valid bearer token', async () => {
    const res = await post(request({ token: SECRET }))

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: RESULT })
    expect(mockRun).toHaveBeenCalledTimes(1)
  })

  it('401s a wrong token and sends nothing', async () => {
    const res = await post(request({ token: 'wrong-but-same-length-xxxxxxxx' }))

    expect(res.status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('401s a token of a different length (no length oracle, no crash)', async () => {
    const res = await post(request({ token: 'x' }))

    expect(res.status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('401s a missing Authorization header', async () => {
    const res = await post(request({ token: null }))

    expect(res.status).toBe(401)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('FAILS CLOSED when JOB_SECRET is not configured', async () => {
    delete process.env.JOB_SECRET

    const res = await post(request({ token: 'anything' }))

    // 503, not 401: the deployment is misconfigured, not the caller.
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/JOB_SECRET/)
    expect(mockRun).not.toHaveBeenCalled()
  })

  it('rejects a non-Bearer scheme', async () => {
    const req = {
      headers: { get: () => `Basic ${SECRET}` },
      json: async () => ({}),
    }
    expect(authorizeJobRequest(req as unknown as Request)).toMatchObject({ status: 401 })
  })

  it('accepts a lowercase "bearer" prefix — curl and CI clients vary', async () => {
    const req = {
      headers: { get: () => `bearer ${SECRET}` },
      json: async () => ({}),
    }
    expect(authorizeJobRequest(req as unknown as Request)).toEqual({ ok: true })
  })
})

describe('options parsing', () => {
  it('treats an absent body as a normal run — the cron posts none', async () => {
    const res = await post(request({ token: SECRET }))

    expect(res.status).toBe(200)
    expect(mockRun).toHaveBeenCalledWith({})
  })

  it('honours dryRun and a positive integer limit', async () => {
    await post(request({ token: SECRET, body: { dryRun: true, limit: 5 } }))
    expect(mockRun).toHaveBeenCalledWith({ dryRun: true, limit: 5 })
  })

  it('ignores junk rather than failing the run', async () => {
    await post(request({
      token: SECRET,
      body: { dryRun: 'yes', limit: -3, nonsense: true },
    }))
    // 'yes' is not true, and a negative limit is not a limit.
    expect(mockRun).toHaveBeenCalledWith({})
  })

  it('floors a fractional limit', async () => {
    await post(request({ token: SECRET, body: { limit: 7.9 } }))
    expect(mockRun).toHaveBeenCalledWith({ limit: 7 })
  })
})

describe('failures', () => {
  it('500s with a message when the run throws', async () => {
    mockRun.mockRejectedValue(new Error('DB unreachable'))

    const res = await post(request({ token: SECRET }))

    expect(res.status).toBe(500)
    expect(res.body).toEqual({ ok: false, error: 'DB unreachable' })
  })

  it('reports a run where every send failed as 200 with counts', async () => {
    // The HTTP call succeeded; the workflow inspects `failed` and warns.
    mockRun.mockResolvedValue({ ...RESULT, sent: 0, failed: 3, errors: ['A1: x'] })

    const res = await post(request({ token: SECRET }))

    expect(res.status).toBe(200)
    expect(res.body.data.failed).toBe(3)
  })
})
