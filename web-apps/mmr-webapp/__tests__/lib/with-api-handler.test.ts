/**
 * Tests for lib/api-handler.ts (withApiHandler)
 *
 * Verifies:
 *   - Successful responses pass through untouched
 *   - Thrown errors with err.status 400/401/403/404 map to that status
 *     with { ok: false, error: <message> }
 *   - Errors without a valid 4xx status (plain Error, string throw,
 *     5xx status) → 500 with a generic message (real error logged, not leaked)
 *   - Handler arguments (req, context params) are forwarded intact
 *   - Route-level: an unauthenticated photos route returns 401, not 500
 */

// ── Mock next/server (real module needs Edge runtime globals) ────────────────
jest.mock('next/server', () => ({
  NextResponse: {
    json: (body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      json: async () => body,
    }),
  },
  NextRequest: class {},
}))

import { withApiHandler } from '@/lib/api-handler'

// Minimal response shape produced by the NextResponse.json mock above
type MockRes = { status: number; json: () => Promise<any> }

const asRes = (r: unknown) => r as unknown as MockRes

function httpError(message: string, status?: unknown): Error {
  const err: any = new Error(message)
  if (status !== undefined) err.status = status
  return err
}

describe('withApiHandler', () => {
  let consoleErrorSpy: jest.SpyInstance

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
  })

  it('passes successful responses through untouched', async () => {
    const okResponse = { status: 200, json: async () => ({ ok: true, data: [1, 2] }) }
    const wrapped = withApiHandler(async () => okResponse as unknown as Response)

    const res = await wrapped()
    expect(res).toBe(okResponse)   // exact same object — no re-wrapping
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('forwards handler arguments (req + context params) intact', async () => {
    const seen: unknown[] = []
    const wrapped = withApiHandler(async (req: unknown, ctx: unknown) => {
      seen.push(req, ctx)
      return { status: 200, json: async () => ({ ok: true }) } as unknown as Response
    })

    const fakeReq = { nextUrl: { searchParams: new URLSearchParams() } }
    const fakeCtx = { params: { photoId: 'P123' } }
    await wrapped(fakeReq, fakeCtx)

    expect(seen[0]).toBe(fakeReq)
    expect(seen[1]).toBe(fakeCtx)
  })

  it.each([
    [400, 'Bad request'],
    [401, 'Unauthorized'],
    [403, 'Active membership required'],
    [404, 'Not found'],
  ])('maps thrown err.status %i to that HTTP status with the error message', async (status, message) => {
    const wrapped = withApiHandler(async () => {
      throw httpError(message, status)
    })

    const res = asRes(await wrapped())
    expect(res.status).toBe(status)
    await expect(res.json()).resolves.toEqual({ ok: false, error: message })
    expect(consoleErrorSpy).not.toHaveBeenCalled()
  })

  it('returns 500 with a generic message for a plain Error (no status)', async () => {
    const wrapped = withApiHandler(async () => {
      throw new Error('mysql connection refused at 10.0.0.5')
    })

    const res = asRes(await wrapped())
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body).toEqual({ ok: false, error: 'Internal server error' })
    // Real error must not leak to the client, but must be logged server-side
    expect(JSON.stringify(body)).not.toContain('mysql')
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
  })

  it('returns 500 for non-Error throws (string, null)', async () => {
    for (const thrown of ['boom', null]) {
      const wrapped = withApiHandler(async () => {
        throw thrown
      })
      const res = asRes(await wrapped())
      expect(res.status).toBe(500)
      await expect(res.json()).resolves.toEqual({ ok: false, error: 'Internal server error' })
    }
  })

  it('treats non-4xx or malformed status values as 500', async () => {
    for (const bad of [500, 502, 200, 302, '401', 401.5, NaN]) {
      const wrapped = withApiHandler(async () => {
        throw httpError('weird status', bad)
      })
      const res = asRes(await wrapped())
      expect(res.status).toBe(500)
    }
  })

  it('falls back to a generic message when a 4xx error has no message', async () => {
    const wrapped = withApiHandler(async () => {
      throw httpError('', 403)
    })
    const res = asRes(await wrapped())
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'Request failed' })
  })
})

// ── Route-level: unauthenticated photos route returns 401, not 500 ───────────

jest.mock('@/lib/auth/session', () => ({
  requireActiveMember: jest.fn(),
}))
jest.mock('@/lib/db/photos', () => ({
  getAllPhotoEvents: jest.fn(),
}))

import { requireActiveMember } from '@/lib/auth/session'
import { getAllPhotoEvents } from '@/lib/db/photos'
import { GET as albumsGET } from '@/app/api/photos/albums/route'

describe('GET /api/photos/albums (wrapped route)', () => {
  afterEach(() => jest.clearAllMocks())

  it('returns 401 (not 500) when there is no session', async () => {
    const err: any = new Error('Unauthorized')
    err.status = 401
    ;(requireActiveMember as jest.Mock).mockRejectedValue(err)

    const res = asRes(await albumsGET())
    expect(res.status).toBe(401)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'Unauthorized' })
    expect(getAllPhotoEvents).not.toHaveBeenCalled()
  })

  it('returns 403 when the member is not active', async () => {
    const err: any = new Error('Active membership required')
    err.status = 403
    ;(requireActiveMember as jest.Mock).mockRejectedValue(err)

    const res = asRes(await albumsGET())
    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ ok: false, error: 'Active membership required' })
  })

  it('still returns data for an active member', async () => {
    ;(requireActiveMember as jest.Mock).mockResolvedValue({ memberId: 'A0001', status: 'active' })
    ;(getAllPhotoEvents as jest.Mock).mockResolvedValue([{ eventId: 'E1' }])

    const res = asRes(await albumsGET())
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ ok: true, data: [{ eventId: 'E1' }] })
  })
})
