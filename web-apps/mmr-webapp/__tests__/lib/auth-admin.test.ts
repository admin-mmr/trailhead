/**
 * Unit tests for lib/auth/admin.ts — requireAdmin()
 *
 * Composes requireSession() with the DB admin lookup. Both dependencies are
 * mocked. The thrown errors must carry a `status` so withApiHandler maps them
 * to 401/403 instead of 500 — that contract is what the admin-only nyrr routes
 * rely on, so it is asserted explicitly here.
 */

jest.mock('@/lib/auth/session', () => ({
  requireSession: jest.fn(),
  getSession: jest.fn(),
  requireActiveMember: jest.fn(),
}))
jest.mock('@/lib/db/admins', () => ({ isAdmin: jest.fn() }))

import { requireAdmin } from '@/lib/auth/admin'
import { requireSession } from '@/lib/auth/session'
import { isAdmin } from '@/lib/db/admins'

const mockRequireSession = requireSession as jest.Mock
const mockIsAdmin = isAdmin as jest.Mock

const session = { memberId: 'A0001', email: 'admin@mmrunners.org', status: 'active' }

beforeEach(() => {
  jest.clearAllMocks()
  mockRequireSession.mockResolvedValue(session)
  mockIsAdmin.mockResolvedValue(true)
})

describe('requireAdmin', () => {
  it('returns the session for an admin', async () => {
    await expect(requireAdmin()).resolves.toEqual(session)
    expect(mockIsAdmin).toHaveBeenCalledWith('admin@mmrunners.org')
  })

  it('propagates the guard 401 when there is no session, without an admin lookup', async () => {
    mockRequireSession.mockRejectedValue(Object.assign(new Error('Unauthorized'), { status: 401 }))
    await expect(requireAdmin()).rejects.toMatchObject({ status: 401, message: 'Unauthorized' })
    expect(mockIsAdmin).not.toHaveBeenCalled()
  })

  it('throws a 403 for a logged-in non-admin', async () => {
    mockIsAdmin.mockResolvedValue(false)
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403, message: 'Forbidden' })
  })
})
