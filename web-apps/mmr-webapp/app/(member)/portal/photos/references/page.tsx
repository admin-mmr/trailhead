'use client'

import { useState, useEffect, useRef } from 'react'
import { Trash2, Upload, AlertTriangle, ChevronLeft, Loader2, Camera } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { useLang } from '@/lib/i18n/context'
import type { MemberReferencePhoto } from '@/types'

const MAX_ACTIVE = 20

export default function ReferencesPage() {
  const { lang } = useLang()
  const [refs,    setRefs]    = useState<MemberReferencePhoto[]>([])
  const [loading, setLoading] = useState(true)
  const [msg,     setMsg]     = useState('')

  // Upload state
  const [file,        setFile]        = useState<File | null>(null)
  const [takenAt,     setTakenAt]     = useState('')
  const [uploading,   setUploading]   = useState(false)
  const [preview,     setPreview]     = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  function flash(text: string) {
    setMsg(text)
    setTimeout(() => setMsg(''), 3500)
  }

  async function loadRefs() {
    setLoading(true)
    try {
      const res  = await fetch('/api/photos/references')
      const json = await res.json()
      if (json.ok) setRefs(json.data)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadRefs() }, [])

  async function handleDelete(ref: MemberReferencePhoto) {
    if (!confirm(lang === 'zh' ? `确定删除这张参考照片？` : `Remove this reference photo?`)) return
    const res  = await fetch(`/api/photos/references/${ref.id}`, { method: 'DELETE' })
    const json = await res.json()
    if (json.ok) {
      setRefs(prev => prev.filter(r => r.id !== ref.id))
      flash(lang === 'zh' ? '已删除' : 'Removed')
    } else {
      flash(json.error ?? 'Error')
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null
    setFile(f)
    if (f) setPreview(URL.createObjectURL(f))
    else   setPreview(null)
  }

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault()
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (takenAt) fd.append('photoTakenAt', takenAt)

      const res  = await fetch('/api/photos/references/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (json.ok) {
        flash(lang === 'zh' ? '上传成功！' : 'Uploaded successfully!')
        setFile(null); setPreview(null); setTakenAt('')
        if (fileRef.current) fileRef.current.value = ''
        await loadRefs()
      } else {
        flash(json.error ?? 'Upload failed')
      }
    } finally {
      setUploading(false)
    }
  }

  const staleRefs  = refs.filter(r => !r.isFresh)
  const activeCount = refs.length

  return (
    <div className="space-y-6 max-w-2xl">

      {/* ── Back link + header ── */}
      <div>
        <Link
          href="/portal/photos"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-navy mb-3"
        >
          <ChevronLeft className="h-4 w-4" />
          {lang === 'zh' ? '返回照片' : 'Back to Photos'}
        </Link>
        <h1 className="section-title">{lang === 'zh' ? '参考照片库' : 'Reference Photo Library'}</h1>
        <p className="text-gray-500 text-sm">
          {lang === 'zh'
            ? '参考照片用于自动识别您在活动照片中的位置。保持照片新鲜可提高匹配精准度。'
            : 'Reference photos help the system automatically find you in race photos. Keeping them fresh improves match accuracy.'}
        </p>
      </div>

      {/* ── Capacity bar ── */}
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2 text-sm">
          <span className="text-gray-600">
            {lang === 'zh' ? '参考照片数量' : 'Active references'}
          </span>
          <span className={`font-mono font-semibold ${activeCount >= MAX_ACTIVE ? 'text-red-500' : 'text-gray-800'}`}>
            {activeCount} / {MAX_ACTIVE}
          </span>
        </div>
        <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${activeCount >= MAX_ACTIVE ? 'bg-red-400' : 'bg-brand-navy'}`}
            style={{ width: `${Math.min(100, (activeCount / MAX_ACTIVE) * 100)}%` }}
          />
        </div>
        {activeCount >= MAX_ACTIVE && (
          <p className="text-xs text-red-500 mt-1.5">
            {lang === 'zh'
              ? '已达上限。添加新照片时，最旧的参考照片将自动停用。'
              : `Limit reached. Adding a new photo will auto-deactivate the oldest one.`}
          </p>
        )}
      </div>

      {/* ── Stale warning ── */}
      {staleRefs.length > 0 && (
        <div className="flex gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-xl text-sm">
          <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-yellow-800">
              {lang === 'zh'
                ? `${staleRefs.length} 张参考照片超过 3 年`
                : `${staleRefs.length} reference photo${staleRefs.length > 1 ? 's' : ''} older than 3 years`}
            </p>
            <p className="text-yellow-700 mt-0.5">
              {lang === 'zh'
                ? '旧照片可能降低识别准确度，建议上传近期照片。'
                : 'Old photos may reduce matching accuracy. Consider uploading more recent ones.'}
            </p>
          </div>
        </div>
      )}

      {/* ── Upload form ── */}
      <div className="card p-5">
        <h2 className="font-semibold text-gray-800 mb-4">
          {lang === 'zh' ? '上传新参考照片' : 'Upload a New Reference Photo'}
        </h2>
        <form onSubmit={handleUpload} className="space-y-4">
          {/* File drop area */}
          <div
            className="border-2 border-dashed border-gray-200 rounded-xl p-6 text-center cursor-pointer hover:border-brand-navy transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            {preview ? (
              <Image src={preview} alt="Preview" className="mx-auto max-h-40 object-contain rounded-lg" />
            ) : (
              <div className="text-gray-400">
                <Camera className="h-10 w-10 mx-auto mb-2 text-gray-300" />
                <p className="text-sm">{lang === 'zh' ? '点击选择照片' : 'Click to choose a photo'}</p>
                <p className="text-xs mt-1">{lang === 'zh' ? '支持 JPG / PNG，最大 10 MB' : 'JPG or PNG, max 10 MB'}</p>
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Photo taken date (optional) */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {lang === 'zh' ? '照片拍摄日期（可选，有助于提高匹配权重）' : 'Photo taken date (optional — improves match weighting)'}
            </label>
            <input
              type="date"
              value={takenAt}
              onChange={e => setTakenAt(e.target.value)}
              className="input-field max-w-xs"
            />
          </div>

          {msg && <p className="text-sm text-green-600">{msg}</p>}

          <button
            type="submit"
            disabled={!file || uploading}
            className="btn-primary flex items-center gap-2 disabled:opacity-40"
          >
            {uploading
              ? <><Loader2 className="h-4 w-4 animate-spin" />{lang === 'zh' ? '上传中…' : 'Uploading…'}</>
              : <><Upload className="h-4 w-4" />{lang === 'zh' ? '上传' : 'Upload'}</>
            }
          </button>
        </form>
      </div>

      {/* ── Reference photo list ── */}
      <div>
        <h2 className="font-semibold text-gray-800 mb-3">
          {lang === 'zh' ? '当前参考照片' : 'Current References'}
        </h2>

        {loading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 rounded-xl bg-gray-100 animate-pulse" />
            ))}
          </div>
        ) : refs.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <Camera className="h-10 w-10 mx-auto mb-2 text-gray-300" />
            <p className="text-sm">
              {lang === 'zh'
                ? '还没有参考照片。从活动照片中添加，或在上方上传。'
                : 'No reference photos yet. Add from a race photo or upload above.'}
            </p>
          </div>
        ) : (
          <ul className="space-y-3">
            {refs.map(ref => (
              <li
                key={ref.id}
                className={`flex items-center gap-4 p-4 rounded-xl border transition-colors ${
                  !ref.isFresh ? 'border-yellow-200 bg-yellow-50' : 'border-gray-200 bg-white'
                }`}
              >
                {/* Thumb */}
                <div className="w-16 h-16 rounded-lg overflow-hidden bg-gray-100 flex-shrink-0">
                  {ref.blobUrl
                    ? <Image src={ref.blobUrl} alt="Reference" className="w-full h-full object-cover" />
                    : <div className="w-full h-full flex items-center justify-center text-gray-300">
                        <Camera className="h-6 w-6" />
                      </div>
                  }
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      ref.source === 'direct_upload'
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-600'
                    }`}>
                      {ref.source === 'direct_upload'
                        ? (lang === 'zh' ? '直接上传' : 'Uploaded')
                        : (lang === 'zh' ? '活动截图' : 'Event crop')}
                    </span>
                    {!ref.isFresh && (
                      <span className="text-xs flex items-center gap-1 text-yellow-700">
                        <AlertTriangle className="h-3 w-3" />
                        {lang === 'zh' ? '照片较旧' : 'Older than 3 years'}
                      </span>
                    )}
                  </div>

                  {ref.photoTakenAt && (
                    <p className="text-xs text-gray-500 mt-1">
                      {lang === 'zh' ? '拍摄日期：' : 'Taken: '}
                      {new Date(ref.photoTakenAt).toLocaleDateString()}
                    </p>
                  )}
                  <p className="text-xs text-gray-400 mt-0.5">
                    {lang === 'zh' ? '添加时间：' : 'Added: '}
                    {new Date(ref.addedAt).toLocaleDateString()}
                  </p>
                </div>

                {/* Remove button */}
                <button
                  onClick={() => handleDelete(ref)}
                  className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors flex-shrink-0"
                  aria-label={lang === 'zh' ? '删除' : 'Remove'}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Tips */}
      <div className="card p-4 bg-gray-50 border-0">
        <h3 className="text-sm font-semibold text-gray-700 mb-2">
          {lang === 'zh' ? '提高匹配准确度的建议' : 'Tips for better matches'}
        </h3>
        <ul className="text-xs text-gray-500 space-y-1">
          {[
            lang === 'zh' ? '添加正面、清晰、光线好的照片' : 'Use front-facing, clear, well-lit photos',
            lang === 'zh' ? '避免遮脸、戴帽子或墨镜的照片' : 'Avoid photos with hats, sunglasses, or face coverings',
            lang === 'zh' ? '每年更新一次参考照片' : 'Refresh your reference photos yearly',
            lang === 'zh' ? '多角度照片有助于提高识别率' : 'Multiple angles improve recognition rates',
          ].map((tip, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <span className="text-brand-orange mt-0.5">•</span>
              {tip}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
