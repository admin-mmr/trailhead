import { getDb } from './connection'

/**
 * The super-admin email that can never be removed from the admin list.
 */
export const SUPER_ADMIN_EMAIL = 'admin@mmrunners.org'

export interface AdminRecord {
  id:       number
  email:    string
  role:     string   // 'admin' or 'super_admin'
  addedBy:  string
  addedAt:  string   // ISO date
}

/**
 * Check if admin_users table exists. Called lazily on first use.
 * The table is created by MIGRATION_V008; this function just verifies it exists.
 */
let tableEnsured = false
async function ensureTable(): Promise<void> {
  if (tableEnsured) return
  const db = getDb()
  try {
    // Verify admin_users table exists by querying it
    await db.execute(`SELECT 1 FROM admin_users LIMIT 1`)
    tableEnsured = true
  } catch (err) {
    // Table doesn't exist yet — this shouldn't happen after migration V008
    console.error('admin_users table not found. Run MIGRATION_V008 first.', err)
    throw err
  }
}

/**
 * Check whether a given email has admin privileges (any role in admin_users table).
 */
export async function isAdmin(email: string): Promise<boolean> {
  await ensureTable()
  const db = getDb()
  const [rows] = await db.execute<any[]>(
    `SELECT 1 FROM admin_users WHERE email = ? LIMIT 1`,
    [email.toLowerCase()]
  )
  return rows.length > 0
}

/**
 * List all admins from admin_users table.
 */
export async function listAdmins(): Promise<AdminRecord[]> {
  await ensureTable()
  const db = getDb()
  const [rows] = await db.execute<any[]>(
    `SELECT id, email, role, added_by, added_at FROM admin_users ORDER BY added_at ASC`
  )
  return rows.map((r: any) => ({
    id:      r.id,
    email:   r.email,
    role:    r.role,
    addedBy: r.added_by,
    addedAt: r.added_at instanceof Date ? r.added_at.toISOString() : String(r.added_at),
  }))
}

/**
 * Add a new admin to admin_users table. Defaults to 'admin' role unless specified.
 * Returns true if added, false if already exists.
 * Throws if the caller is not an admin themselves (checked at the API layer).
 */
export async function addAdmin(email: string, addedBy: string, role: string = 'admin'): Promise<boolean> {
  await ensureTable()
  const db = getDb()
  try {
    await db.execute(
      `INSERT INTO admin_users (email, role, added_by) VALUES (?, ?, ?)`,
      [email.toLowerCase(), role, addedBy.toLowerCase()]
    )
    return true
  } catch (err: any) {
    // Duplicate entry — already an admin
    if (err.code === 'ER_DUP_ENTRY') return false
    throw err
  }
}

/**
 * Remove an admin from admin_users table.
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
    `DELETE FROM admin_users WHERE email = ?`,
    [email.toLowerCase()]
  )
  return { removed: result.affectedRows > 0 }
}
