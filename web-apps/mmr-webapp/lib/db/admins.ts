import { getDb } from './connection'

/**
 * The super-admin email that can never be removed from the admin list.
 */
export const SUPER_ADMIN_EMAIL = 'admin@mmrunners.org'

export interface AdminRecord {
  id:       number
  email:    string
  addedBy:  string
  addedAt:  string   // ISO date
}

/**
 * Ensure the admins table exists. Called lazily on first use.
 * Uses CREATE TABLE IF NOT EXISTS so it's safe to call multiple times.
 */
let tableEnsured = false
async function ensureTable(): Promise<void> {
  if (tableEnsured) return
  const db = getDb()
  await db.execute(`
    CREATE TABLE IF NOT EXISTS admins (
      id        INT AUTO_INCREMENT PRIMARY KEY,
      email     VARCHAR(255) NOT NULL UNIQUE,
      added_by  VARCHAR(255) NOT NULL DEFAULT 'system',
      added_at  TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `)
  // Ensure the super admin always exists
  await db.execute(
    `INSERT IGNORE INTO admins (email, added_by) VALUES (?, 'system')`,
    [SUPER_ADMIN_EMAIL]
  )
  tableEnsured = true
}

/**
 * Check whether a given email has admin privileges.
 */
export async function isAdmin(email: string): Promise<boolean> {
  await ensureTable()
  const db = getDb()
  const [rows] = await db.execute<any[]>(
    `SELECT 1 FROM admins WHERE email = ? LIMIT 1`,
    [email.toLowerCase()]
  )
  return rows.length > 0
}

/**
 * List all admins.
 */
export async function listAdmins(): Promise<AdminRecord[]> {
  await ensureTable()
  const db = getDb()
  const [rows] = await db.execute<any[]>(
    `SELECT id, email, added_by, added_at FROM admins ORDER BY added_at ASC`
  )
  return rows.map((r: any) => ({
    id:      r.id,
    email:   r.email,
    addedBy: r.added_by,
    addedAt: r.added_at instanceof Date ? r.added_at.toISOString() : String(r.added_at),
  }))
}

/**
 * Add a new admin. Returns true if added, false if already exists.
 * Throws if the caller is not an admin themselves (checked at the API layer).
 */
export async function addAdmin(email: string, addedBy: string): Promise<boolean> {
  await ensureTable()
  const db = getDb()
  try {
    await db.execute(
      `INSERT INTO admins (email, added_by) VALUES (?, ?)`,
      [email.toLowerCase(), addedBy.toLowerCase()]
    )
    return true
  } catch (err: any) {
    // Duplicate entry — already an admin
    if (err.code === 'ER_DUP_ENTRY') return false
    throw err
  }
}

/**
 * Remove an admin by email.
 * The super admin (admin@mmrunners.org) cannot be removed.
 * Returns true if removed, false if not found or is super admin.
 */
export async function removeAdmin(email: string): Promise<{ removed: boolean; reason?: string }> {
  if (email.toLowerCase() === SUPER_ADMIN_EMAIL) {
    return { removed: false, reason: 'Cannot remove the super admin.' }
  }
  await ensureTable()
  const db = getDb()
  const [result] = await db.execute<any>(
    `DELETE FROM admins WHERE email = ?`,
    [email.toLowerCase()]
  )
  return { removed: result.affectedRows > 0 }
}
