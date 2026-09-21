import type { MemberInfo, FieldErrors } from './shared'

interface InfoStepProps {
  lang: string
  isRenewing: boolean
  info: MemberInfo
  fieldErrors: FieldErrors
  submitting: boolean
  onChange: (key: keyof MemberInfo, value: string) => void
  onBlur: (key: keyof MemberInfo, value: string) => void
  onSubmit: (e: React.FormEvent) => void
  prevStep: () => void
}

export function InfoStep({ lang, isRenewing, info, fieldErrors, submitting, onChange, onBlur, onSubmit, prevStep }: InfoStepProps) {
  return (
    <form onSubmit={onSubmit}>
      <h2 className="text-xl font-semibold text-lantern-ink mb-2">
        {isRenewing
          ? (lang === 'zh' ? '确认个人信息' : 'Review Your Info')
          : (lang === 'zh' ? '填写个人信息' : 'Your Information')}
      </h2>
      {isRenewing && (
        <p className="text-sm text-lantern-ink-soft mb-6">
          {lang === 'zh'
            ? '我们已从您的会员档案中预填了以下信息，请确认或更新后继续。'
            : 'We pre-filled your info from your member record. Review and update if needed.'}
        </p>
      )}
      <div className="grid grid-cols-2 gap-4">
        {/* First / Last name */}
        {([
          { key: 'firstName', label: 'First Name', labelZh: '名', required: true },
          { key: 'lastName',  label: 'Last Name',  labelZh: '姓', required: true },
        ] as { key: keyof MemberInfo; label: string; labelZh: string; required?: boolean }[]).map(f => (
          <div key={f.key}>
            <label className="block text-sm font-medium text-lantern-ink mb-1">
              {lang === 'zh' ? f.labelZh : f.label}
              <span className="text-red-500 ml-1">*</span>
            </label>
            <input
              type="text"
              value={info[f.key]}
              onChange={e => onChange(f.key, e.target.value)}
              onBlur={e => onBlur(f.key, e.target.value)}
              className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-crimson
                ${fieldErrors[f.key] ? 'border-red-400 bg-red-50' : 'border-lantern-line'}`}
            />
            {fieldErrors[f.key] && (
              <p className="text-xs text-red-600 mt-1">{fieldErrors[f.key]}</p>
            )}
          </div>
        ))}

        {/* Email */}
        <div className="col-span-2">
          <label className="block text-sm font-medium text-lantern-ink mb-1">
            {lang === 'zh' ? '电子邮件' : 'Email Address'}
            <span className="text-red-500 ml-1">*</span>
          </label>
          <input
            type="email"
            value={info.email}
            onChange={e => onChange('email', e.target.value)}
            onBlur={e => onBlur('email', e.target.value)}
            placeholder="jane@example.com"
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-crimson
              ${fieldErrors.email ? 'border-red-400 bg-red-50' : 'border-lantern-line'}`}
          />
          {fieldErrors.email && (
            <p className="text-xs text-red-600 mt-1">{fieldErrors.email}</p>
          )}
        </div>

        {/* Gender — required, moved up for NYRR matching */}
        <div>
          <label className="block text-sm font-medium text-lantern-ink mb-1">
            {lang === 'zh' ? '性别' : 'Gender'}
            <span className="text-red-500 ml-1">*</span>
          </label>
          <select
            value={info.gender}
            onChange={e => onChange('gender', e.target.value)}
            onBlur={e => onBlur('gender', e.target.value)}
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-crimson
              ${fieldErrors.gender ? 'border-red-400 bg-red-50' : 'border-lantern-line'}`}
          >
            <option value="">{lang === 'zh' ? '请选择' : 'Select…'}</option>
            <option value="Male">{lang === 'zh' ? '男' : 'Male'}</option>
            <option value="Female">{lang === 'zh' ? '女' : 'Female'}</option>
            <option value="Non-binary">{lang === 'zh' ? '非二元' : 'Non-binary'}</option>
            <option value="Prefer not to say">{lang === 'zh' ? '不透露' : 'Prefer not to say'}</option>
          </select>
          {fieldErrors.gender
            ? <p className="text-xs text-red-600 mt-1">{fieldErrors.gender}</p>
            : <p className="text-xs text-lantern-ink-soft/60 mt-1">
                {lang === 'zh' ? '用于匹配 NYRR 跑者档案。' : 'Helps us match your NYRR runner profile.'}
              </p>
          }
        </div>

        {/* Year of Birth */}
        <div>
          <label className="block text-sm font-medium text-lantern-ink mb-1">
            {lang === 'zh' ? '出生年份' : 'Year of Birth'}
          </label>
          <input
            type="number"
            value={info.yearBorn}
            onChange={e => onChange('yearBorn', e.target.value)}
            onBlur={e => onBlur('yearBorn', e.target.value)}
            placeholder={lang === 'zh' ? '例如 1990' : 'e.g. 1990'}
            min={1900}
            max={new Date().getFullYear()}
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-crimson
              ${fieldErrors.yearBorn ? 'border-red-400 bg-red-50' : 'border-lantern-line'}`}
          />
          {fieldErrors.yearBorn
            ? <p className="text-xs text-red-600 mt-1">{fieldErrors.yearBorn}</p>
            : <p className="text-xs text-lantern-ink-soft/60 mt-1">
                {lang === 'zh' ? '用于通过大致年龄匹配 NYRR 跑者信息。' : 'Used to match your NYRR runner profile by approximate age.'}
              </p>
          }
        </div>

        {/* Phone — optional */}
        <div>
          <label className="block text-sm font-medium text-lantern-ink mb-1">
            {lang === 'zh' ? '电话' : 'Phone'}
            <span className="text-lantern-ink-soft/60 ml-1 font-normal text-xs">{lang === 'zh' ? '（选填）' : '(optional)'}</span>
          </label>
          <input
            type="tel"
            value={info.phone}
            onChange={e => onChange('phone', e.target.value)}
            onBlur={e => onBlur('phone', e.target.value)}
            placeholder={lang === 'zh' ? '例如 212-555-0100' : 'e.g. 212-555-0100'}
            className={`w-full px-3 py-2 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-crimson
              ${fieldErrors.phone ? 'border-red-400 bg-red-50' : 'border-lantern-line'}`}
          />
          {fieldErrors.phone && (
            <p className="text-xs text-red-600 mt-1">{fieldErrors.phone}</p>
          )}
        </div>

        {/* WeChat ID */}
        <div>
          <label className="block text-sm font-medium text-lantern-ink mb-1">
            {lang === 'zh' ? '微信号' : 'WeChat ID'}
            <span className="text-lantern-ink-soft/60 ml-1 font-normal text-xs">{lang === 'zh' ? '（选填）' : '(optional)'}</span>
          </label>
          <input
            type="text"
            value={info.wechatId}
            onChange={e => onChange('wechatId', e.target.value)}
            className="w-full px-3 py-2 border border-lantern-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-crimson"
          />
        </div>

        {/* District */}
        <div className="col-span-2">
          <label className="block text-sm font-medium text-lantern-ink mb-1">
            {lang === 'zh' ? '地区' : 'District / Borough'}
            <span className="text-lantern-ink-soft/60 ml-1 font-normal text-xs">{lang === 'zh' ? '（选填）' : '(optional)'}</span>
          </label>
          <input
            type="text"
            value={info.district}
            onChange={e => onChange('district', e.target.value)}
            placeholder={lang === 'zh' ? '例如 Manhattan, Queens…' : 'e.g. Manhattan, Queens, Brooklyn…'}
            className="w-full px-3 py-2 border border-lantern-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-crimson"
          />
        </div>

        {/* NYRR Runner Name */}
        <div className="col-span-2">
          <label className="block text-sm font-medium text-lantern-ink mb-1">
            {lang === 'zh' ? 'NYRR 姓名' : 'NYRR Runner Name'}
            <span className="text-lantern-ink-soft/60 ml-1 font-normal text-xs">{lang === 'zh' ? '（选填）' : '(optional)'}</span>
          </label>
          <input
            type="text"
            value={info.nyrrRunnerName}
            onChange={e => onChange('nyrrRunnerName', e.target.value)}
            placeholder={lang === 'zh' ? '与 NYRR 账户上完全一致的姓名' : 'Exactly as it appears on your NYRR account'}
            className="w-full px-3 py-2 border border-lantern-line rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-crimson"
          />
          <p className="text-xs text-lantern-ink-soft/60 mt-1">
            {lang === 'zh'
              ? '如果与上方姓名不同，请填写您在 NYRR 注册的姓名。'
              : 'Only needed if different from your name above. Used for race result matching.'}
          </p>
        </div>
      </div>

      <div className="flex gap-4 mt-8">
        <button type="button" onClick={prevStep}
          className="flex-1 border border-lantern-line text-lantern-ink py-3 rounded-xl font-semibold hover:bg-lantern-blush transition-colors">
          {lang === 'zh' ? '返回' : '← Back'}
        </button>
        <button type="submit" disabled={submitting}
          className="flex-1 bg-brand-crimson text-white py-3 rounded-xl font-semibold hover:bg-brand-crimson-dark transition-colors disabled:opacity-50">
          {submitting ? (lang === 'zh' ? '提交中…' : 'Saving…') : (lang === 'zh' ? '继续' : 'Continue →')}
        </button>
      </div>
    </form>
  )
}
