/**
 * Unit tests for the roster-privacy column plumbing in lib/db/members.ts
 * (V037 `members.ShowRsvpPublicly`).
 *
 * A privacy flag that silently inverts is worse than no flag, so both directions
 * are pinned: how the tinyint(1) maps into the Member type, and what actually
 * gets written back. The default must be "listed" (matching the DB default), and
 * an absent column must not read as "opted out".
 */

jest.mock('@/lib/db/connection', () => ({
  pool: { getConnection: jest.fn() },
  getDb: jest.fn(),
}))

import { getMemberById, updateMemberProfile } from '@/lib/db/members'
import { getDb } from '@/lib/db/connection'

const mockGetDb = getDb as jest.Mock

function mockDb(rows: Record<string, unknown>[] = []) {
  const execute = jest.fn(async () => [rows] as unknown)
  mockGetDb.mockReturnValue({ execute })
  return execute
}

const memberRow = (over: Record<string, unknown> = {}) => ({
  MemberID: 'A0042',
  Email: 'mei@example.com',
  FirstName: 'Mei',
  LastName: 'Chen',
  Type: 'Individual',
  Status: 'active',
  Created: new Date('2024-01-01T00:00:00Z'),
  ...over,
})

beforeEach(() => jest.clearAllMocks())

describe('rowToMember — ShowRsvpPublicly mapping', () => {
  it('maps 1 to true', async () => {
    mockDb([memberRow({ ShowRsvpPublicly: 1 })])
    expect((await getMemberById('A0042'))!.showRsvpPublicly).toBe(true)
  })

  it('maps 0 to false', async () => {
    mockDb([memberRow({ ShowRsvpPublicly: 0 })])
    expect((await getMemberById('A0042'))!.showRsvpPublicly).toBe(false)
  })

  it('defaults an absent column to true, not false', async () => {
    // Fail-closed here would silently unlist every member on any row shape that
    // doesn't select the column.
    mockDb([memberRow()])
    expect((await getMemberById('A0042'))!.showRsvpPublicly).toBe(true)
  })

  it('treats NULL as true (matches the NOT NULL DEFAULT 1 column)', async () => {
    mockDb([memberRow({ ShowRsvpPublicly: null })])
    expect((await getMemberById('A0042'))!.showRsvpPublicly).toBe(true)
  })

  it('handles the string "0" some drivers return for tinyint', async () => {
    mockDb([memberRow({ ShowRsvpPublicly: '0' })])
    expect((await getMemberById('A0042'))!.showRsvpPublicly).toBe(false)
  })
})

describe('updateMemberProfile — ShowRsvpPublicly write', () => {
  it('writes 1 for true and 0 for false, never a JS boolean', async () => {
    for (const [input, expected] of [[true, 1], [false, 0]] as const) {
      const execute = mockDb()
      await updateMemberProfile('A0042', { showRsvpPublicly: input })

      const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]]
      expect(sql).toContain('ShowRsvpPublicly = ?')
      expect(params[0]).toBe(expected)
      expect(typeof params[0]).toBe('number')
      expect(params[params.length - 1]).toBe('A0042')
    }
  })

  it('leaves the column alone when the field is absent', async () => {
    const execute = mockDb()
    await updateMemberProfile('A0042', { firstName: 'Mei' })
    const [sql] = execute.mock.calls[0] as unknown as [string]
    expect(sql).not.toContain('ShowRsvpPublicly')
  })

  it('updates the flag alongside other fields in one statement', async () => {
    const execute = mockDb()
    await updateMemberProfile('A0042', { firstName: 'Mei', showRsvpPublicly: false })
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('FirstName = ?')
    expect(sql).toContain('ShowRsvpPublicly = ?')
    expect(params).toEqual(['Mei', 0, 'A0042'])
  })

  it('issues no query at all for an empty update', async () => {
    const execute = mockDb()
    await updateMemberProfile('A0042', {})
    expect(execute).not.toHaveBeenCalled()
  })
})
