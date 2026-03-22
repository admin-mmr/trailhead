import { getDb } from './connection'
import type { Member, MembershipType } from '@/types'

// Maps NextAuth provider IDs → snake_case column names in members table
const OAUTH_SUB_COLUMNS: Record<string, string> = {
  'google':              'google_sub',
  'microsoft-entra-id':  'microsoft_sub',
}

/**
 * Map a DB row from the members table to a Member object.
 *
 * Column naming in members:
 *   v1-era columns  → PascalCase  (MemberID, Email, FirstName, LastName,
 *                                   Status, Expiration, FamilyID, PhoneNumber,
 *                                   WeChatID, NYRRRunnerName, YearBorn, Type…)
 *   Auth columns    → snake_case  (password_hash, google_sub, microsoft_sub)
 *   Audit columns   → PascalCase  (CreatedAt, UpdatedAt)
 *
 * mysql2 returns result keys with the EXACT casing from the DB schema.
 * DML statements (WHERE/INSERT/UPDATE) are matched case-insensitively by
 * MySQL, so they can keep lowercase identifiers without failing.
 */
function rowToMember(row: any): Member {
  // CreatedAt = auto-generated audit column (from v1 migration).
  // Fall back to Created (also in v1) in case CreatedAt is somehow null.
  const createdDate: Date = row.CreatedAt ?? row.Created ?? new Date()

  // DB stores first + last separately; Member.englishName is a single string.
  const englishName = [row.FirstName, row.LastName].filter(Boolean).join(' ') || undefined

  return {
    id:             row.MemberID,
    memberId:       row.MemberID,
    email:          row.Email,
    englishName,
    chineseName:    undefined,        // no ChineseName column in members table
    phone:          row.PhoneNumber   ?? undefined,
    wechatId:       row.WeChatID      ?? undefined,
    nyrrRunnerName: row.NYRRRunnerName ?? undefined,
    yearBorn:       row.YearBorn != null ? Number(row.YearBorn) : undefined,
    membershipType: row.Type,
    status:         row.Status,
    expiresAt:      row.Expiration instanceof Date
                      ? row.Expiration.toISOString()
                      : undefined,
    familyId:       row.FamilyID      ?? undefined,
    createdAt:      createdDate.toISOString(),
    // passwordHash is intentionally not in the Member type sent to clients —
    // it lives here only for internal auth use.
    passwordHash:   row.password_hash ?? undefined,
  }
}

export async function findMemberByEmail(email: string): Promise<Member | null> {
  const db = getDb()
  const [rows] = await db.execute<any[]>(
    `SELECT * FROM members WHERE Email = ? LIMIT 1`,
    [email]
  )
  return rows.length ? rowToMember(rows[0]) : null
}

export async function getMemberById(memberId: string): Promise<Member | null> {
  const db = getDb()
  const [rows] = await db.execute<any[]>(
    `SELECT * FROM members WHERE MemberID = ? LIMIT 1`,
    [memberId]
  )
  return rows.length ? rowToMember(rows[0]) : null
}

/**
 * Find a member by email, or create one if not found.
 * Used by the payment submission flow.
 */
export async function findOrCreateMember(params: {
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  nyrrRunnerName?: string
  yearBorn?: number
  membershipType?: MembershipType
  // Future profile fields (not yet stored):
  address?: string
  city?: string
  state?: string
  zip?: string
  dateOfBirth?: string
  emergencyName?: string
  emergencyPhone?: string
  shirtSize?: string
  pronouns?: string
}): Promise<Member> {
  const existing = await findMemberByEmail(params.email)
  if (existing) return existing

  const member = await createNewMember({
    email:          params.email,
    englishName:    params.firstName || undefined,
    phone:          params.phone || undefined,
    membershipType: params.membershipType || 'individual',
  })

  if (params.nyrrRunnerName || params.yearBorn != null) {
    await updateMemberProfile(member.memberId, {
      nyrrRunnerName: params.nyrrRunnerName,
      yearBorn:       params.yearBorn,
    })
  }

  return member
}

/**
 * Create a new member record.
 * Status defaults to 'pending' (the DB enum default) until payment is confirmed.
 * Uses stored procedure for race-condition-safe MemberID generation.
 */
