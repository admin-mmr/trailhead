'use client'

import { useState } from 'react'
import Link from 'next/link'
import { MapPin, ExternalLink } from 'lucide-react'
import { useLang } from '@/lib/i18n/context'

interface Event {
  id: number; date: string; titleEn: string; titleZh: string
  location: string; descriptionEn: string; descriptionZh: string
  tags: string[]; registrationUrl?: string
}

const FILTERS = [
  { label: 'All',        zh: '全部',    value: '' },
  { label: 'Group Runs', zh: '集体跑',  value: 'group-run' },
  { label: 'NYRR',       zh: 'NYRR赛事',value: 'nyrr' },
  { label: 'Social',     zh: '社交',    value: 'social' },
]

function formatDate(iso: string, lang: 'en' | 'zh') {
  const d = new Date(iso + 'T00:00:00')
  return lang === 'zh'
    ? d.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' })
    : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', weekday: 'short' })
}

function monthDay(iso: string) {
  const d = new Date(iso + 'T00:00:00')
  return {
    month: d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
    day:   d.getDate().toString(),
  }
}

export default function EventsClient({ events }: { events: Event[] }) {
  const { lang, T } = useLang()
  const [filter, setFilter] = useState('')

  const shown = filter
    ? events.filter(e => e.tags.includes(filter))
    : events

  return (
    <div className="py-20">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="mb-10">
          <h1 className="section-title">{T('events.title')}</h1>
          <p className="section-subtitle">
            {lang === 'zh' ? '查看所有近期跑步活动' : 'All upcoming runs and races'}
          </p>
        </div>

        {/* Filter tabs */}
        <div className="flex flex-wrap gap-2 mb-8">
          {FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilter(f.value)}
              className={`px-4 py-2 rounded-full text-sm font-medium transition-colors ${
                filter === f.value
                  ? 'bg-brand-navy text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {lang === 'zh' ? f.zh : f.label}
            </button>
          ))}
        </div>

        {/* Event list */}
        <div className="space-y-4">
          {shown.length === 0 && (
            <p className="text-gray-500 text-center py-12">{T('events.empty')}</p>
          )}
          {shown.map(event => {
            const { month, day } = monthDay(event.date)
            return (
              <div key={event.id} className="card p-6 flex gap-6">
                {/* Date block */}
                <div className="flex-shrink-0 bg-brand-navy rounded-xl w-16 h-16 flex flex-col items-center justify-center text-white">
                  <span className="text-xs font-medium opacity-70">{month}</span>
                  <span className="text-2xl font-bold leading-tight">{day}</span>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-start gap-2 mb-1">
                    <h3 className="font-bold text-gray-900 text-lg leading-snug">
                      {lang === 'zh' ? event.titleZh : event.titleEn}
                    </h3>
                    {event.tags.map(tag => (
                      <span key={tag} className="bg-brand-orange/10 text-brand-orange text-xs font-medium px-2 py-0.5 rounded-full">
                        {tag}
                      </span>
                    ))}
                  </div>
                  <div className="flex items-center gap-1 text-gray-500 text-sm mb-2">
                    <MapPin className="h-3.5 w-3.5" />
                    {event.location}
                  </div>
                  <p className="text-gray-600 text-sm line-clamp-2">
                    {lang === 'zh' ? event.descriptionZh : event.descriptionEn}
                  </p>
                  {event.registrationUrl && (
                    <a
                      href={event.registrationUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-brand-orange text-sm font-medium mt-3 hover:underline"
                    >
                      {T('events.register')} <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
