import { CheckCircle } from 'lucide-react'
import { STEPS, type Step } from './shared'

export function ProgressBar({ lang, step, stepIndex }: { lang: string; step: Step; stepIndex: number }) {
  return (
    <div className="flex items-center justify-between mb-10">
      {STEPS.map((s, i) => {
        const done = i < stepIndex
        const active = s.id === step
        return (
          <div key={s.id} className="flex items-center flex-1">
            <div className={`flex flex-col items-center ${i < STEPS.length - 1 ? 'flex-1' : ''}`}>
              <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold border-2 transition-colors
                ${done ? 'bg-green-500 border-green-500 text-white' : active ? 'bg-[#C8102E] border-[#C8102E] text-white' : 'bg-white border-gray-300 text-gray-400'}`}>
                {done ? <CheckCircle className="w-5 h-5" /> : s.icon}
              </div>
              <span className={`mt-1 text-xs font-medium ${active ? 'text-[#C8102E]' : done ? 'text-green-600' : 'text-gray-400'}`}>
                {lang === 'zh' ? s.labelZh : s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 mb-5 rounded ${i < stepIndex ? 'bg-green-400' : 'bg-gray-200'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
