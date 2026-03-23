'use client'

import { useState, useEffect } from 'react'
import { useLang } from '@/lib/i18n/context'
import { Save, Loader2 } from 'lucide-react'
import type { Member } from '@/types'

export default function ProfilePage() {
  const { lang } = useLang()
  const [loading,  setLoading]  = useState(false)
  const [fetching, setFetching] = useState(true)
  const [saved,    setSaved]    = useState(false)

  // Read-only fields
  const [readOnly, setReadOnly] = useState({
    memberId: '', email: '', membershipType: '', joinYear: '', expiresAt: '',
  })

  // Editable fields
  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', wechatId: '',
    district: '', gender: '', yearBorn: '', nyrrRunnerName: '',
  })

  // Load existing profile data on mount
  useEffect(() => {
    fetch('/api/members/me')
      .then(r => r.json())
      .then(({ ok, data }: { ok: boolean; data: Member }) => {
        if (!ok) return
        setReadOnly({
          memberId:       data.memberId,
          email:          data.email,
          membershipType: data.membershipType === 'family' ? (lang === 'zh' ? '家庭' : 'Family') : (lang === 'zh' ? '个人' : 'Individual'),
          joinYear:       data.joinYear ? String(data.joinYear) : '',
          expiresAt:      data.expiresAt ? data.expiresAt.slice(0, 10) : '',
        })
        setForm({
          firstName:      data.firstName      ?? '',
          lastName:       data.lastName       ?? '',
          phone:          data.phone          ?? '',
          wechatId:       data.wechatId       ?? '',
          district:       data.district       ?? '',
          gender:         data.gender         ?? '',
          yearBorn:       data.yearBorn != null ? String(data.yearBorn) : '',
          nyrrRunnerName: data.nyrrRunnerName  ?? '',
        })
      })
      .finally(() => setFetching(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const payload: Record<string, string | number | undefined> = { ...form }
      if (form.yearBorn) payload.yearBorn = Number(form.yearBorn)
      else delete payload.yearBorn

      const res  = await fetch('/api/members/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.ok) setSaved(true)
    } finally {
      setLoading(false)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  if (fetching) {
    return (
      <div className="flex items-center justify-center h-40">
        <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="section-title">{lang === 'zh' ? '个人信息' : 'Profile'}</h1>
        <p className="text-gray-500">
          {lang === 'zh'
            ? '更新您的个人信息，添加 NYRR 姓名可同步比赛成绩。'
            : 'Update your info. Adding your NYRR Runner Name enables automatic results sync.'}
        </p>
      </div>

      {/* ── Read-only fields ── */}
      <div className="card p-6 max-w-lg space-y-4">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          {lang === 'zh' ? '账户信息' : 'Account Info'}
        </h2>
        {([
          { key: 'memberId',       labelEn: 'Member ID',        labelZh: '会员编号' },
          { key: 'email',          labelEn: 'Email',             labelZh: '邮箱' },
          { key: 'membershipType', labelEn: 'Membership Type',   labelZh: '会员类型' },
          { key: 'joinYear',       labelEn: 'Join Year',         labelZh: '入会年份' },
          { key: 'expiresAt',      labelEn: 'Expires',           labelZh: '到期日期' },
        ] as { key: keyof typeof readOnly; labelEn: string; labelZh: string }[]).map(f => (
          readOnly[f.key] ? (
            <div key={f.key} className="flex justify-between items-center py-1 border-b border-gray-100 last:border-0">
              <span className="text-sm text-gray-500">{lang === 'zh' ? f.labelZh : f.labelEn}</span>
              <span className="text-sm font-medium text-gray-900">{readOnly[f.key]}</span>
            </div>
          ) : null
        ))}
      </div>

      {/* ── Editable fields ── */}
      <form onSubmit={handleSave} className="card p-8 space-y-5 max-w-lg">
        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
          {lang === 'zh' ? '可编辑信息' : 'Editable Info'}
        </h2>

        {([
          { key: 'firstName',      labelEn: 'First Name',         labelZh: '名',          type: 'text',   ph: 'John' },
          { key: 'lastName',       labelEn: 'Last Name',          labelZh: '姓',          type: 'text',   ph: 'Smith' },
          { key: 'phone',          labelEn: 'Phone',              labelZh: '电话',        type: 'tel',    ph: '+1 (212) 555-0000' },
          { key: 'wechatId',       labelEn: 'WeChat ID',          labelZh: '微信号',      type: 'text',   ph: 'wechat_id' },
          { key: 'district',       labelEn: 'District / Borough', labelZh: '地区',        type: 'text',   ph: 'Manhattan' },
          { key: 'yearBorn',       labelEn: 'Year of Birth',      labelZh: '出生年份',    type: 'number', ph: '1990' },
          { key: 'nyrrRunnerName', labelEn: 'NYRR Runner Name',   labelZh: 'NYRR 跑者姓名', type: 'text', ph: 'John Smith' },
        ] as { key: keyof typeof form; labelEn: string; labelZh: string; type: string; ph: string }[]).map(f => (
          <div key={f.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {lang === 'zh' ? f.labelZh : f.labelEn}
            </label>
            <input
              type={f.type}
              className="input-field"
              value={form[f.key]}
              onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.ph}
            />
            {f.key === 'nyrrRunnerName' && (
              <p className="text-xs text-gray-400 mt-1">
                {lang === 'zh'
                  ? '请与 NYRR 官网档案中的姓名完全一致，用于自动同步成绩。'
                  : 'Must match your name exactly as shown on NYRR.org for auto results sync.'}
              </p>
            )}
          </div>
        ))}

        {/* Gender — select */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {lang === 'zh' ? '性别' : 'Gender'}
          </label>
          <select
            className="input-field"
            value={form.gender}
            onChange={e => setForm(prev => ({ ...prev, gender: e.target.value }))}
          >
            <option value="">{lang === 'zh' ? '请选择' : 'Select…'}</option>
            <option value="Male">{lang === 'zh' ? '男' : 'Male'}</option>
            <option value="Female">{lang === 'zh' ? '女' : 'Female'}</option>
            <option value="Non-binary">{lang === 'zh' ? '非二元' : 'Non-binary'}</option>
            <option value="Prefer not to say">{lang === 'zh' ? '不透露' : 'Prefer not to say'}</option>
          </select>
        </div>

        <button
          type="submit"
          disabled={loading}
          className="btn-primary flex items-center gap-2"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          {lang === 'zh' ? '保存' : 'Save Changes'}
        </button>

        {saved && (
          <p className="text-green-600 text-sm font-medium animate-fade-in">
            ✓ {lang === 'zh' ? '已保存！' : 'Saved!'}
          </p>
        )}
      </form>
    </div>
  )
}
