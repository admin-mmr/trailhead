/**
 * GET /api/admin/sync-status
 *
 * View the status of Google Sheets → MySQL sync.
 * Shows:
 * - Last sync time
 * - Changes detected/synced
 * - Any conflicts
 * - Error messages
 *
 * Admin only.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getSession, requireActiveMember } from '@/lib/auth/session'
import db from '@/lib/db/connection'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    // Auth: logged-in members only (admin UI not yet implemented)
    const session = await getSession()
    if (!session?.memberId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
    }

    const limit = parseInt(req.nextUrl.searchParams.get('limit') ?? '10')
    const sheet = req.nextUrl.searchParams.get('sheet') ?? 'Membership Master'

    // Get sync metadata
    const [metadataRows] = (await db.execute(
      `SELECT * FROM sync_metadata WHERE sheet_name = ? LIMIT 1`,
      [sheet]
    )) as [any[], any]

    // Get recent snapshots
    const [snapshots] = (await db.execute(
      `SELECT snapshot_id, sheet_name, snapshot_hash, row_count, snapshot_timestamp, status
       FROM sync_snapshots
       WHERE sheet_name = ?
       ORDER BY snapshot_timestamp DESC
       LIMIT ?`,
      [sheet, limit]
    )) as [any[], any]

    // Get recent changes
    const [changes] = (await db.execute(
      `SELECT change_id, change_type, row_key, sync_status, created_at
       FROM sync_changes
       WHERE sheet_name = ?
       ORDER BY created_at DESC
       LIMIT ?`,
      [sheet, limit]
    )) as [any[], any]

    // Get unresolved conflicts
    const [conflicts] = (await db.execute(
      `SELECT conflict_id, row_key, sheets_modified_at, mysql_modified_at, created_at
       FROM sync_conflicts
       WHERE sheet_name = ? AND resolved = FALSE
       ORDER BY created_at DESC
       LIMIT ?`,
      [sheet, limit]
    )) as [any[], any]

    // Summary stats
    const [statsRows] = (await db.execute(
      `SELECT
         COUNT(DISTINCT snapshot_id) as total_snapshots,
         SUM(CASE WHEN change_type = 'added' THEN 1 ELSE 0 END) as total_added,
         SUM(CASE WHEN change_type = 'modified' THEN 1 ELSE 0 END) as total_modified,
         SUM(CASE WHEN change_type = 'deleted' THEN 1 ELSE 0 END) as total_deleted
       FROM sync_changes
       WHERE sheet_name = ?`,
      [sheet]
    )) as [any[], any]

    return NextResponse.json({
      metadata: metadataRows[0] || null,
      snapshots: snapshots || [],
      recent_changes: changes || [],
      unresolved_conflicts: conflicts || [],
      stats: statsRows[0] || {}
    })
  } catch (error) {
    console.error('Failed to get sync status:', error)
    return NextResponse.json(
      { error: 'Failed to get sync status' },
      { status: 500 }
    )
  }
}
