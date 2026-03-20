'use client'

import { ArrowUpDown } from 'lucide-react'
import type { PhotoSortKey } from '@/lib/db/photos'

const OPTIONS: { key: PhotoSortKey; en: string; zh: string }[] = [
  { key: 'date_desc', en: 'Newest first',    zh: '最新' },
  { key: 'date_asc',  en: 'Oldest first',    zh: '最早' },
  { key: 'rating',    en: 'Top rated',       zh: '评分最高' },
  { key: 'stars',     en: 'Most favorited',  zh: '最多收藏' },
  { key: 'comments',  en: 'Most commented',  zh: '最多留言' },
]

interface Props {
  value: PhotoSortKey
  onChange: (v: PhotoSortKey) => void
  lang: 'en' | 'zh'
}

export default function SortBar({ value, onChange, lang }: Props) {
  return (
    <div className="flex items-center gap-2">
      <ArrowUpDown className="h-4 w-4 text-gray-400" />
      <select
        value={value}
        onChange={e => onChange(e.target.value as PhotoSortKey)}
        className="text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
      >
        {OPTIONS.map(o => (
          <option key={o.key} value={o.key}>
            {lang === 'zh' ? o.zh : o.en}
          </option>
        ))}
      </select>
    </div>
  )
}
