/**
 * notifications.ts — the notification_log ledger (db/MIGRATION_V038.sql).
 *
 * This is what makes the weekly reminder job safe. The pattern is CLAIM, then
 * send, then settle:
 *
 *   1. claimNotification() INSERTs the row with the dedupe_key up front. A
 *      duplicate key means someone already handled this exact notification, so
 *      the caller skips. Claiming BEFORE the send is the whole point — claiming
 *      after would let two overlapping runs both send and then both log.
 *   2. the caller sends the mail.
 *   3. markSent() / markFailed() settle the row. markFailed CLEARS dedupe_key,
 *      which releases the claim so the next run retries: a GAS timeout must not
 *      silently consume a member's only notice. Several NULLs coexist happily
 *      under a UNIQUE index in MySQL.
 */

import type { ResultSetHeader, RowDataPacket } from 'mysql2'
import { pool } from './connection'

export interface NotificationClaim {
  id: number
}

interface CountRow extends RowDataPacket {
  n: number
}

/** MySQL duplicate-entry error — the signal that this notification is taken. */
const ER_DUP_ENTRY = 'ER_DUP_ENTRY'

export interface ClaimInput {
  memberId:   string | null
  emailType:  string
  stage?:     string | null
  dedupeKey:  string
  recipient:  string
  subject?:   string | null
}

/**
 * Reserve a notification. Returns null when it is already claimed — the caller
 * must then send nothing.
 */
export async function claimNotification(input: ClaimInput): Promise<NotificationClaim | null> {
  try {
    const [res] = await pool.execute<ResultSetHeader>(
      `INSERT INTO notification_log
         (MemberID, email_type, stage, dedupe_key, recipient, subject, status)
       VALUES (?, ?, ?, ?, ?, ?, 'skipped')`,
      [
        input.memberId,
        input.emailType,
        input.stage ?? null,
        input.dedupeKey,
        input.recipient,
        input.subject ?? null,
      ],
    )
    return { id: res.insertId }
  } catch (err) {
    if ((err as { code?: string }).code === ER_DUP_ENTRY) return null
    throw err
  }
}

export async function markSent(id: number): Promise<void> {
  await pool.execute(
    `UPDATE notification_log SET status = 'sent', error = NULL WHERE id = ?`,
    [id],
  )
}

/**
 * Record a failure and release the claim so a later run can retry.
 * The error text is truncated — a stack trace in a log column helps nobody.
 */
export async function markFailed(id: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error)
  await pool.execute(
    `UPDATE notification_log
        SET status = 'failed', error = ?, dedupe_key = NULL
      WHERE id = ?`,
    [message.slice(0, 1000), id],
  )
}

/**
 * Log a send that has no dedupe semantics (transactional mail — a receipt should
 * go out every time it is earned). Never throws: losing a log row must not turn
 * a delivered email into an error.
 */
export async function logNotification(input: {
  memberId:  string | null
  emailType: string
  stage?:    string | null
  recipient: string
  subject?:  string | null
  status?:   'sent' | 'failed' | 'skipped'
  error?:    string | null
}): Promise<void> {
  try {
    await pool.execute(
      `INSERT INTO notification_log
         (MemberID, email_type, stage, dedupe_key, recipient, subject, status, error)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
      [
        input.memberId,
        input.emailType,
        input.stage ?? null,
        input.recipient,
        input.subject ?? null,
        input.status ?? 'sent',
        input.error ?? null,
      ],
    )
  } catch (err) {
    console.error('[notification_log] insert failed:', err)
  }
}

/** How many emails we have sent today — the guard against the GAS/Gmail quota. */
export async function countSentToday(): Promise<number> {
  const [rows] = await pool.execute<CountRow[]>(
    `SELECT COUNT(*) AS n FROM notification_log
      WHERE status = 'sent' AND created_at >= CURDATE()`,
  )
  return rows[0]?.n ?? 0
}
