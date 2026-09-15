import { SUGGESTED_AMOUNTS, type DonateForm } from './shared'

interface AmountStepProps {
  lang: string
  amount: string
  setAmount: (v: string) => void
  customAmount: string
  setCustomAmount: (v: string) => void
  payForm: DonateForm
  setPayForm: React.Dispatch<React.SetStateAction<DonateForm>>
  donateAmount: number
  nextStep: () => void
}

export function AmountStep(props: AmountStepProps) {
  const { lang, amount, setAmount, customAmount, setCustomAmount, payForm, setPayForm, donateAmount, nextStep } = props

  return (
    <div>
      <h2 className="text-xl font-semibold text-lantern-ink mb-6">
        {lang === 'zh' ? '选择捐赠金额' : 'Choose Your Donation Amount'}
      </h2>
      <div className="grid grid-cols-2 gap-3 mb-6">
        {SUGGESTED_AMOUNTS.map(a => (
          <button key={a} type="button"
            onClick={() => { setAmount(String(a)); setCustomAmount('') }}
            className={`py-4 rounded-xl border-2 font-bold text-lg transition-colors
              ${amount === String(a) ? 'border-brand-crimson bg-lantern-gold-tint text-brand-crimson' : 'border-lantern-line text-lantern-ink-soft hover:border-lantern-gold-foil'}`}>
            ${a}
          </button>
        ))}
      </div>
      <div>
        <label className="block text-sm font-medium text-lantern-ink mb-1">
          {lang === 'zh' ? '或输入自定义金额' : 'Or enter a custom amount'}
        </label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-lantern-ink-soft/60 font-semibold">$</span>
          <input
            type="number"
            min="1"
            step="1"
            value={customAmount}
            onChange={e => { setCustomAmount(e.target.value); setAmount('') }}
            placeholder="0"
            className="w-full pl-8 pr-4 py-3 border border-lantern-line rounded-xl text-lg font-semibold focus:outline-none focus:ring-2 focus:ring-brand-crimson"
          />
        </div>
      </div>

      {/* Donor info */}
      <div className="mt-6 space-y-4">
        <h3 className="font-semibold text-lantern-ink">
          {lang === 'zh' ? '捐赠人信息' : 'Donor Information'}
        </h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-lantern-ink mb-1">
              {lang === 'zh' ? '名' : 'First Name'} <span className="text-red-500">*</span>
            </label>
            <input required value={payForm.firstName}
              onChange={e => setPayForm(p => ({ ...p, firstName: e.target.value }))}
              className="w-full px-3 py-2 border border-lantern-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-crimson" />
          </div>
          <div>
            <label className="block text-sm font-medium text-lantern-ink mb-1">
              {lang === 'zh' ? '姓' : 'Last Name'} <span className="text-red-500">*</span>
            </label>
            <input required value={payForm.lastName}
              onChange={e => setPayForm(p => ({ ...p, lastName: e.target.value }))}
              className="w-full px-3 py-2 border border-lantern-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-crimson" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-lantern-ink mb-1">
            {lang === 'zh' ? '电子邮件' : 'Email'} <span className="text-red-500">*</span>
          </label>
          <input type="email" required value={payForm.email}
            onChange={e => setPayForm(p => ({ ...p, email: e.target.value }))}
            className="w-full px-3 py-2 border border-lantern-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-crimson" />
        </div>
        <div>
          <label className="block text-sm font-medium text-lantern-ink mb-1">
            {lang === 'zh' ? '电话（可选）' : 'Phone (optional)'}
          </label>
          <input type="tel" value={payForm.phone}
            onChange={e => setPayForm(p => ({ ...p, phone: e.target.value }))}
            className="w-full px-3 py-2 border border-lantern-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-crimson" />
        </div>
      </div>

      <button
        onClick={() => { if (donateAmount > 0) nextStep() }}
        disabled={donateAmount <= 0 || !payForm.firstName || !payForm.lastName || !payForm.email}
        className="mt-8 w-full bg-brand-crimson text-white py-3 rounded-xl font-semibold hover:bg-brand-crimson-dark transition-colors disabled:opacity-50">
        {lang === 'zh' ? `继续 · $${donateAmount}` : `Continue · $${donateAmount}`}
      </button>
    </div>
  )
}
