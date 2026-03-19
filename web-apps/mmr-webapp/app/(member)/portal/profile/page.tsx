'use client'

import { useState } from 'react'
import { useLang } from '@/lib/i18n/context'
import { Save, Loader2 } from 'lucide-react'

export default function ProfilePage() {
  const { lang } = useLang()
  const [loading, setLoading] = useState(false)
  const [saved,   setSaved]   = useState(false)
  const [form, setForm] = useState({
    englishName: '', chineseName: '', phone: '', wechatId: '', nyrrId: '',
  })

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    try {
      const res  = await fetch('/api/members/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const data = await res.json()
      if (data.ok) setSaved(true)
    } finally {
      setLoading(false)
      setTimeout(() => setSaved(false), 3000)
    }
  }

  const fields = [
    { key: 'englishName', labelEn: 'English Name',  labelZh: '英文姓名',  type: 'text', ph: 'John Smith' },
    { key: 'chineseName', labelEn: '中文姓名',        labelZh: '中文姓名',  type: 'text', ph: '张三' },
    { key: 'phone',       labelEn: 'Phone',          labelZh: '电话',      type: 'tel',  ph: '+1 (212) 555-0000' },
    { key: 'wechatId',    labelEn: 'WeChat ID',      labelZh: '微信号',    type: 'text', ph: 'wechat_id' },
    { key: 'nyrrId',      labelEn: 'NYRR ID',        labelZh: 'NYRR 编号', type: 'text', ph: '12345678' },
  ]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="section-title">{lang === 'zh' ? '个人信息' : 'Profile'}</h1>
        <p className="text-gray-500">
          {lang === 'zh'
            ? '更新您的个人信息，添加 NYRR ID 可同步比赛成绩。'
            : 'Update your info. Adding your NYRR ID enables automatic results sync.'}
        </p>
      </div>

      <form onSubmit={handleSave} className="card p-8 space-y-5 max-w-lg">
        {fields.map(f => (
          <div key={f.key}>
            <label className="block text-sm font-medium text-gray-700 mb-1.5">
              {lang === 'zh' ? f.labelZh : f.labelEn}
            </label>
            <input
              type={f.type}
              className="input-field"
              value={(form as any)[f.key]}
              onChange={e => setForm(prev => ({ ...prev, [f.key]: e.target.value }))}
              placeholder={f.ph}
            />
            {f.key === 'nyrrId' && (
              <p className="text-xs text-gray-400 mt-1">
                {lang === 'zh'
                  ? '在 NYRR 官网个人页面中查找您的 NYRR ID。'
                  : 'Find your NYRR ID on your NYRR.org profile page.'}
              </p>
            )}
          </div>
        ))}

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