export async function createNewMember(params: {
  email: string
  chineseName?: string   // no DB column for this — silently ignored
  englishName?: string   // stored in FirstName (LastName left null)
  phone?: string         // → PhoneNumber
  wechatId?: string      // → WeChatID
  membershipType: MembershipType
}): Promise<Member> {
  const db   = getDb()
  const conn = await db.getConnection()

  // DB Type column is enum('Individual','Family') — capitalise first letter
  const dbType = params.membershipType === 'family' ? 'Family' : 'Individual'

  try {
    await conn.beginTransaction()

    const [[{ next_id }]] = await conn.execute<any[]>(
      `CALL generate_member_id(@next_id); SELECT @next_id AS next_id`
    ) as any

    const year     = new Date().getFullYear()
    const memberId = `MMR-${year}-${String(next_id).padStart(4, '0')}`

    await conn.execute(
      `INSERT INTO members
         (MemberID, Email, FirstName, PhoneNumber, WeChatID, Type, Status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [
        memberId,
        params.email,
        params.englishName ?? null,
        params.phone       ?? null,
        params.wechatId    ?? null,
        dbType,
      ]
    )

    await conn.commit()
    return (await findMemberByEmail(params.email))!
  } catch (err) {
    await conn.rollback()
    throw err
  } finally {
    conn.release()
  }
}

/**
 * Activate a member and set their expiration date.
 */
export async function activateMember(
  memberId: string,
  membershipType: MembershipType
): Promise<void> {
  const db     = getDb()
  const months = 12  // both Individual and Family renew for 12 months
  await db.execute(
    `UPDATE members
     SET Status     = 'active',
         Expiration = DATE_ADD(NOW(), INTERVAL ? MONTH)
     WHERE MemberID = ?`,
    [months, memberId]
  )
}

/**
 * Update editable profile fields on a member.
 * Only non-undefined values are written.
 */
export async function updateMemberProfile(
  memberId: string,
  updates: Partial<Pick<Member,
    'chineseName' | 'englishName' | 'phone' | 'wechatId' | 'nyrrRunnerName' | 'yearBorn'
  >>
): Promise<void> {
  const db     = getDb()
  const fields: string[] = []
  const values: (string | number | null | undefined)[] = []

  // chineseName: no DB column — silently skipped
  if (updates.englishName    !== undefined) { fields.push('FirstName = ?');      values.push(updates.englishName) }
  if (updates.phone          !== undefined) { fields.push('PhoneNumber = ?');    values.push(updates.phone) }
  if (updates.wechatId       !== undefined) { fields.push('WeChatID = ?');       values.push(updates.wechatId) }
  if (updates.nyrrRunnerName !== undefined) { fields.push('NYRRRunnerName = ?'); values.push(updates.nyrrRunnerName) }
  if (updates.yearBorn       !== undefined) { fields.push('YearBorn = ?');       values.push(updates.yearBorn ?? null) }

  if (!fields.length) return
  values.push(memberId)

  await db.execute(
    `UPDATE members SET ${fields.join(', ')} WHERE MemberID = ?`,
    values as any
  )
}

/**
 * Persist the OAuth provider's subject ID on the member record.
 * Used by /auth/complete after every social login.
 */
export async function updateMemberOAuthSub(
  memberId: string,
  provider: string,
  sub: string,
): Promise<void> {
  const column = OAUTH_SUB_COLUMNS[provider]
  if (!column) return
  const db = getDb()
  await db.execute(
    `UPDATE members SET \`${column}\` = ? WHERE MemberID = ?`,
    [sub, memberId],
  )
}

/**
 * Store a bcrypt-hashed password on the member record.
 * Caller must hash the plaintext via lib/auth/password.hashPassword() first.
 */
export async function setMemberPassword(memberId: string, hash: string): Promise<void> {
  const db = getDb()
  await db.execute(
    `UPDATE members SET password_hash = ? WHERE MemberID = ?`,
    [hash, memberId],
  )
}

/**
 * Alias for findMemberByEmail — passwordHash is already included.
 * Only used internally by auth flows; never expose passwordHash to clients.
 */
export async function findMemberForAuth(email: string): Promise<Member | null> {
  return findMemberByEmail(email)
}

export async function getPaymentHistory(memberId: string) {
  const db = getDb()
  const [rows] = await db.execute<any[]>(
    `SELECT * FROM payments WHERE MemberID = ? ORDER BY CreatedAt DESC`,
    [memberId]
  )
  return rows
}
