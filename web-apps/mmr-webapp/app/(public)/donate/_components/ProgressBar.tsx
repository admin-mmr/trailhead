import { CheckCircle } from 'lucide-react'
import { STEPS, type Step } from './shared'

/**
 * Donation stepper — identical Lantern treatment to the join flow.
 * See join/_components/ProgressBar.tsx for why completed steps are gold.
 */

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
                ${done ? 'bg-lantern-gold border-lantern-gold text-white' : active ? 'bg-brand-crimson border-brand-crimson text-white' : 'bg-white border-lantern-line text-lantern-ink-soft/60'}`}>
                {done ? <CheckCircle className="w-5 h-5" /> : s.icon}
              </div>
              <span className={`mt-1.5 text-xs font-medium ${active ? 'text-lantern-ink' : done ? 'text-lantern-gold' : 'text-lantern-ink-soft/60'}`}>
                {lang === 'zh' ? s.labelZh : s.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 flex-1 mx-1 mb-5 rounded ${i < stepIndex ? 'bg-lantern-gold-foil' : 'bg-lantern-line'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}
