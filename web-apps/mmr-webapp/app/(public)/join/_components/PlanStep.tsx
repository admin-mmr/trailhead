import { PLANS, type Plan, type PlanInfo } from './shared'

interface PlanStepProps {
  lang: string
  plan: Plan
  setPlan: (p: Plan) => void
  nextStep: () => void
}

export function PlanStep({ lang, plan, setPlan, nextStep }: PlanStepProps) {
  return (
    <div>
      <h2 className="text-xl font-semibold text-lantern-ink mb-6">
        {lang === 'zh' ? '选择会员套餐' : 'Choose Your Membership Plan'}
      </h2>
      <div className="grid gap-4">
        {(Object.entries(PLANS) as [Plan, PlanInfo][]).map(([key, p]) => (
          <label key={key}
            className={`flex items-start gap-4 p-4 border-2 rounded-xl cursor-pointer transition-colors
              ${plan === key ? 'border-lantern-gold-foil bg-lantern-gold-tint' : 'border-lantern-line hover:border-lantern-gold-foil'}`}>
            <input type="radio" name="plan" value={key} checked={plan === key}
              onChange={() => setPlan(key)} className="mt-1" />
            <div className="flex-1">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-lantern-ink">
                  {lang === 'zh' ? p.labelZh : p.label}
                </span>
                <span className="text-xl font-bold text-lantern-gold">${p.amount}</span>
              </div>
              <p className="text-sm text-lantern-ink-soft mt-1">
                {lang === 'zh' ? p.descZh : p.desc}
              </p>
            </div>
          </label>
        ))}
      </div>
      <button onClick={nextStep}
        className="mt-8 w-full bg-brand-crimson text-white py-3 rounded-xl font-semibold hover:bg-brand-crimson-dark transition-colors">
        {lang === 'zh' ? '继续' : 'Continue →'}
      </button>
    </div>
  )
}
