'use client'

// ============================================================
// /faq — Frequently Asked Questions about the MMR Member Portal
// ============================================================

import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useLang } from '@/lib/i18n/context'

interface FAQItem {
  q: string
  qZh: string
  a: React.ReactNode
  aZh: React.ReactNode
}

const FAQS: FAQItem[] = [
  {
    q:    "I'm an existing MMR member. How do I log in to the new portal?",
    qZh:  '我是现有会员，如何登录新的会员中心？',
    a: (
      <div className="space-y-3 text-sm text-gray-700">
        <p>You have two options:</p>
        <ol className="list-decimal list-inside space-y-2 ml-2">
          <li>
            <strong>Google or Microsoft login</strong> — Click "Continue with Google" or
            "Continue with Microsoft" on the{' '}
            <a href="/login" className="text-[#1F497D] underline">login page</a>. Use the
            same email address you gave us when you joined.
          </li>
          <li>
            <strong>Email + password</strong> — If you prefer a password, visit{' '}
            <a href="/auth/setup-password" className="text-[#1F497D] underline">
              Set up your portal password
            </a>{' '}
            to receive a one-time link by email.
          </li>
        </ol>
        <p className="text-xs text-gray-500">
          登录方式：使用 Google / Microsoft 账号（与加入时填写的邮箱一致），或通过邮件设置密码登录。
        </p>
      </div>
    ),
    aZh: (
      <div className="space-y-3 text-sm text-gray-700">
        <p>您有两种登录方式：</p>
        <ol className="list-decimal list-inside space-y-2 ml-2">
          <li>
            <strong>Google 或 Microsoft 登录</strong> — 在
            <a href="/login" className="text-[#1F497D] underline ml-1">登录页</a>
            点击"使用 Google 登录"或"使用 Microsoft 登录"，使用您加入时填写的邮箱地址。
          </li>
          <li>
            <strong>邮箱 + 密码</strong> — 访问{' '}
            <a href="/auth/setup-password" className="text-[#1F497D] underline">
              首次设置密码
            </a>{' '}
            页面，我们将发送一次性设置链接到您的邮箱。
          </li>
        </ol>
      </div>
    ),
  },
  {
    q:    "I've never set a password. How do I access the portal for the first time?",
    qZh:  '我从未设置过密码，如何首次登录？',
    a: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          Because the portal is new, existing members don't have a password yet — but your
          member profile is already in our system.
        </p>
        <p>
          Go to{' '}
          <a href="/auth/setup-password" className="text-[#1F497D] underline font-medium">
            Set up your portal password →
          </a>
        </p>
        <p>
          Enter the email address you used when you joined MMR. We'll send you a secure
          one-time link to create your new password. The link expires in 60 minutes.
        </p>
        <p className="text-xs text-gray-500">
          现有会员请前往"首次设置密码"页面，输入加入时的邮箱，我们将发送一次性设置链接。
        </p>
      </div>
    ),
    aZh: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          由于会员中心是新系统，现有会员尚未设置密码，但您的会员档案已在系统中。
        </p>
        <p>
          请前往{' '}
          <a href="/auth/setup-password" className="text-[#1F497D] underline font-medium">
            首次设置密码 →
          </a>
        </p>
        <p>
          输入您加入岚山跑团时填写的邮箱地址，我们将发送一次性设置链接（有效期 60 分钟）。
        </p>
      </div>
    ),
  },
  {
    q:    'I forgot my password. How do I reset it?',
    qZh:  '我忘记了密码，如何重置？',
    a: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          Visit the{' '}
          <a href="/auth/forgot-password" className="text-[#1F497D] underline">
            Forgot Password
          </a>{' '}
          page, enter your email, and we'll send you a reset link.
        </p>
        <p>
          <strong>Didn't receive the email?</strong> Check your spam / junk folder first.
          Some email providers (especially corporate or custom domains) may filter our
          messages. If you still don't see it after a few minutes, contact{' '}
          <a href="mailto:web@mmrunners.org" className="text-[#1F497D] underline">
            web@mmrunners.org
          </a>{' '}
          and we'll help you get in.
        </p>
        <p className="text-xs text-gray-500">
          如未收到重置邮件，请先检查垃圾邮件文件夹。仍未收到请联系 web@mmrunners.org。
        </p>
      </div>
    ),
    aZh: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          访问{' '}
          <a href="/auth/forgot-password" className="text-[#1F497D] underline">
            忘记密码
          </a>{' '}
          页面，输入您的邮箱，我们将发送重置链接。
        </p>
        <p>
          <strong>没有收到邮件？</strong> 请先检查垃圾邮件文件夹。若几分钟后仍未收到，请联系{' '}
          <a href="mailto:web@mmrunners.org" className="text-[#1F497D] underline">
            web@mmrunners.org
          </a>
          ，我们将协助您登录。
        </p>
      </div>
    ),
  },
  {
    q:    'My account shows "Pending" or "Inactive". What does that mean?',
    qZh:  '我的账号显示"待审核"或"未激活"，这是什么意思？',
    a: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          <strong>Pending</strong> means we received your membership application and payment
          submission, and our team is reviewing it. Approval typically takes 1–2 business
          days. You'll get a confirmation email once approved.
        </p>
        <p>
          <strong>Inactive</strong> means your membership has lapsed or hasn't been
          activated yet. You can{' '}
          <a href="/join" className="text-[#1F497D] underline">renew or join here →</a>
        </p>
        <p>
          If you believe your status is wrong (e.g. you paid but are still seeing Inactive),
          use the <strong>"I already renewed — check my status"</strong> button on the
          membership status page, or contact{' '}
          <a href="mailto:admin@mmrunners.org" className="text-[#1F497D] underline">
            admin@mmrunners.org
          </a>.
        </p>
      </div>
    ),
    aZh: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          <strong>待审核</strong>：我们已收到您的申请和付款信息，正在审核中。通常 1–2 个工作日内完成，审核通过后您将收到确认邮件。
        </p>
        <p>
          <strong>未激活</strong>：您的会员资格尚未激活或已到期。请前往
          <a href="/join" className="text-[#1F497D] underline ml-1">续费或加入 →</a>
        </p>
        <p>
          如果您认为状态有误（如已付款但仍显示未激活），请点击会员状态页的"我已续费，查询状态"按钮，或联系{' '}
          <a href="mailto:admin@mmrunners.org" className="text-[#1F497D] underline">
            admin@mmrunners.org
          </a>。
        </p>
      </div>
    ),
  },
  {
    q:    'My membership is active but I still can\'t access some features. Why?',
    qZh:  '我的会员已激活，但仍无法访问某些功能，为什么？',
    a: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          Your browser may be holding on to an old session. Try these steps:
        </p>
        <ol className="list-decimal list-inside space-y-1 ml-2">
          <li>On the membership status page, click <strong>"I already renewed — check my status"</strong>.</li>
          <li>If that doesn't work, log out and log back in.</li>
          <li>Clear your browser cache / cookies if the issue persists.</li>
        </ol>
        <p>
          Still stuck? Email{' '}
          <a href="mailto:web@mmrunners.org" className="text-[#1F497D] underline">
            web@mmrunners.org
          </a>{' '}
          with your member email and we'll sort it out.
        </p>
      </div>
    ),
    aZh: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>您的浏览器可能缓存了旧的会话信息。请尝试：</p>
        <ol className="list-decimal list-inside space-y-1 ml-2">
          <li>在会员状态页点击"我已续费，查询状态"。</li>
          <li>退出后重新登录。</li>
          <li>清除浏览器缓存 / Cookie。</li>
        </ol>
        <p>
          如问题持续，请发送邮件至{' '}
          <a href="mailto:web@mmrunners.org" className="text-[#1F497D] underline">
            web@mmrunners.org
          </a>
          ，附上您的会员邮箱，我们将为您处理。
        </p>
      </div>
    ),
  },
  {
    q:    'How do I renew my membership?',
    qZh:  '如何续费会员？',
    a: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          Go to the <a href="/join" className="text-[#1F497D] underline font-medium">Join / Renew page →</a>
        </p>
        <p>
          If you're already logged in, your information will be pre-filled. Select your plan,
          send payment via Zelle or Venmo, and submit the payment confirmation details. Our
          team reviews renewals within 1–2 business days.
        </p>
        <p className="text-xs text-gray-500">
          前往"加入/续费"页面。已登录会员的信息会自动填充。选择套餐后通过 Zelle 或 Venmo 付款，提交付款信息，我们将在 1–2 个工作日内完成审核。
        </p>
      </div>
    ),
    aZh: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          前往 <a href="/join" className="text-[#1F497D] underline font-medium">加入/续费页面 →</a>
        </p>
        <p>
          已登录会员的信息会自动填充。选择套餐后通过 Zelle 或 Venmo 付款，提交付款信息，我们将在 1–2 个工作日内完成审核。
        </p>
      </div>
    ),
  },
  {
    q:    'How do I update my profile information?',
    qZh:  '如何更新我的个人信息？',
    a: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          Log in and go to <strong>Portal → Profile</strong> (
          <a href="/portal/profile" className="text-[#1F497D] underline">/portal/profile</a>
          ). You can update your name, phone, WeChat ID, borough, year of birth, and NYRR
          Runner Name there.
        </p>
        <p>
          Your NYRR Runner Name must match exactly what appears on{' '}
          <a href="https://www.nyrr.org" className="text-[#1F497D] underline" target="_blank" rel="noopener noreferrer">
            nyrr.org
          </a>{' '}
          for automatic race-result syncing to work.
        </p>
      </div>
    ),
    aZh: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          登录后前往 <strong>会员中心 → 个人信息</strong>（
          <a href="/portal/profile" className="text-[#1F497D] underline">/portal/profile</a>
          ），可更新姓名、电话、微信号、地区、出生年份和 NYRR 跑者姓名。
        </p>
        <p>
          NYRR 跑者姓名必须与{' '}
          <a href="https://www.nyrr.org" className="text-[#1F497D] underline" target="_blank" rel="noopener noreferrer">
            nyrr.org
          </a>{' '}
          上的完全一致，才能自动同步比赛成绩。
        </p>
      </div>
    ),
  },
  {
    q:    "I don't see my race results on the portal.",
    qZh:  '我的比赛成绩在会员中心中没有显示。',
    a: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>Race results sync automatically from NYRR using your NYRR Runner Name.</p>
        <p>
          Make sure your <strong>NYRR Runner Name</strong> in your profile (
          <a href="/portal/profile" className="text-[#1F497D] underline">/portal/profile</a>
          ) matches your name on NYRR.org exactly — including capitalization and any hyphens.
        </p>
        <p>
          Results for very recent events may take a day or two to appear after the race
          finishes and NYRR publishes the official results.
        </p>
      </div>
    ),
    aZh: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>比赛成绩通过 NYRR 跑者姓名自动同步。</p>
        <p>
          请确认您在
          <a href="/portal/profile" className="text-[#1F497D] underline mx-1">/portal/profile</a>
          中填写的 NYRR 跑者姓名与 nyrr.org 上完全一致（包括大小写和连字符）。
        </p>
        <p>
          最近比赛的成绩可能需要 1–2 天才能在 NYRR 官方发布后同步到会员中心。
        </p>
      </div>
    ),
  },
  {
    q:    'Who do I contact if I need help?',
    qZh:  '如有疑问，我应该联系谁？',
    a: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          For <strong>portal / website issues</strong>:{' '}
          <a href="mailto:web@mmrunners.org" className="text-[#1F497D] underline font-medium">
            web@mmrunners.org
          </a>
        </p>
        <p>
          For <strong>membership, payments, or general inquiries</strong>:{' '}
          <a href="mailto:admin@mmrunners.org" className="text-[#1F497D] underline font-medium">
            admin@mmrunners.org
          </a>
        </p>
        <p className="text-xs text-gray-500">
          会员中心技术问题：web@mmrunners.org · 会籍、付款及一般咨询：admin@mmrunners.org
        </p>
      </div>
    ),
    aZh: (
      <div className="space-y-2 text-sm text-gray-700">
        <p>
          <strong>会员中心技术问题</strong>：{' '}
          <a href="mailto:web@mmrunners.org" className="text-[#1F497D] underline font-medium">
            web@mmrunners.org
          </a>
        </p>
        <p>
          <strong>会籍、付款及一般咨询</strong>：{' '}
          <a href="mailto:admin@mmrunners.org" className="text-[#1F497D] underline font-medium">
            admin@mmrunners.org
          </a>
        </p>
      </div>
    ),
  },
]

