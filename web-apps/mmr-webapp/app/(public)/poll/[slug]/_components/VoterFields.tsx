'use client'

interface Props {
  lang: 'en' | 'zh'
  memberId: string
  lastName: string
  comment: string
  onMemberId: (v: string) => void
  onLastName: (v: string) => void
  onComment: (v: string) => void
  maxComment: number
}

/** Identification + optional comment. No password: the pair is checked server-side. */
export default function VoterFields({
  lang, memberId, lastName, comment, onMemberId, onLastName, onComment, maxComment,
}: Props) {
  const t = (en: string, zh: string) => (lang === 'zh' ? zh : en)

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-6">
      <h2 className="font-semibold text-gray-900">
        {t('Who is voting?', '您是谁？')}
      </h2>
      <p className="mt-1 text-sm text-gray-500">
        {t('Your member ID and last name, so each member votes once. No password needed.',
           '请填写会员编号和姓氏，以确保每位会员只投一次票。无需密码。')}
      </p>

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="poll-member-id" className="block text-sm font-medium text-gray-700 mb-1.5">
            {t('Member ID', '会员编号')}
          </label>
          <input
            id="poll-member-id"
            className="input-field uppercase"
            placeholder="A0123"
            autoComplete="off"
            spellCheck={false}
            maxLength={10}
            value={memberId}
            onChange={e => onMemberId(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="poll-last-name" className="block text-sm font-medium text-gray-700 mb-1.5">
            {t('Last name', '姓氏')}
          </label>
          <input
            id="poll-last-name"
            className="input-field"
            autoComplete="family-name"
            maxLength={100}
            value={lastName}
            onChange={e => onLastName(e.target.value)}
          />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="poll-comment" className="block text-sm font-medium text-gray-700 mb-1.5">
          {t('Anything you want to add? (optional)', '还有什么想说的？（选填）')}
        </label>
        <textarea
          id="poll-comment"
          className="input-field min-h-[92px] resize-y"
          maxLength={maxComment}
          value={comment}
          onChange={e => onComment(e.target.value)}
          placeholder={t('Comments are shown on the results page without your name.',
                         '留言会显示在结果页面，但不会显示您的姓名。')}
        />
        <p className="mt-1 text-xs text-gray-400">
          {comment.length}/{maxComment}
        </p>
      </div>
    </div>
  )
}
