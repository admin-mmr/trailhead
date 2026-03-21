import { getDb } from './connection'
import type { Member, MembershipType } from '@/types'

/** Map a DB row to a Member object */
function rowToMember(row: any): Member {
  return {
    id:             row.id,
    memberId:       row.member_id,
    email:          row.email,
    chineseName:    row.chinese_name ?? undefined,
    englishName:    row.english_name ?? undefined,
    phone:          row.phone ?? undefined,
    wechatId:       row.wechat_id ?? undefined,
    nyrrId:         row.nyrr_id ?? undefined,
    membershipType: row.membership_type,
    status:         row.status,
    expiresAt:      row.expires_at?.toISOString() ?? undefined,
    familyId:       row.family_id ?? undefined,
    createdAt:      row.created_at.toISOString(),
  }
}

export async function findMemberByEmail(email: string): Promise<Member | null> {
  const db = getDb()
  const [rows] = await db.execute<any[]>(
    `SELECT * FROM members WHERE email = ? LIMIT 1`,
    [email]
  )
  return rows.length ? rowToMember(rows[0]) : null
}

/**
 * Find a member by email, or create one if not found.
 * Used by the payment submission flow to ensure a member exists before recording payment.
 */
export async function findOrCreateMember(params: {
  email: string
  firstName?: string
  lastName?: string
  phone?: string
  nyrrId?: string
  membershipType?: MembershipType
  // These fields are currently not stored (future: address/profile expansion)
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
  // Try to find existing member
  const existing = await findMemberByEmail(params.email)
  if (existing) return existing

  // Create new member with available fields
  return createNewMember({
    email:          params.email,
    englishName:    params.firstName || undefined,
    phone:          params.phone || undefined,
    nyrrId:         params.nyrrId || undefined,
    membershipType: params.membershipType || 'individual',
  })
}

export async function getMemberById(memberId: string): Promise<Member | null> {
  const db = getDb()
  const [rows] = await db.execute<any[]>(
    `SELECT * FROM members WHERE member_id = ? LIMIT 1`,
    [memberId]
  )
  return rows.length ? rowToMember(rows[0]) : null
}

/**
 * Create a new member record (status=inactive until Stripe payment confirmed).
 * Uses stored procedure for race-condition-safe member_id generation.
 */
export async function createNewMember(params: {
  email: string
  chineseName?: string
  englishName?: string
  phone?: string
  wechatId?: string
  membershipType: MembershipType
}): Promise<Member> {
  const db = getDb()
  const conn = await db.getConnection()
  try {
    await conn.beginTransaction()

    // Atomic ID generation via stored procedure
    const [[{ next_id }]] = await conn.execute<any[]>(
      `CALL generate_member_id(@next_id); SELECT @next_id AS next_id`
    ) as any

    const year     = new Date().getFullYear()
    const memberId = `MMR-${year}-${String(next_id).padStart(4, '0')}`

    await conn.execute(
      `INSERT INTO members
         (member_id, email, chinese_name, english_name, phone, wechat_id, membership_type, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'inactive')`,
      [memberId, params.email, params.chineseName ?? null, params.englishName ?? null,
       params.phone ?? null, params.wechatId ?? null, params.membershipType]
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

export async function activateMember(
  memberId: string,
  membershipType: MembershipType
): Promise<void> {
  const db = getDb()
  const months = membershipType === 'family' ? 12 : 12
  await db.execute(
    `UPDATE members
     SET status = 'active',
         expires_at = DATE_ADD(NOW(), INTERVAL ? MONTH)
     WHERE member_id = ?`,
    [months, memberId]
  )
}

export async function updateMemberProfile(
  memberId: string,
  updates: Partial<Pick<Member, 'chineseName' | 'englishName' | 'phone' | 'wechatId' | 'nyrrId'>>
): Promise<void> {
  const db = getDb()
  const fields: string[] = []
  const values: unknown[] = []

  if (updates.chineseName !== undefined) { fields.push('chinese_name = ?'); values.push(updates.chineseName) }
  if (updates.englishName !== undefined) { fields.push('english_name = ?'); values.push(updates.englishName) }
  if (updates.phone       !== undefined) { fields.push('phone = ?');        values.push(updates.phone) }
  if (updates.wechatId    !== undefined) { fields.push('wechat_id = ?');    values.push(updates.wechatId) }
  if (updates.nyrrId      !== undefined) { fields.push('nyrr_id = ?');      values.push(updates.nyrrId) }

  if (!fields.length) return
  values.push(memberId)

  await db.execute(
    `UPDATE members SET ${fields.join(', ')} WHERE member_id = ?`,
    values
  )
}

export async function getPaymentHistory(memberId: string) {
  const db = getDb()
  const [rows] = await db.execute<any[]>(
    `SELECT * FROM payment_history WHERE member_id = ? ORDER BY paid_at DESC`,
    [memberId]
  )
  return rows
}
