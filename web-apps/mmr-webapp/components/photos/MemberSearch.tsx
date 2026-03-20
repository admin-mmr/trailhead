'use client'

import { useState, useRef, useEffect } from 'react'
import { Search, X, Loader2 } from 'lucide-react'

export interface MemberResult {
  memberId:  string
  firstName: string
  lastName:  string
}

interface Props {
  lang:        'en' | 'zh'
  placeholder?: string
  onSelect:    (m: MemberResult | null) => void
  selected?:   MemberResult | null
}

export default function MemberSearch({ lang, placeholder, onSelect, selected }: Props) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState<MemberResult[]>([])
  const [loading, setLoading] = useState(false)
  const [open,    setOpen]    = useState(false)
  const debounce = useRef<ReturnType<typeof setTimeout>>()

  useEffect(() => {
    if (query.length < 2) { setResults([]); setOpen(false); return }
    clearTimeout(debounce.current)
    debounce.current = setTimeout(async () => {
      setLoading(true)
      try {
        const res  = await fetch(`/api/members/search?q=${encodeURIComponent(query)}&limit=10`)
        const json = await res.json()
        if (json.ok) { setResults(json.data); setOpen(true) }
      } finally {
        setLoading(false)
      }
    }, 300)
  }, [query])

  function clear() {
    setQuery('')
    setResults([])
    setOpen(false)
    onSelect(null)
  }

  if (selected) {
    return (
      <div className="flex items-center gap-2 bg-brand-navy/10 rounded-lg px-3 py-2 text-sm">
        <span className="font-medium text-brand-navy">
          {selected.firstName} {selected.lastName}
        </span>
        <span className="text-gray-500 font-mono text-xs">({selected.memberId})</span>
        <button onClick={clear} className="ml-auto text-gray-400 hover:text-gray-700">
          <X className="h-4 w-4" />
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white focus-within:ring-2 focus-within:ring-brand-navy/20">
        {loading ? <Loader2 className="h-4 w-4 text-gray-400 animate-spin flex-shrink-0" />
                 : <Search className="h-4 w-4 text-gray-400 flex-shrink-0" />}
        <input
          className="flex-1 text-sm bg-transparent focus:outline-none"
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder={placeholder ?? (lang === 'zh' ? '输入姓名或会员编号' : 'Name or Member ID')}
        />
        {query && (
          <button onClick={clear} className="text-gray-400 hover:text-gray-700">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && results.length > 0 && (
        <ul className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
          {results.map(m => (
            <li key={m.memberId}>
              <button
                className="w-full text-left px-4 py-2.5 hover:bg-gray-50 text-sm"
                onClick={() => { onSelect(m); setQuery(''); setOpen(false) }}
              >
                <span className="font-medium">{m.firstName} {m.lastName}</span>
                <span className="text-gray-400 font-mono text-xs ml-2">{m.memberId}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {open && query.length >= 2 && results.length === 0 && !loading && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg px-4 py-3 text-sm text-gray-500">
          {lang === 'zh' ? '未找到会员' : 'No members found'}
        </div>
      )}
    </div>
  )
}
