'use client'

import { useState, useEffect } from 'react'
import { Trash2, Plus, ChevronLeft, Loader2, Tag } from 'lucide-react'
import Link from 'next/link'
import { useLang } from '@/lib/i18n/context'
import type { BibAssignment, PhotoEvent } from '@/types'

export default function BibsPage() {
  const { lang } = useLang()
  const [bibs,     setBibs]     = useState<BibAssignment[]>([])
  const [events,   setEvents]   = useState<PhotoEvent[]>([])
  const [loading,  setLoading]  = useState(true)
  const [msg,      setMsg]      = useState('')

  // Add-bib form
  const [eventId,  setEventId]  = useState('')
  const [bibNum,   setBibNum]   = useState('')
  const [adding,   setAdding]   = useState(false)

  function flash(text: string) {
    setMsg(text)
    setTimeout(() => setMsg(''), 3000)
  }

  useEffect(() => {
    Promise.all([
      fetch('/api/bibs').then(r => r.json()),
      fetch('/api/photos/albums').then(r => r.json()),
    ]).then(([bibsRes, eventsRes]) => {
      if (bibsRes.ok)   setBibs(bibsRes.data)
      if (eventsRes.ok) setEvents(eventsRes.data)
    }).finally(() => setLoading(false))
  }, [])

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!eventId || !bibNum.trim()) return
    setAdding(true)
    try {
      const res  = await fetch('/api/bibs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ eventId, bibNumber: bibNum.trim() }),
      })
      const json = await res.json()
      if (json.ok) {
        flash(lang === 'zh' ? '已添加！' : 'Added!')
        setBibNum('')
        // Refresh list
        const updated = await fetch('/api/bibs').then(r => r.json())
        if (updated.ok) setBibs(updated.data)
      } else {
        flash(json.error ?? 'Error')
      }
    } finally {
      setAdding(false)
    }
  }

  async function handleDelete(bib: BibAssignment) {
    if (bib.source !== 'member_self') return
    if (!confirm(lang === 'zh' ? '确定删除此号码布记录？' : 'Remove this bib assignment?')) return
    const res  = await fetch(`/api/bibs/${bib.id}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.ok) {
      setBibs(prev => prev.filter(b => b.id !== bib.id))
      flash(lang === 'zh' ? '已删除' : 'Removed')
    } else {
      flash(json.error ?? 'Error')
    }
  }

  const sourceLabel = (s: BibAssignment['source']) => {
    const map = {
      member_self:   { en: 'Self-assigned', zh: '本人填写' },
      nyrr_auto:     { en: 'NYRR sync',     zh: 'NYRR 同步' },
      admin_import:  { en: 'Admin import',  zh: '管理员导入' },
    }
    return lang === 'zh' ? map[s].zh : map[s].en
  }

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ── Back + header ── */}
      <div>
        <Link
          href="/portal/photos"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-navy mb-3"
        >
          <ChevronLeft className="h-4 w-4" />
          {lang === 'zh' ? '返回照片' : 'Back to Photos'}
        </Link>
        <h1 className="section-title">{lang === 'zh' ? '号码布管理' : 'Bib Numbers'}</h1>
        <p className="text-gray-500 text-sm">
          {lang === 'zh'
            ? '绑定号码布可以帮助系统通过 OCR 自动将您与比赛照片匹配。'
            : 'Linking bib numbers helps the system match you to race photos using bib OCR.'}
        </p>
      </div>

      {/* ── Add bib form ── */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-800 mb-4">
          {lang === 'zh' ? '添加号码布' : 'Add a Bib Number'}
        </h2>
        <form onSubmit={handleAdd} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {lang === 'zh' ? '选择活动' : 'Event'}
            </label>
            <select
              value={eventId}
              onChange={e => setEventId(e.target.value)}
              className="input-field"
              required
            >
              <option value="">{lang === 'zh' ? '— 选择活动 —' : '— Select an event —'}</option>
              {events.map(ev => (
                <option key={ev.eventId} value={ev.eventId}>
                  {ev.nameEn}{ev.eventDate ? ` (${ev.eventDate})` : ''}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {lang === 'zh' ? '号码布编号' : 'Bib Number'}
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={bibNum}
                onChange={e => setBibNum(e.target.value.replace(/\D/g, ''))}
                placeholder={lang === 'zh' ? '例如：12345' : 'e.g. 12345'}
                className="input-field flex-1 max-w-xs"
                required
                pattern="\d+"
              />
              <button
                type="submit"
                disabled={adding || !eventId || !bibNum.trim()}
                className="btn-primary flex items-center gap-1.5 disabled:opacity-40"
              >
                {adding
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Plus className="h-4 w-4" />}
                {lang === 'zh' ? '添加' : 'Add'}
              </button>
            </div>
          </div>

          {msg && <p className="text-sm text-green-600">{msg}</p>}
        </form>
      </div>

      {/* ── Bib list ── */}
      <div>
        <h2 className="font-semibold text-gray-800 mb-3">
          {lang === 'zh' ? '我的号码布记录' : 'My Bib Assignments'}
        </h2>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-16 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : bibs.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Tag className="h-10 w-10 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">
              {lang === 'zh' ? '还没有号码布记录' : 'No bib assignments yet'}
            </p>
          </div>
        ) : (
          <ul className="space-y-2">
            {bibs.map(bib => (
              <li
                key={bib.id}
                className="flex items-center gap-4 px-4 py-3 rounded-xl border border-gray-200 bg-white"
              >
                {/* Bib badge */}
                <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-brand-navy/10 flex flex-col items-center justify-center">
                  <Tag className="h-4 w-4 text-brand-navy mb-0.5" />
                  <span className="text-brand-navy font-mono font-bold text-xs">{bib.bibNumber}</span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {bib.eventNameEn ?? bib.eventId}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                      bib.source === 'nyrr_auto'
                        ? 'bg-green-100 text-green-700'
                        : bib.source === 'admin_import'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {sourceLabel(bib.source)}
                    </span>
                    {bib.adminReviewed && (
                      <span className="text-xs text-gray-400">
                        {lang === 'zh' ? '已审核' : '✓ reviewed'}
                      </span>
                    )}
                  </div>
                </div>

                {/* Delete — only self-assigned */}
                {bib.source === 'member_self' && (
                  <button
                    onClick={() => handleDelete(bib)}
                    className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                    aria-label={lang === 'zh' ? '删除' : 'Remove'}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Info note */}
      <div className="card p-4 bg-blue-50 border border-blue-100">
        <p className="text-sm text-blue-800">
          {lang === 'zh'
            ? 'NYRR 同步的号码布由系统每晚自动更新，无需手动添加 NYRR 比赛数据。自助填写的号码布可能需要管理员审核。'
            : 'NYRR bibs are synced automatically overnight — you don\'t need to add NYRR race data manually. Self-assigned bibs may require admin review before they affect matching.'}
        </p>
      </div>
    </div>
  )
}
