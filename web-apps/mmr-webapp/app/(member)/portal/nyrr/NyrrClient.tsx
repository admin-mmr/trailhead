'use client'

import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, Legend
} from 'recharts'
import { useLang } from '@/lib/i18n/context'
import type { NyrrResult } from '@/types'
import { Trophy, Clock, Zap } from 'lucide-react'

// Parse HH:MM:SS finish time to total seconds
function timeToSec(t?: string): number | null {
  if (!t) return null
  const parts = t.split(':').map(Number)
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2]
  if (parts.length === 2) return parts[0] * 60 + parts[1]
  return null
}

function secToTime(s: number): string {
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
  return `${m}:${String(sec).padStart(2,'0')}`
}

function placeColor(place?: number): string {
  if (!place) return 'bg-gray-100 text-gray-500'
  if (place <= 10)  return 'bg-yellow-100 text-yellow-700'
  if (place <= 50)  return 'bg-blue-100 text-blue-700'
  if (place <= 100) return 'bg-green-100 text-green-700'
  return 'bg-gray-100 text-gray-600'
}

const CUSTOM_TOOLTIP_STYLE = {
  backgroundColor: 'white',
  border: '1px solid #e5e7eb',
  borderRadius: '12px',
  padding: '10px 14px',
  fontSize: '13px',
}

interface ChartDot {
  eventDate: string
  eventShort: string
  seconds: number
  finishTime: string
  distance: string
}

interface PbDot {
  distance: string
  seconds: number
  finishTime: string
}

export default function NyrrClient({ results }: { results: NyrrResult[] }) {
  const { lang } = useLang()

  // ── Build finish-time trend data ────────────────────────────
  const trendData: ChartDot[] = results
    .filter(r => r.finishTime && timeToSec(r.finishTime) !== null)
    .slice(0, 20)
    .reverse()
    .map(r => ({
      eventDate:  r.eventDate,
      eventShort: r.eventName.length > 18 ? r.eventName.slice(0, 18) + '…' : r.eventName,
      seconds:    timeToSec(r.finishTime)!,
      finishTime: r.finishTime!,
      distance:   r.distance ?? '',
    }))

  // ── Build personal bests by distance ────────────────────────
  const pbMap: Record<string, number> = {}
  const pbNameMap: Record<string, string> = {}
  results.forEach(r => {
    const sec = timeToSec(r.finishTime)
    if (!sec || !r.distance) return
    if (!pbMap[r.distance] || sec < pbMap[r.distance]) {
      pbMap[r.distance]     = sec
      pbNameMap[r.distance] = r.finishTime!
    }
  })
  const pbData: PbDot[] = Object.keys(pbMap)
    .sort()
    .map(d => ({ distance: d, seconds: pbMap[d], finishTime: pbNameMap[d] }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="section-title">
          {lang === 'zh' ? '比赛成绩' : 'NYRR Results'}
        </h1>
        <p className="text-gray-500">
          {lang === 'zh' ? `共 ${results.length} 场比赛记录` : `${results.length} races recorded`}
        </p>
      </div>

      {results.length === 0 ? (
        <div className="card p-12 text-center">
          <Trophy className="h-12 w-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">
            {lang === 'zh'
              ? '暂无比赛成绩。请在个人信息中添加 NYRR ID。'
              : 'No results yet. Add your NYRR ID in Profile to sync results.'}
          </p>
        </div>
      ) : (
        <>
          {/* ── Finish Time Trend ─────────────────────────────── */}
          {trendData.length > 1 && (
            <div className="card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Clock className="h-5 w-5 text-brand-navy" />
                <h2 className="font-bold text-gray-900">
                  {lang === 'zh' ? '完赛时间趋势' : 'Finish Time Trend'}
                </h2>
              </div>
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis
                    dataKey="eventShort"
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    angle={-30}
                    textAnchor="end"
                    height={60}
                  />
                  <YAxis
                    tickFormatter={v => secToTime(v)}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    reversed={true}
                  />
                  <Tooltip
                    contentStyle={CUSTOM_TOOLTIP_STYLE}
                    formatter={(v: any) => [secToTime(v), lang === 'zh' ? '完赛时间' : 'Finish Time']}
                    labelFormatter={(label, payload) => {
                      const item = payload?.[0]?.payload as ChartDot | undefined
                      return item ? `${item.eventDate} · ${item.distance}` : label
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey="seconds"
                    stroke="#1F497D"
                    strokeWidth={2.5}
                    dot={{ fill: '#E86033', r: 4, strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Personal Bests ────────────────────────────────── */}
          {pbData.length > 0 && (
            <div className="card p-6">
              <div className="flex items-center gap-2 mb-4">
                <Zap className="h-5 w-5 text-brand-orange" />
                <h2 className="font-bold text-gray-900">
                  {lang === 'zh' ? '各距离最佳成绩' : 'Personal Bests by Distance'}
                </h2>
              </div>
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={pbData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                  <XAxis dataKey="distance" tick={{ fontSize: 12, fill: '#64748b' }} />
                  <YAxis
                    tickFormatter={v => secToTime(v)}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    reversed={true}
                  />
                  <Tooltip
                    contentStyle={CUSTOM_TOOLTIP_STYLE}
                    formatter={(v: any) => [secToTime(v), lang === 'zh' ? '最佳时间' : 'Best Time']}
                  />
                  <Bar dataKey="seconds" fill="#E86033" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* ── Results Table ─────────────────────────────────── */}
          <div className="card overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="font-bold text-gray-900">
                {lang === 'zh' ? '全部成绩' : 'All Results'}
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-left text-xs text-gray-500 uppercase tracking-wider">
                    <th className="px-6 py-3">{lang === 'zh' ? '赛事' : 'Race'}</th>
                    <th className="px-4 py-3">{lang === 'zh' ? '日期' : 'Date'}</th>
                    <th className="px-4 py-3">{lang === 'zh' ? '距离' : 'Dist'}</th>
                    <th className="px-4 py-3">{lang === 'zh' ? '成绩' : 'Time'}</th>
                    <th className="px-4 py-3">{lang === 'zh' ? '配速' : 'Pace'}</th>
                    <th className="px-4 py-3">{lang === 'zh' ? '总排名' : 'OA Place'}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {results.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4 font-medium text-gray-900 max-w-[200px] truncate">
                        {r.eventName}
                      </td>
                      <td className="px-4 py-4 text-gray-500">{r.eventDate}</td>
                      <td className="px-4 py-4 text-gray-500">{r.distance ?? '—'}</td>
                      <td className="px-4 py-4 font-mono font-medium text-brand-navy">
                        {r.finishTime ?? '—'}
                      </td>
                      <td className="px-4 py-4 text-gray-500">{r.pace ?? '—'}</td>
                      <td className="px-4 py-4">
                        {r.overallPlace ? (
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${placeColor(r.overallPlace)}`}>
                            #{r.overallPlace}
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
