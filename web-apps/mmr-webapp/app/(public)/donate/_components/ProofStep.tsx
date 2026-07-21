import { Upload, Loader2 } from 'lucide-react'

interface ProofStepProps {
  lang: string
  eventId: string | null
  proofFile: File | null
  setProofFile: (f: File | null) => void
  fileRef: React.RefObject<HTMLInputElement>
  submitting: boolean
  onSubmit: (e: React.FormEvent) => void
  onSkip: () => void
}

export function ProofStep(props: ProofStepProps) {
  const { lang, eventId, proofFile, setProofFile, fileRef, submitting, onSubmit, onSkip } = props

  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-xl font-semibold text-[#0A2342] mb-2">
        {lang === 'zh' ? '上传付款截图' : 'Upload Payment Screenshot'}
      </h2>
      <p className="text-sm text-gray-500 mb-2">
        {lang === 'zh'
          ? '请上传付款成功截图，帮助我们确认您的捐赠。'
          : 'Please upload a screenshot of your completed payment to help us confirm your donation.'}
      </p>
      {eventId && (
        <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700">
          {lang === 'zh' ? '参考号：' : 'Reference #: '}<strong>{eventId}</strong>
        </div>
      )}

      <div
        className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-[#C8102E] transition-colors"
        onClick={() => fileRef.current?.click()}
        onDragOver={e => e.preventDefault()}
        onDrop={e => {
          e.preventDefault()
          const f = e.dataTransfer.files[0]
          if (f) setProofFile(f)
        }}>
        <Upload className="w-10 h-10 text-gray-400 mx-auto mb-3" />
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

      <div className="flex gap-4 mt-8">
        <button type="button" onClick={onSkip}
          className="flex-1 border border-gray-300 text-gray-500 py-3 rounded-xl text-sm hover:bg-gray-50 transition-colors">
          {lang === 'zh' ? '跳过（稍后上传）' : 'Skip for now'}
        </button>
        <button type="submit" disabled={!proofFile || submitting}
          className="flex-1 bg-[#C8102E] text-white py-3 rounded-xl font-semibold hover:bg-[#a00d25] transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
          {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
          {submitting ? (lang === 'zh' ? '上传中…' : 'Uploading…') : (lang === 'zh' ? '提交截图' : 'Submit Screenshot →')}
        </button>
      </div>
    </form>
  )
}
