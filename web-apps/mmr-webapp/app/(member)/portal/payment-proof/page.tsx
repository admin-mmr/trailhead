'use client'

import { useState, useRef, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { useLang } from '@/lib/i18n/context'
import { Upload, CheckCircle, ArrowLeft } from 'lucide-react'

function PaymentProofContent() {
  const { lang } = useLang()
  const router = useRouter()
  const searchParams = useSearchParams()
  const eventId = searchParams.get('eventId') ?? ''

  const [proofFile, setProofFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!proofFile || !eventId) return
    setSubmitting(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('proof', proofFile)
      fd.append('eventId', eventId)
      const res = await fetch('/api/payments/proof', { method: 'POST', body: fd })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Upload failed')
      setDone(true)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setSubmitting(false)
    }
  }

  if (done) {
    return (
      <div className="text-center py-12">
        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-9 h-9 text-green-500" />
        </div>
        <h2 className="text-2xl font-bold text-[#0A2342] mb-2">
          {lang === 'zh' ? '截图上传成功！' : 'Screenshot Uploaded!'}
        </h2>
        <p className="text-gray-600 mb-6">
          {lang === 'zh'
            ? '我们将尽快完成审核并激活您的会员资格。'
            : 'We\'ll review your payment and activate your membership shortly.'}
        </p>
        <button onClick={() => router.push('/portal')}
          className="bg-[#0A2342] text-white px-8 py-3 rounded-xl font-semibold hover:bg-[#0d2d55] transition-colors">
          {lang === 'zh' ? '返回会员中心' : 'Back to Portal'}
        </button>
      </div>
    )
  }

  return (
    <div>
      <button onClick={() => router.back()}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-6">
        <ArrowLeft className="w-4 h-4" />
        {lang === 'zh' ? '返回' : 'Back'}
      </button>

      <h1 className="text-2xl font-bold text-[#0A2342] mb-2">
        {lang === 'zh' ? '上传付款截图' : 'Upload Payment Screenshot'}
      </h1>
      <p className="text-gray-500 text-sm mb-2">
        {lang === 'zh'
          ? '请上传您的 Zelle 或 Venmo 付款成功截图。'
          : 'Please upload your Zelle or Venmo payment confirmation screenshot.'}
      </p>
      {eventId && (
        <p className="text-xs text-gray-400 mb-6">
          {lang === 'zh' ? '参考号：' : 'Reference: '}
          <span className="font-mono font-semibold text-gray-600">{eventId}</span>
        </p>
      )}

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div
          className="border-2 border-dashed border-gray-300 rounded-xl p-10 text-center cursor-pointer hover:border-[#F47B20] transition-colors"
          onClick={() => fileRef.current?.click()}
          onDragOver={e => e.preventDefault()}
          onDrop={e => {
            e.preventDefault()
            const f = e.dataTransfer.files[0]
            if (f) setProofFile(f)
          }}>
          <Upload className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          {proofFile ? (
            <p className="text-sm font-medium text-[#0A2342]">{proofFile.name}</p>
          ) : (
            <>
              <p className="text-sm font-medium text-gray-700">
                {lang === 'zh' ? '点击或拖拽上传截图' : 'Click or drag & drop your screenshot'}
              </p>
              <p className="text-xs text-gray-400 mt-1">PNG, JPG, HEIC up to 10 MB</p>
            </>
          )}
          <input ref={fileRef} type="file" accept="image/*,.heic" className="hidden"
            onChange={e => { if (e.target.files?.[0]) setProofFile(e.target.files[0]) }} />
        </div>

        <button type="submit" disabled={!proofFile || submitting}
          className="mt-6 w-full bg-[#0A2342] text-white py-3 rounded-xl font-semibold hover:bg-[#0d2d55] transition-colors disabled:opacity-50">
          {submitting
            ? (lang === 'zh' ? '上传中…' : 'Uploading…')
            : (lang === 'zh' ? '提交截图' : 'Submit Screenshot')}
        </button>
      </form>
    </div>
  )
}

export default function PaymentProofPage() {
  return (
    <main className="min-h-screen bg-gray-50 py-12">
      <div className="max-w-lg mx-auto px-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
          <Suspense fallback={<div className="text-gray-400 text-sm">Loading…</div>}>
            <PaymentProofContent />
          </Suspense>
        </div>
      </div>
    </main>
  )
}
