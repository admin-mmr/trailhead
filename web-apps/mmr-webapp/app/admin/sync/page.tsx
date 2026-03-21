/**
 * Admin Sync Status Dashboard
 * View and manage Google Sheets ↔ MySQL sync
 */

'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

interface SyncMetadata {
  sync_id: number
  sheet_name: string
  last_synced_at: string
  last_sheets_modified: string
  sync_status: 'idle' | 'syncing' | 'error'
  last_error?: string
  rows_synced: number
  rows_added: number
  rows_modified: number
  rows_deleted: number
}

interface Snapshot {
  snapshot_id: number
  snapshot_hash: string
  row_count: number
  snapshot_timestamp: string
  status: string
}

interface Change {
  change_id: number
  change_type: 'added' | 'modified' | 'deleted'
  row_key: string
  sync_status: string
  created_at: string
}

interface Conflict {
  conflict_id: number
  row_key: string
  sheets_modified_at: string
  mysql_modified_at: string
  created_at: string
}

export default function SyncStatusPage() {
  const [metadata, setMetadata] = useState<SyncMetadata | null>(null)
  const [snapshots, setSnapshots] = useState<Snapshot[]>([])
  const [changes, setChanges] = useState<Change[]>([])
  const [conflicts, setConflicts] = useState<Conflict[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function fetchStatus() {
      try {
        const res = await fetch('/api/admin/sync-status')
        if (!res.ok) throw new Error(`API error: ${res.status}`)

        const data = await res.json()
        setMetadata(data.metadata)
        setSnapshots(data.snapshots)
        setChanges(data.recent_changes)
        setConflicts(data.unresolved_conflicts)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    fetchStatus()
    // Refresh every 30 seconds
    const interval = setInterval(fetchStatus, 30000)
    return () => clearInterval(interval)
  }, [])

  if (loading) return <div className="p-6">Loading...</div>
  if (error) return <div className="p-6 text-red-600">Error: {error}</div>

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <h1 className="text-3xl font-bold mb-6">Sync Status Dashboard</h1>

      {/* Metadata */}
      {metadata && (
        <div className="bg-white border rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-semibold mb-4">{metadata.sheet_name}</h2>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-gray-600">Status</p>
              <p className={`font-semibold ${
                metadata.sync_status === 'idle' ? 'text-green-600' :
                metadata.sync_status === 'syncing' ? 'text-blue-600' :
                'text-red-600'
              }`}>
                {metadata.sync_status.toUpperCase()}
              </p>
            </div>
            <div>
              <p className="text-gray-600">Last Sync</p>
              <p className="font-semibold">{metadata.last_synced_at ? new Date(metadata.last_synced_at).toLocaleString() : 'Never'}</p>
            </div>
            <div>
              <p className="text-gray-600">Last Changes</p>
              <p className="font-semibold">+{metadata.rows_added} ~{metadata.rows_modified} -{metadata.rows_deleted}</p>
            </div>
            <div>
              <p className="text-gray-600">Unresolved Conflicts</p>
              <p className="font-semibold text-red-600">{conflicts.length}</p>
            </div>
          </div>
          {metadata.last_error && (
            <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded">
              <p className="text-red-700"><strong>Last Error:</strong> {metadata.last_error}</p>
            </div>
          )}
        </div>
      )}

      {/* Conflicts */}
      {conflicts.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
          <h3 className="text-xl font-semibold text-red-700 mb-4">Unresolved Conflicts ({conflicts.length})</h3>
          <div className="space-y-2">
            {conflicts.map(conflict => (
              <div key={conflict.conflict_id} className="p-3 bg-white border border-red-200 rounded">
                <p className="font-semibold">{conflict.row_key}</p>
                <p className="text-sm text-gray-600">
                  Sheets: {new Date(conflict.sheets_modified_at).toLocaleString()} |
                  MySQL: {new Date(conflict.mysql_modified_at).toLocaleString()}
                </p>
                <Link href={`/admin/sync/conflicts/${conflict.conflict_id}`} className="text-blue-600 hover:underline">
                  Review & Resolve →
                </Link>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Changes */}
      <div className="bg-white border rounded-lg p-6 mb-6">
        <h3 className="text-xl font-semibold mb-4">Recent Changes</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b">
              <tr>
                <th className="text-left p-2">Type</th>
                <th className="text-left p-2">Row Key</th>
                <th className="text-left p-2">Status</th>
                <th className="text-left p-2">Created</th>
              </tr>
            </thead>
            <tbody>
              {changes.map(change => (
                <tr key={change.change_id} className="border-b hover:bg-gray-50">
                  <td className="p-2">
                    <span className={`px-2 py-1 rounded text-white text-xs font-semibold ${
                      change.change_type === 'added' ? 'bg-green-600' :
                      change.change_type === 'modified' ? 'bg-blue-600' :
                      'bg-red-600'
                    }`}>
                      {change.change_type.toUpperCase()}
                    </span>
                  </td>
                  <td className="p-2">{change.row_key}</td>
                  <td className="p-2">{change.sync_status}</td>
                  <td className="p-2 text-gray-600">{new Date(change.created_at).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Snapshots */}
      <div className="bg-white border rounded-lg p-6">
        <h3 className="text-xl font-semibold mb-4">Snapshot History</h3>
        <div className="space-y-2">
          {snapshots.map(snapshot => (
            <div key={snapshot.snapshot_id} className="p-3 bg-gray-50 border rounded flex justify-between items-center">
              <div>
                <p className="font-mono text-sm">{snapshot.snapshot_hash.slice(0, 8)}</p>
                <p className="text-xs text-gray-600">{snapshot.row_count} rows • {new Date(snapshot.snapshot_timestamp).toLocaleString()}</p>
              </div>
              <span className={`px-2 py-1 rounded text-xs font-semibold ${
                snapshot.status === 'processed' ? 'bg-green-100 text-green-700' :
                snapshot.status === 'new' ? 'bg-blue-100 text-blue-700' :
                'bg-red-100 text-red-700'
              }`}>
                {snapshot.status.toUpperCase()}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
