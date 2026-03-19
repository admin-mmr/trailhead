'use client'

import Link from 'next/link'
import { Trophy, Calendar, ArrowRight, AlertCircle } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'
import type { Member } from '@/types'

interface Props {
  member: Member | null
  payments: any[]
}

export default function DashboardClient({ member, payments }: Props) {
  const { lang } = useLang()

  if (!member) {
    return (
      <div className="card p-8 text-center">
        <AlertCircle className="h-10 w-10 text-yellow-500 mx-auto mb-3" />
        <p className="text-gray-600">
          {lang === 'zh' ? '未找到会员信息' : 'Member record not found.'}
        </p>
      </div>
    )
  }

  const expiryDate = member.expiresAt
    ? new Date(member.expiresAt).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')
    : '—'

  const daysUntilExpiry = member.expiresAt
    ? Math.ceil((new Date(member.expiresAt).getTime() - Date.now()) / 86400000)
    : null

  return (
    <div className="space-y-6">
      {/* Membership status banner */}
      {member.status !== 'active' && (
        <div className="bg-yellow-50 border border-yellow-200 rounded-2xl p-5 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-yellow-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-yellow-800 text-sm">
              {lang === 'zh' ? '会员尚未激活' : 'Membership not active'}
            </p>
            <p className="text-yellow-700 text-sm mt-0.5">
              {lang === 'zh'
                ? '请完成付款以激活您的会员资格。'
                : 'Complete payment to activate your membership.'}
            </p>
            <Link href="/join" className="text-brand-orange text-sm font-medium hover:underline mt-1 inline-block">
              {lang === 'zh' ? '立即付款 →' : 'Pay now →'}
            </Link>
          </div>
        </div>
      )}

      {daysUntilExpiry !== null && daysUntilExpiry <= 30 && member.status === 'active' && (
        <div className="bg-orange-50 border border-orange-200 rounded-2xl p-5">
          <p className="text-orange-700 text-sm font-medium">
            {lang === 'zh'
              ? `您的会员将于 ${expiryDate} 到期（还有 ${daysUntilExpiry} 天），请及时续费。`
              : `Your membership expires in ${daysUntilExpiry} days (${expiryDate}). Please renew soon.`}
          </p>
          <Link href="/join" className="text-brand-orange text-sm font-medium hover:underline mt-1 inline-block">
            {lang === 'zh' ? '立即续费 →' : 'Renew now →'}
          </Link>
        </div>
      )}

      {/* Member ID card */}
      <div className="bg-gradient-to-br from-brand-navy to-brand-navy-dark rounded-2xl p-7 text-white">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-white/50 text-xs uppercase tracking-wider mb-1">
              {lang === 'zh' ? '会员证' : 'Membership Card'}
            </p>
            <p className="text-2xl font-bold">{member.englishName ?? member.email}</p>
            {member.chineseName && (
              <p className="text-white/70 text-lg mt-0.5">{member.chineseName}</p>
            )}
          </div>
          <span className={`text-xs font-medium px-3 py-1 rounded-full ${
            member.status === 'active' ? 'bg-green-500/20 text-green-300' : 'bg-yellow-500/20 text-yellow-300'
          }`}>
            {member.status === 'active'
              ? (lang === 'zh' ? '有效' : 'Active')
              : (lang === 'zh' ? '未激活' : 'Inactive')}
          </span>
        </div>

        <div className="mt-6 pt-5 border-t border-white/20 grid grid-cols-2 gap-4">
          <div>
            <p className="text-white/40 text-xs">{lang === 'zh' ? '会员编号' : 'Member ID'}</p>
            <p className="text-brand-orange font-mono font-bold text-lg tracking-wider mt-0.5">
              {member.memberId}
            </p>
          </div>
          <div>
            <p className="text-white/40 text-xs">{lang === 'zh' ? '有效期至' : 'Valid Until'}</p>
            <p className="text-white font-semibold mt-0.5">{expiryDate}</p>
          </div>
          <div>
            <p className="text-white/40 text-xs">{lang === 'zh' ? '套餐类型' : 'Plan'}</p>
            <p className="text-white font-semibold mt-0.5">
              {member.membershipType === 'individual'
                ? (lang === 'zh' ? '个人会员' : 'Individual')
                : (lang === 'zh' ? '家庭会员' : 'Family')}
            </p>
          </div>
          <div>
            <p className="text-white/40 text-xs">NYRR ID</p>
            <p className="text-white font-semibold mt-0.5">{member.nyrrId ?? '—'}</p>
          </div>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid sm:grid-cols-2 gap-4">
        <Link href="/portal/nyrr" className="card p-5 flex items-center gap-4 hover:border-brand-orange/30 border-2 border-transparent transition-colors">
          <div className="w-12 h-12 bg-brand-orange/10 rounded-xl flex items-center justify-center">
            <Trophy className="h-6 w-6 text-brand-orange" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">
              {lang === 'zh' ? '我的比赛成绩' : 'NYRR Results'}
            </p>
            <p className="text-gray-500 text-sm">
              {lang === 'zh' ? '查看成绩图表' : 'Charts & personal bests'}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-gray-400 ml-auto" />
        </Link>
        <Link href="/portal/events" className="card p-5 flex items-center gap-4 hover:border-brand-orange/30 border-2 border-transparent transition-colors">
          <div className="w-12 h-12 bg-brand-navy/10 rounded-xl flex items-center justify-center">
            <Calendar className="h-6 w-6 text-brand-navy" />
          </div>
          <div>
            <p className="font-semibold text-gray-900">
              {lang === 'zh' ? '近期活动' : 'Upcoming Events'}
            </p>
            <p className="text-gray-500 text-sm">
              {lang === 'zh' ? '会员专属活动' : 'Member-only runs'}
            </p>
          </div>
          <ArrowRight className="h-4 w-4 text-gray-400 ml-auto" />
        </Link>
      </div>

      {/* Payment history */}
      {payments.length > 0 && (
        <div className="card p-6">
          <h3 className="font-bold text-gray-900 mb-4">
            {lang === 'zh' ? '付款记录' : 'Payment History'}
          </h3>
          <div className="space-y-3">
            {payments.slice(0, 3).map((p: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    {p.membership_type === 'individual'
                      ? (lang === 'zh' ? '个人会员' : 'Individual Membership')
                      : (lang === 'zh' ? '家庭会员' : 'Family Membership')}
                  </p>
                  <p className="text-xs text-gray-400">
                    {new Date(p.paid_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-semibold text-gray-900">${p.amount}</p>
                  <span className="badge-active">{lang === 'zh' ? '已支付' : 'Paid'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
