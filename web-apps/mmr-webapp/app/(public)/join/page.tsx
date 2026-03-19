'use client'

import { useState } from 'react'
import { useLang } from '@/lib/i18n/context'
import { Check, Loader2 } from 'lucide-react'
import { loadStripe } from '@stripe/stripe-js'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

const INDIVIDUAL_BENEFITS = [
  { en: 'Official MMR Member ID card',      zh: '官方会员编号证书' },
  { en: 'NYRR club team eligibility',       zh: 'NYRR 队伍参赛资格' },
  { en: 'Member-only group runs',            zh: '专属会员集训' },
  { en: 'Race gear discounts (10–20%)',      zh: '比赛装备折扣 10–20%' },
  { en: 'Access to member portal & results', zh: '会员中心及成绩查询' },
]

const FAMILY_BENEFITS = [
  { en: 'All Individual benefits',          zh: '所有个人会员权益' },
  { en: 'Up to 4 family members',           zh: '最多4名家庭成员' },
  { en: 'Family team race registration',    zh: '家庭团队参赛' },
]

export default function JoinPage() {
  const { T, lang } = useLang()
  const [selected, setSelected] = useState<'individual' | 'family'>('individual')
  const [loading,  setLoading]  = useState(false)
  const [form, setForm] = useState({
    email: '', englishName: '', chineseName: '', phone: '', wechatId: '',
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      // 1. Create/ensure member record
      const memberRes = await fetch('/api/members/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, membershipType: selected }),
      })
      const memberData = await memberRes.json()
      if (!memberData.ok) throw new Error(memberData.error)

      // 2. Create Stripe checkout session
      const checkoutRes = await fetch('/api/stripe/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          memberId:       memberData.data.memberId,
          membershipType: selected,
        }),
      })
      const checkoutData = await checkoutRes.json()
      if (!checkoutData.ok) throw new Error(checkoutData.error)

      // 3. Redirect to Stripe
      const stripe = await stripePromise
      await stripe?.redirectToCheckout({ sessionId: checkoutData.data.sessionId })
    } catch (err: any) {
      alert(err.message ?? T('common.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="py-20">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-12">
          <h1 className="section-title">{T('join.title')}</h1>
          <p className="section-subtitle">
            {lang === 'zh' ? '选择适合您的会员套餐' : 'Choose the plan that works for you'}
          </p>
        </div>

        {/* Plan selector */}
        <div className="grid md:grid-cols-2 gap-6 mb-12">
          {(['individual', 'family'] as const).map(type => {
            const isSelected = selected === type
            const benefits   = type === 'individual' ? INDIVIDUAL_BENEFITS : FAMILY_BENEFITS
            return (
              <button
                key={type}
                onClick={() => setSelected(type)}
                className={`card p-8 text-left transition-all ${
                  isSelected
                    ? 'border-2 border-brand-orange ring-2 ring-brand-orange/20'
                    : 'border-2 border-transparent hover:border-gray-200'
                }`}
              >
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-brand-navy">
                      {lang === 'zh'
                        ? (type === 'individual' ? '个人会员' : '家庭会员')
                        : (type === 'individual' ? 'Individual' : 'Family')}
                    </h3>
                    <p className="text-3xl font-bold text-brand-orange mt-1">
                      {type === 'individual' ? '$30' : '$50'}
                      <span className="text-base font-normal text-gray-400 ml-1">
                        / {lang === 'zh' ? '年' : 'year'}
                      </span>
                    </p>
                  </div>
                  <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center ${
                    isSelected ? 'border-brand-orange bg-brand-orange' : 'border-gray-300'
                  }`}>
                    {isSelected && <Check className="h-3 w-3 text-white" />}
                  </div>
                </div>
                <ul className="space-y-2">
                  {benefits.map((b, i) => (
                    <li key={i} className="flex items-center gap-2 text-sm text-gray-600">
                      <Check className="h-4 w-4 text-green-500 flex-shrink-0" />
                      {lang === 'zh' ? b.zh : b.en}
                    </li>
                  ))}
                </ul>
              </button>
            )
          })}
        </div>

        {/* Registration form */}
        <div className="card p-8 max-w-2xl mx-auto">
          <h2 className="text-xl font-bold text-brand-navy mb-6">
            {lang === 'zh' ? '填写注册信息' : 'Your Information'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {lang === 'zh' ? '英文姓名' : 'English Name'}
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={form.englishName}
                  onChange={e => setForm(f => ({ ...f, englishName: e.target.value }))}
                  placeholder={lang === 'zh' ? 'John Smith' : 'John Smith'}
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {lang === 'zh' ? '中文姓名' : '中文姓名 (optional)'}
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={form.chineseName}
                  onChange={e => setForm(f => ({ ...f, chineseName: e.target.value }))}
                  placeholder="张三"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {lang === 'zh' ? '邮箱地址' : 'Email Address'}
              </label>
              <input
                type="email"
                className="input-field"
                value={form.email}
                onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="you@example.com"
                required
              />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  {lang === 'zh' ? '电话' : 'Phone (optional)'}
                </label>
                <input
                  type="tel"
                  className="input-field"
                  value={form.phone}
                  onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                  placeholder="+1 (212) 555-0000"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  WeChat ID {lang === 'zh' ? '（可选）' : '(optional)'}
                </label>
                <input
                  type="text"
                  className="input-field"
                  value={form.wechatId}
                  onChange={e => setForm(f => ({ ...f, wechatId: e.target.value }))}
                  placeholder="wechat_id"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full flex items-center justify-center gap-2 mt-2"
            >
              {loading && <Loader2 className="h-4 w-4 animate-spin" />}
              {lang === 'zh' ? '继续至付款 →' : 'Continue to Payment →'}
            </button>

            <p className="text-center text-xs text-gray-400">
              {lang === 'zh'
                ? '安全支付由 Stripe 处理。支付完成后会员立即激活。'
                : 'Secure payment via Stripe. Membership activates immediately after payment.'}
            </p>
          </form>
        </div>
      </div>
    </div>
  )
}
