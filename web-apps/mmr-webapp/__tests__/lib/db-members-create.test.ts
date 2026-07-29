/**
 * Unit tests for createNewMember() in lib/db/members.ts
 *
 * This is the path that shipped broken twice (07-28): the MemberID generation
 * was sent as one multi-statement execute() (mysql2 rejects that on prepared
 * statements) and the returned ID was re-wrapped as `MMR-<year>-<n>`, which
 * collides every later member because generate_member_id derives the next
 * number via SUBSTRING(MemberID, 2). Both are asserted here.
 */

jest.mock('@/lib/db/connection', () => ({
  pool: { getConnection: jest.fn() },
  getDb: jest.fn(),
}))

import { createNewMember } from '@/lib/db/members'
import { getDb } from '@/lib/db/connection'

const mockGetDb = getDb as jest.Mock

type Call = { sql: string; params?: unknown[] }

function makeConn(nextId: string | undefined, memberRow: Record<string, unknown> | null) {
  const queries: Call[] = []
  const executes: Call[] = []
  const conn = {
    queries,
    executes,
    beginTransaction: jest.fn(async () => {}),
    commit: jest.fn(async () => {}),
    rollback: jest.fn(async () => {}),
    release: jest.fn(),
    query: jest.fn(async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params })
      if (/SELECT @next_id/i.test(sql)) return [[{ next_id: nextId }]]
      return [[]]
    }),
    execute: jest.fn(async (sql: string, params?: unknown[]) => {
      executes.push({ sql, params })
      // findMemberByEmail() runs on the pool, not this conn, but both land here
      if (/FROM members/i.test(sql)) return [memberRow ? [memberRow] : []]
      return [{ affectedRows: 1 }]
    }),
  }
  return conn
}

function memberRow(memberId: string) {
  return {
    MemberID: memberId,
    Email: 'new@example.com',
    FirstName: 'New',
    LastName: 'Runner',
    Status: 'pending',
    Type: 'Individual',
  }
}

function setup(nextId: string | undefined, row: Record<string, unknown> | null) {
  const conn = makeConn(nextId, row)
  mockGetDb.mockReturnValue({
    getConnection: jest.fn(async () => conn),
    execute: conn.execute,
    query: conn.query,
  })
  return conn
}

beforeEach(() => {
  jest.clearAllMocks()
})

const params = {
  email: 'new@example.com',
  firstName: 'New',
  lastName: 'Runner',
  membershipType: 'individual' as const,
}

describe('createNewMember — MemberID generation', () => {
  it('calls the proc and reads @next_id as two separate round-trips (never one multi-statement)', async () => {
    const conn = setup('A0667', memberRow('A0667'))

    await createNewMember(params)

    const procCalls = conn.queries.filter(c => /generate_member_id/i.test(c.sql))
    const readCalls = conn.queries.filter(c => /SELECT @next_id/i.test(c.sql))
    expect(procCalls).toHaveLength(1)
    expect(readCalls).toHaveLength(1)

    // Neither statement may bundle the other — mysql2 prepared statements
    // reject multi-statement SQL and the pool has no multipleStatements.
    for (const c of [...procCalls, ...readCalls]) {
      expect(c.sql).not.toMatch(/;\s*\S/)
    }
    // The proc must not go through execute() (prepared) — only query().
    expect(conn.executes.some(c => /generate_member_id/i.test(c.sql))).toBe(false)
  })

  it('inserts the proc-returned ID verbatim in canonical A#### shape', async () => {
    const conn = setup('A0667', memberRow('A0667'))

    await createNewMember(params)

    const insert = conn.executes.find(c => /INSERT INTO members/i.test(c.sql))
    expect(insert).toBeDefined()
    const insertedId = insert!.params![0] as string
    expect(insertedId).toBe('A0667')
    expect(insertedId).toMatch(/^A\d{4}$/)
    // Guard the exact regression that shipped: an `MMR-2026-0667` style ID
    // CASTs to 0 under SUBSTRING(MemberID, 2) and collides forever after.
    expect(insertedId).not.toMatch(/MMR|-/)
  })

  it('capitalises the Type enum and stamps the current JoinYear', async () => {
    const conn = setup('A0668', memberRow('A0668'))

    await createNewMember({ ...params, membershipType: 'family' })

    const insert = conn.executes.find(c => /INSERT INTO members/i.test(c.sql))!
    // (MemberID, Email, FirstName, LastName, PhoneNumber, WeChatID, JoinYear, Type)
    expect(insert.params![6]).toBe(new Date().getFullYear())
    expect(insert.params![7]).toBe('Family')
  })

  it('passes omitted optional fields as NULL, not undefined', async () => {
    const conn = setup('A0669', memberRow('A0669'))

    await createNewMember({ email: 'new@example.com', membershipType: 'individual' })

    const insert = conn.executes.find(c => /INSERT INTO members/i.test(c.sql))!
    expect(insert.params!.slice(2, 6)).toEqual([null, null, null, null])
  })
})

describe('createNewMember — failure handling', () => {
  it('rolls back and releases when the proc returns no ID', async () => {
    const conn = setup(undefined, null)

    await expect(createNewMember(params)).rejects.toThrow(/did not return a MemberID/i)

    expect(conn.executes.some(c => /INSERT INTO members/i.test(c.sql))).toBe(false)
    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.commit).not.toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })

  it('rolls back and releases when the INSERT fails', async () => {
    const conn = setup('A0670', memberRow('A0670'))
    conn.execute.mockImplementationOnce(async () => {
      throw new Error('ER_DUP_ENTRY')
    })

    await expect(createNewMember(params)).rejects.toThrow('ER_DUP_ENTRY')

    expect(conn.rollback).toHaveBeenCalled()
    expect(conn.release).toHaveBeenCalled()
  })
})
