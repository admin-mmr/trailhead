'use client'

import { useState, useEffect } from 'react'
import { Shield, UserPlus, Trash2, Loader2, AlertTriangle } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'

interface Admin {
  id: number
  email: string
  addedBy: string
  addedAt: string
}

const SUPER_ADMIN = 'admin@mmrunners.org'

export default function AdminPage() {
  const { lang } = useLang()
  const [admins, setAdmins] = useState<Admin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [success, setSuccess] = useState('')

  async function fetchAdmins() {
    try {
      const res = await fetch('/api/admin')
      const data = await res.json()
      if (res.ok && data.ok) {
        setAdmins(data.data)
      } else {
        setError(data.error || 'Failed to load admins')
      }
    } catch {
      setError('Failed to load admins')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchAdmins() }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!newEmail.trim()) return
    setAdding(true)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim().toLowerCase() }),
      })
      const data = await res.json()
      if (res.ok) {
        setSuccess(data.message || 'Admin added successfully.')
        setNewEmail('')
        await fetchAdmins()
      } else {
        setError(data.error || 'Failed to add admin')
      }
    } catch {
      setError('Something went wrong')
    } finally {
      setAdding(false)
    }
  }

  async function handleRemove(email: string) {
    if (!confirm(
      lang === 'zh'
        ? `确定要移除 ${email} 的管理员权限吗？`
        : `Are you sure you want to remove ${email} as admin?`
    )) return

    setRemoving(email)
    setError('')
    setSuccess('')
    try {
      const res = await fetch('/api/admin', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      const data = await res.json()
      if (res.ok) {
        setSuccess(data.message || 'Admin removed.')
        await fetchAdmins()
      } else {
        setError(data.error || 'Failed to remove admin')
      }
    } catch {
      setError('Something went wrong')
    } finally {
      setRemoving(null)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-2xl mx-auto px-4">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-[#C8102E] rounded-xl flex items-center justify-center">
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#0A2342]">
              {lang === 'zh' ? '管理员管理' : 'Admin Management'}
            </h1>
            <p className="text-sm text-gray-500">
              {lang === 'zh' ? '管理谁有权访问管理面板' : 'Manage who has access to the admin panel'}
            </p>
          </div>
        </div>

        {/* Error / success messages */}
        {error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm">
            {success}
          </div>
        )}

        {/* Add admin form */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="text-lg font-semibold text-[#0A2342] mb-4 flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            {lang === 'zh' ? '添加管理员' : 'Add New Admin'}
          </h2>
          <form onSubmit={handleAdd} className="flex gap-3">
            <input
              type="email"
              value={newEmail}
              onChange={e => setNewEmail(e.target.value)}
              placeholder={lang === 'zh' ? '输入邮箱地址' : 'Enter email address'}
              required
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#0A2342]"
            />
            <button
              type="submit"
              disabled={adding}
              className="bg-[#0A2342] text-white px-6 py-2.5 rounded-xl font-semibold text-sm hover:bg-[#0d2d55] transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {adding && <Loader2 className="h-4 w-4 animate-spin" />}
              {lang === 'zh' ? '添加' : 'Add'}
            </button>
          </form>
          <p className="text-xs text-gray-400 mt-2">
            {lang === 'zh'
              ? '添加后将通知所有现有管理员。'
              : 'All existing admins will be notified when a new admin is added.'}
          </p>
        </div>

        {/* Admin list */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-[#0A2342] mb-4">
            {lang === 'zh' ? `当前管理员 (${admins.length})` : `Current Admins (${admins.length})`}
          </h2>
          <div className="space-y-3">
            {admins.map(admin => {
              const isSuperAdmin = admin.email === SUPER_ADMIN
              return (
                <div
                  key={admin.id}
                  className="flex items-center justify-between p-4 rounded-xl bg-gray-50 border border-gray-100"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-[#0A2342] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                      {admin.email[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-[#0A2342] truncate">
                          {admin.email}
                        </p>
                        {isSuperAdmin && (
                          <span className="text-[0.6rem] font-semibold px-2 py-0.5 rounded-full bg-[#C8102E]/10 text-[#C8102E]">
                            SUPER
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400">
                        {lang === 'zh' ? '由' : 'Added by'}{' '}
                        {admin.addedBy}{' · '}
                        {new Date(admin.addedAt).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  {!isSuperAdmin && (
                    <button
                      onClick={() => handleRemove(admin.email)}
                      disabled={removing === admin.email}
                      className="text-red-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
                      title={lang === 'zh' ? '移除管理员' : 'Remove admin'}
                    >
                      {removing === admin.email
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Trash2 className="h-4 w-4" />}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
