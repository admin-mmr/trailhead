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
      <h2 className="text-xl font-semibold text-[#0A2342] mb-6">
        {lang === 'zh' ? '选择会员套餐' : 'Choose Your Membership Plan'}
      </h2>
      <div className="grid gap-4">
        {(Object.entries(PLANS) as [Plan, PlanInfo][]).map(([key, p]) => (
          <label key={key}
            className={`flex items-start gap-4 p-4 border-2 rounded-xl cursor-pointer transition-colors
              ${plan === key ? 'border-[#F47B20] bg-orange-50' : 'border-gray-200 hover:border-gray-300'}`}>
            <input type="radio" name="plan" value={key} checked={plan === key}
              onChange={() => setPlan(key)} className="mt-1" />
            <div className="flex-1">
              <div className="flex justify-between items-center">
                <span className="font-semibold text-[#0A2342]">
                  {lang === 'zh' ? p.labelZh : p.label}
                </span>
                <span className="text-xl font-bold text-[#F47B20]">${p.amount}</span>
              </div>
              <p className="text-sm text-gray-500 mt-1">
                {lang === 'zh' ? p.descZh : p.desc}
              </p>
            </div>
          </label>
        ))}
      </div>
      <button onClick={nextStep}
        className="mt-8 w-full bg-[#0A2342] text-white py-3 rounded-xl font-semibold hover:bg-[#0d2d55] transition-colors">
        {lang === 'zh' ? '继续' : 'Continue →'}
      </button>
    </div>
  )
}