function FAQAccordion({ item, defaultOpen = false }: { item: FAQItem; defaultOpen?: boolean }) {
  const { lang } = useLang()
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="border border-gray-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-5 py-4 text-left bg-white hover:bg-gray-50 transition-colors"
      >
        <span className="font-semibold text-[#0A2342] text-sm pr-4">
          {lang === 'zh' ? item.qZh : item.q}
        </span>
        {open
          ? <ChevronDown className="h-4 w-4 text-gray-400 flex-shrink-0" />
          : <ChevronRight className="h-4 w-4 text-gray-400 flex-shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-1 border-t border-gray-100 bg-white">
          {lang === 'zh' ? item.aZh : item.a}
        </div>
      )}
    </div>
  )
}

export default function FAQPage() {
  const { lang } = useLang()

  return (
    <main className="min-h-screen bg-gray-50 py-14">
      <div className="max-w-2xl mx-auto px-4">

        {/* Header */}
        <div className="text-center mb-10">
          <h1 className="text-3xl font-bold text-[#0A2342]">
            {lang === 'zh' ? '常见问题' : 'Frequently Asked Questions'}
          </h1>
          <p className="text-gray-500 mt-2 text-sm">
            {lang === 'zh'
              ? '关于岚山跑团会员中心的常见问题解答'
              : 'Questions about the MMR Member Portal'}
          </p>
        </div>

        {/* Quick action links */}
        <div className="mb-8 grid grid-cols-1 sm:grid-cols-3 gap-3">
          {[
            { href: '/login',                label: lang === 'zh' ? '登录' : 'Log in',                  color: 'bg-[#0A2342] text-white' },
            { href: '/auth/setup-password',  label: lang === 'zh' ? '首次设置密码' : 'Set up password', color: 'bg-[#E86033] text-white' },
            { href: '/join',                 label: lang === 'zh' ? '加入 / 续费' : 'Join / Renew',     color: 'bg-white border border-gray-200 text-[#0A2342]' },
          ].map(btn => (
            <Link
              key={btn.href}
              href={btn.href}
              className={`flex items-center justify-center py-2.5 px-4 rounded-xl text-sm font-semibold text-center transition-opacity hover:opacity-90 ${btn.color}`}
            >
              {btn.label}
            </Link>
          ))}
        </div>

        {/* FAQ list */}
        <div className="space-y-3">
          {FAQS.map((item, i) => (
            <FAQAccordion key={i} item={item} defaultOpen={i === 0} />
          ))}
        </div>

        {/* Still need help */}
        <div className="mt-10 bg-[#0A2342] rounded-2xl p-6 text-center text-white">
          <h2 className="font-bold text-lg mb-2">
            {lang === 'zh' ? '还有疑问？' : 'Still have questions?'}
          </h2>
          <p className="text-white/70 text-sm mb-4">
            {lang === 'zh'
              ? '随时联系我们，我们很乐意帮助您。'
              : 'We\'re happy to help — just send us an email.'}
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <a
              href="mailto:web@mmrunners.org"
              className="inline-block bg-white text-[#0A2342] font-semibold text-sm px-5 py-2.5 rounded-full hover:bg-gray-100 transition-colors"
            >
              web@mmrunners.org
            </a>
            <a
              href="mailto:admin@mmrunners.org"
              className="inline-block border border-white/40 text-white font-semibold text-sm px-5 py-2.5 rounded-full hover:border-white/80 transition-colors"
            >
              admin@mmrunners.org
            </a>
          </div>
        </div>

      </div>
    </main>
  )
}
