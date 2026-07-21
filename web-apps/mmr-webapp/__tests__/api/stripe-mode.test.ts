/**
 * Contract tests for GET /api/payments/stripe/mode — drives the member-facing
 * test-mode banner. Returns { testMode: isStripeTestMode() }.
 * Mocks @/lib/stripe at the module boundary (matches stripe-checkout.test.ts).
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

jest.mock('@/lib/stripe', () => ({ isStripeTestMode: jest.fn() }))

import { GET } from '@/app/api/payments/stripe/mode/route'
import { isStripeTestMode } from '@/lib/stripe'

type Res = { status: number; body: any }
const get = GET as unknown as () => Promise<Res>

beforeEach(() => {
  jest.clearAllMocks()
})

describe('GET /api/payments/stripe/mode', () => {
  it('returns { testMode: true } when Stripe is in test mode', async () => {
    ;(isStripeTestMode as jest.Mock).mockReturnValue(true)
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ testMode: true })
  })

  it('returns { testMode: false } when a live key is configured', async () => {
    ;(isStripeTestMode as jest.Mock).mockReturnValue(false)
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ testMode: false })
  })
})
