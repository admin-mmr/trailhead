// ============================================================
// lib/db/config.ts — read-only access to the shared config table
//
// Mirrors mmr-admin/config_cache.py on the Flask side. Membership
// prices live in config (MIGRATION_V033) so webapp checkout and
// Flask payment matching derive amounts from the same source.
// ============================================================

import type { RowDataPacket } from 'mysql2'
import { pool } from '@/lib/db/connection'

export async function getConfigValue(key: string, fallback: string): Promise<string> {
  const conn = await pool.getConnection()
  try {
    const [rows] = await conn.execute<RowDataPacket[]>(
      'SELECT ConfigValue FROM config WHERE ConfigKey = ?',
      [key]
    )
    const value = rows[0]?.ConfigValue
    return value != null && value !== '' ? String(value) : fallback
  } finally {
    conn.release()
  }
}

// PaymentIntent label (as stored on submissions) → config key + fallback price
export const MEMBERSHIP_PRICING: Record<string, { configKey: string; fallback: number }> = {
  'Individual Membership': { configKey: 'IndividualPrice',    fallback: 30 },
  'Family Membership':     { configKey: 'FamilyPrice',        fallback: 50 },
  'Family Upgrade':        { configKey: 'FamilyUpgradePrice', fallback: 20 },
}

/** Authoritative price for a membership PaymentIntent label, or null if not a membership type. */
export async function getMembershipPrice(paymentIntent: string): Promise<number | null> {
  const entry = MEMBERSHIP_PRICING[paymentIntent]
  if (!entry) return null
  const raw = await getConfigValue(entry.configKey, String(entry.fallback))
  const price = Number(raw)
  return Number.isFinite(price) && price > 0 ? price : entry.fallback
}
