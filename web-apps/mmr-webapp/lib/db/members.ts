import { getDb } from './connection'
import type { Member, MemberStatus, MembershipType } from '@/types'

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

  return {
    id:             row.MemberID,
    memberId:       row.MemberID,
    email:          row.Email,
    firstName:      row.FirstName     ?? undefined,
    lastName:       row.LastName      ?? undefined,
    phone:          row.PhoneNumber   ?? undefined,
    wechatId:       row.WeChatID      ?? undefined,
    district:       row.District      ?? undefined,
    gender:         row.Gender        ?? undefined,
    nyrrRunnerName: row.NYRRRunnerName ?? undefined,
    yearBorn:       row.YearBorn  != null ? Number(row.YearBorn)  : undefined,
    // Roster privacy (V037). Absent column → true, matching the DB default, so
    // a member is listed unless they have actively opted out.
    showRsvpPublicly: row.ShowRsvpPublicly == null ? true : Number(row.ShowRsvpPublicly) === 1,
    joinYear:       row.JoinYear  != null ? Number(row.JoinYear)  : undefined,
    // Normalize to lowercase so code like `status === 'active'` works regardless
    // of how the value is cased in the DB (Google Sheets sync stores 'Active').
    membershipType: ((row.Type  ?? 'individual') as string).toLowerCase() as MembershipType,
    status:         ((row.Status ?? 'inactive')  as string).toLowerCase() as MemberStatus,
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
  wechatId?: string
  district?: string
  gender?: string
  nyrrRunnerName?: string
  yearBorn?: number
  membershipType?: MembershipType
}): Promise<Member> {
  const existing = await findMemberByEmail(params.email)
  if (existing) {
    // Update existing member's profile with any new info provided
    const profileUpdates: Parameters<typeof updateMemberProfile>[1] = {}
    if (params.firstName      && params.firstName      !== existing.firstName)      profileUpdates.firstName      = params.firstName
    if (params.lastName       && params.lastName       !== existing.lastName)       profileUpdates.lastName       = params.lastName
    if (params.phone          && params.phone          !== existing.phone)          profileUpdates.phone          = params.phone
    if (params.wechatId       && params.wechatId       !== existing.wechatId)       profileUpdates.wechatId       = params.wechatId
    if (params.district       && params.district       !== existing.district)       profileUpdates.district       = params.district
    if (params.gender         && params.gender         !== existing.gender)         profileUpdates.gender         = params.gender
    if (params.nyrrRunnerName && params.nyrrRunnerName !== existing.nyrrRunnerName) profileUpdates.nyrrRunnerName = params.nyrrRunnerName
    if (params.yearBorn != null && params.yearBorn     !== existing.yearBorn)       profileUpdates.yearBorn       = params.yearBorn

    if (Object.keys(profileUpdates).length) {
      await updateMemberProfile(existing.memberId, profileUpdates)
      return (await findMemberByEmail(params.email))!
    }
    return existing
  }

  const member = await createNewMember({
    email:          params.email,
    firstName:      params.firstName  || undefined,
    lastName:       params.lastName   || undefined,
    phone:          params.phone      || undefined,
    wechatId:       params.wechatId   || undefined,
    membershipType: params.membershipType || 'individual',
  })

  const profileUpdates: Parameters<typeof updateMemberProfile>[1] = {}
  if (params.district)       profileUpdates.district       = params.district
  if (params.gender)         profileUpdates.gender         = params.gender
  if (params.nyrrRunnerName) profileUpdates.nyrrRunnerName = params.nyrrRunnerName
  if (params.yearBorn != null) profileUpdates.yearBorn     = params.yearBorn

  if (Object.keys(profileUpdates).length) {
    await updateMemberProfile(member.memberId, profileUpdates)
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
  firstName?: string     // → FirstName
  lastName?: string      // → LastName
  phone?: string         // → PhoneNumber
  wechatId?: string      // → WeChatID
  membershipType: MembershipType
}): Promise<Member> {
  const db   = getDb()
  const conn = await db.getConnection()

  // DB Type column is enum('Individual','Family') — capitalise first letter
  const dbType   = params.membershipType === 'family' ? 'Family' : 'Individual'
  const joinYear = new Date().getFullYear()

  try {
    await conn.beginTransaction()

    // Two round-trips on the same pooled connection: mysql2 cannot send a
    // multi-statement through execute() (prepared statements), and the pool
    // does not enable multipleStatements. @next_id survives between calls
    // because both run on this one connection.
    await conn.query(`CALL generate_member_id(@next_id)`)
    const [idRows] = await conn.query<any[]>(`SELECT @next_id AS next_id`)

    // The procedure already returns the canonical ID (CONCAT('A', LPAD(n,4,'0'))
    // → 'A0667'). Do not re-format it: generate_member_id derives the next
    // number via SUBSTRING(MemberID, 2), so any other shape breaks ID
    // generation for every later member.
    const memberId = idRows[0]?.next_id as string | undefined
    if (!memberId) throw new Error('generate_member_id did not return a MemberID')

    await conn.execute(
      `INSERT INTO members
         (MemberID, Email, FirstName, LastName, PhoneNumber, WeChatID, JoinYear, Type, Status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        memberId,
        params.email,
        params.firstName  ?? null,
        params.lastName   ?? null,
        params.phone      ?? null,
        params.wechatId   ?? null,
        joinYear,
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
    'firstName' | 'lastName' | 'phone' | 'wechatId' | 'district' |
    'gender' | 'nyrrRunnerName' | 'yearBorn' | 'showRsvpPublicly'
  >>
): Promise<void> {
  const db     = getDb()
  const fields: string[] = []
  const values: (string | number | null | undefined)[] = []

  if (updates.firstName      !== undefined) { fields.push('FirstName = ?');      values.push(updates.firstName) }
  if (updates.lastName       !== undefined) { fields.push('LastName = ?');       values.push(updates.lastName) }
  if (updates.phone          !== undefined) { fields.push('PhoneNumber = ?');    values.push(updates.phone) }
  if (updates.wechatId       !== undefined) { fields.push('WeChatID = ?');       values.push(updates.wechatId) }
  if (updates.district       !== undefined) { fields.push('District = ?');       values.push(updates.district) }
  if (updates.gender         !== undefined) { fields.push('Gender = ?');         values.push(updates.gender) }
  if (updates.nyrrRunnerName !== undefined) { fields.push('NYRRRunnerName = ?'); values.push(updates.nyrrRunnerName) }
  if (updates.yearBorn       !== undefined) { fields.push('YearBorn = ?');       values.push(updates.yearBorn ?? null) }
  // tinyint(1) NOT NULL — send 1/0, never a JS boolean or null.
  if (updates.showRsvpPublicly !== undefined) { fields.push('ShowRsvpPublicly = ?'); values.push(updates.showRsvpPublicly ? 1 : 0) }

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
