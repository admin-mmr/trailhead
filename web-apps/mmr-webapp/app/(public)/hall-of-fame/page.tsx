'use client'

// ============================================================
// /hall-of-fame — MMR Hall of Fame (public, no auth required)
// ============================================================

import { useState, useEffect } from 'react'
import { useLang } from '@/lib/i18n/context'
import { Trophy, ChevronDown, ChevronUp, Clock } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HofRunner {
  runner_name: string
  mmr_member_id: string | null
  age: number | null
  finish_time: string
  event_name: string
  event_year: number
}

interface HofCategory {
  key: string
  label: string
  label_zh: string
  gender: string
  min_age: number | null
  best: HofRunner | null
  podium: HofRunner[]
}

interface Series {
  id: number
  name: string
  slug: string
  distance_km: number | null
  notes: string | null
  event_count: number
  events_completed: number
  events_with_mmr: number
}

interface SeriesHof {
  series: Series
  categories: HofCategory[]
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function fetchJson<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(path)
    if (!res.ok) return null
    return res.json() as Promise<T>
  } catch {
    return null
  }
}

const MEDALS = ['🥇', '🥈', '🥉']

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PodiumRow({ runner, rank }: { runner: HofRunner; rank: number }) {
  return (
    <div className={`flex items-center gap-3 py-2 px-3 rounded-lg mb-1 ${
      rank === 0 ? 'bg-yellow-50 border border-yellow-200' : 'bg-gray-50'
    }`}>
      <span className="text-xl w-7 flex-shrink-0">{MEDALS[rank]}</span>
      <div className="flex-1 min-w-0">
        <div className={`truncate ${rank === 0 ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
          {runner.runner_name}
        </div>
        <div className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
          <Clock size={10} />
          {runner.finish_time}
          <span className="mx-1">·</span>
          {runner.event_name} {runner.event_year}
        </div>
      </div>
    </div>
  )
}

function CategoryCard({ cat }: { cat: HofCategory }) {
  const { lang } = useLang()
  const label = lang === 'zh' ? cat.label_zh : cat.label
  const isEmpty = cat.podium.length === 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-5">
      <h3 className="font-semibold text-gray-900 mb-3 flex items-center gap-2">
        {label}
        {lang !== 'zh' && (
          <span className="text-xs font-normal text-gray-400">{cat.label_zh}</span>
        )}
      </h3>
      {isEmpty ? (
        <p className="text-sm text-gray-400 italic">
          {lang === 'zh' ? '暂无数据' : 'No data yet'}
        </p>
      ) : (
        cat.podium.map((runner, i) => (
          <PodiumRow key={i} runner={runner} rank={i} />
        ))
      )}
    </div>
  )
}

function SeriesCard({ series, onExpand }: { series: Series; onExpand: () => void }) {
  const { lang } = useLang()
  const hasData = series.events_with_mmr > 0

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      <div className="p-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <Trophy size={18} className="text-yellow-500 flex-shrink-0" />
            {series.name}
          </h2>
          <div className="text-sm text-gray-500 mt-1 flex items-center gap-3 flex-wrap">
            {series.distance_km && (
              <span>{series.distance_km} km</span>
            )}
            <span>
              {lang === 'zh'
                ? `${series.events_completed} 届已完成`
                : `${series.events_completed} edition${series.events_completed !== 1 ? 's' : ''} with results`}
            </span>
          </div>
        </div>
        <button
          onClick={onExpand}
          disabled={!hasData}
          className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            hasData
              ? 'bg-brand-navy text-white hover:bg-blue-900'
              : 'bg-gray-100 text-gray-400 cursor-not-allowed'
          }`}
        >
          <Trophy size={14} />
          {lang === 'zh' ? '查看荣誉榜' : 'View HOF'}
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function HallOfFamePage() {
  const { lang } = useLang()

  const [seriesList, setSeriesList]   = useState<Series[]>([])
  const [expandedSlug, setExpanded]   = useState<string | null>(null)
  const [hofCache, setHofCache]       = useState<Record<string, SeriesHof>>({})
  const [loadingSlug, setLoadingSlug] = useState<string | null>(null)
  const [pageLoading, setPageLoading] = useState(true)

  useEffect(() => {
    fetchJson<{ ok: boolean; series: Series[] }>('/api/hof/series').then(data => {
      if (data?.ok) setSeriesList(data.series)
      setPageLoading(false)
    })
  }, [])

  const handleExpand = async (series: Series) => {
    if (expandedSlug === series.slug) {
      setExpanded(null)
      return
    }
    setExpanded(series.slug)
    if (hofCache[series.slug]) return   // already loaded

    setLoadingSlug(series.slug)
    const data = await fetchJson<SeriesHof>(`/api/hof/series/${series.slug}`)
    setLoadingSlug(null)
    if (data) {
      setHofCache(prev => ({ ...prev, [series.slug]: data }))
    }
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-12">
      {/* ── Header ── */}
      <div className="text-center mb-10">
        <div className="text-5xl mb-3">🏆</div>
        <h1 className="text-3xl font-extrabold text-gray-900">
          {lang === 'zh' ? 'MMR 荣誉殿堂' : 'MMR Hall of Fame'}
        </h1>
        <p className="text-gray-500 mt-3 max-w-xl mx-auto text-sm leading-relaxed">
          {lang === 'zh'
            ? 'MMR 跑团在 NYRR 各大赛事中的最佳成绩，按性别及年龄组分类展示。'
            : 'All-time best finishes by MMR members across NYRR race series, by gender and age group.'}
        </p>
      </div>

      {/* ── Series list ── */}
      {pageLoading ? (
        <div className="text-center text-gray-400 py-20">
          {lang === 'zh' ? '加载中…' : 'Loading…'}
        </div>
      ) : seriesList.length === 0 ? (
        <div className="text-center text-gray-400 py-20">
          {lang === 'zh' ? '暂无数据' : 'No series data available yet.'}
        </div>
      ) : (
        <div className="space-y-4">
          {seriesList.map(series => (
            <div key={series.id}>
              <SeriesCard
                series={series}
                onExpand={() => handleExpand(series)}
              />

              {/* Expanded HOF grid */}
              {expandedSlug === series.slug && (
                <div className="mt-3 pl-2">
                  {loadingSlug === series.slug ? (
                    <div className="text-center text-gray-400 py-10">
                      {lang === 'zh' ? '加载荣誉榜…' : 'Loading Hall of Fame…'}
                    </div>
                  ) : hofCache[series.slug] ? (
                    <>
                      <p className="text-xs text-gray-400 mb-4 text-right">
                        {lang === 'zh'
                          ? `共 ${hofCache[series.slug].series.events_completed} 届赛事成绩`
                          : `Across ${hofCache[series.slug].series.events_completed} race editions`}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                        {hofCache[series.slug].categories.map(cat => (
                          <CategoryCard key={cat.key} cat={cat} />
                        ))}
                      </div>
                    </>
                  ) : (
                    <div className="text-center text-gray-400 py-6">
                      {lang === 'zh' ? '加载失败，请重试' : 'Failed to load. Please try again.'}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── Footer note ── */}
      <p className="text-center text-xs text-gray-400 mt-12">
        {lang === 'zh'
          ? '数据来源：NYRR 官方成绩。仅显示 MMR 跑团成员（team_code = MMR）的成绩。'
          : 'Source: NYRR official results. Only finishes recorded under the MMR team tag are shown.'}
      </p>
    </div>
  )
}
