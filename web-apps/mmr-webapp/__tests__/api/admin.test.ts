/**
 * Contract tests for /api/admin (GET, POST, DELETE) — admin management.
 * Guard model: requireActiveMember() then isAdmin(session.email).
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

jest.mock('@/lib/auth/session', () => ({
  requireActiveMember: jest.fn(),
  getSession: jest.fn(),
  requireSession: jest.fn(),
}))

jest.mock('@/lib/db/admins', () => ({
  SUPER_ADMIN_EMAIL: 'admin@mmrunners.org',
  isAdmin: jest.fn(),
  listAdmins: jest.fn(),
  addAdmin: jest.fn(),
  removeAdmin: jest.fn(),
}))

jest.mock('@/lib/email/client', () => ({ sendEmail: jest.fn().mockResolvedValue(undefined) }))

import { GET, POST, DELETE } from '@/app/api/admin/route'
import { requireActiveMember } from '@/lib/auth/session'
import { isAdmin, listAdmins, addAdmin, removeAdmin } from '@/lib/db/admins'

type Res = { status: number; body: any }
const get = GET as unknown as () => Promise<Res>
const post = POST as unknown as (req: unknown) => Promise<Res>
const del = DELETE as unknown as (req: unknown) => Promise<Res>

const makeReq = (body: unknown) => ({ json: async () => body } as any)
const member = { memberId: 'MMR-2026-0001', email: 'a@b.com', firstName: 'Ada', lastName: 'L', status: 'active' }

const unauth = () => Object.assign(new Error('Unauthorized'), { status: 401 })
const inactive = () => Object.assign(new Error('Active membership required'), { status: 403 })

beforeEach(() => {
  jest.clearAllMocks()
  ;(requireActiveMember as jest.Mock).mockResolvedValue(member)
  ;(isAdmin as jest.Mock).mockResolvedValue(true)
  ;(listAdmins as jest.Mock).mockResolvedValue([{ email: 'a@b.com' }])
})

describe('GET /api/admin', () => {
  it('401 when no session', async () => {
    ;(requireActiveMember as jest.Mock).mockRejectedValue(unauth())
    expect((await get()).status).toBe(401)
  })

  it('403 when session is inactive', async () => {
    ;(requireActiveMember as jest.Mock).mockRejectedValue(inactive())
    expect((await get()).status).toBe(403)
  })

  it('403 when caller is not an admin', async () => {
    ;(isAdmin as jest.Mock).mockResolvedValue(false)
    const res = await get()
    expect(res.status).toBe(403)
    expect(res.body.error).toBe('Forbidden')
  })

  it('200 lists admins for an admin caller', async () => {
    const res = await get()
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ ok: true, data: [{ email: 'a@b.com' }] })
    expect(isAdmin).toHaveBeenCalledWith('a@b.com')
  })

  it('500 on unexpected error', async () => {
    ;(listAdmins as jest.Mock).mockRejectedValue(new Error('db down'))
    expect((await get()).status).toBe(500)
  })
})

describe('POST /api/admin', () => {
  it('403 when caller is not an admin', async () => {
    ;(isAdmin as jest.Mock).mockResolvedValue(false)
    expect((await post(makeReq({ email: 'new@b.com' }))).status).toBe(403)
  })

  it('400 on invalid email', async () => {
    expect((await post(makeReq({ email: 'not-an-email' }))).status).toBe(400)
    expect((await post(makeReq({}))).status).toBe(400)
  })

  it('201 when a new admin is added', async () => {
    ;(addAdmin as jest.Mock).mockResolvedValue(true)
    const res = await post(makeReq({ email: 'new@b.com' }))
    expect(res.status).toBe(201)
    expect(addAdmin).toHaveBeenCalledWith('new@b.com', 'a@b.com')
  })

  it('409 when the email is already an admin', async () => {
    ;(addAdmin as jest.Mock).mockResolvedValue(false)
    expect((await post(makeReq({ email: 'dup@b.com' }))).status).toBe(409)
  })

  it('still 201 when notification emails fail (non-fatal)', async () => {
    ;(addAdmin as jest.Mock).mockResolvedValue(true)
    ;(listAdmins as jest.Mock).mockRejectedValue(new Error('smtp'))
    expect((await post(makeReq({ email: 'new@b.com' }))).status).toBe(201)
  })
})

describe('DELETE /api/admin', () => {
  it('400 when email missing', async () => {
    expect((await del(makeReq({}))).status).toBe(400)
  })

  it('200 when an admin is removed', async () => {
    ;(removeAdmin as jest.Mock).mockResolvedValue({ removed: true })
    const res = await del(makeReq({ email: 'gone@b.com' }))
    expect(res.status).toBe(200)
    expect(removeAdmin).toHaveBeenCalledWith('gone@b.com')
  })

  it('403 when removal is blocked with a reason (e.g. super admin)', async () => {
    ;(removeAdmin as jest.Mock).mockResolvedValue({ removed: false, reason: 'Cannot remove super admin' })
    expect((await del(makeReq({ email: 'admin@mmrunners.org' }))).status).toBe(403)
  })

  it('404 when the admin is not found', async () => {
    ;(removeAdmin as jest.Mock).mockResolvedValue({ removed: false })
    expect((await del(makeReq({ email: 'ghost@b.com' }))).status).toBe(404)
  })
})
