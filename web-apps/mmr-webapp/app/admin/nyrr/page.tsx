'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/lib/i18n/context'
import {
  Calendar,
  CalendarClock,
  Users,
  AlertCircle,
  Loader2,
  TrendingUp,
} from 'lucide-react'

interface StatsData {
  totalEvents: number
  upcomingEvents: number
  totalMmrRunners: number
  unmatchedCount: number
  statusBreakdown: {
    Pending: number
    InProgress: number
    Completed: number
    Error: number
  }
}

interface EventData {
  id: string
  event_code: string
  event_name: string
  event_date: string
  distance: string
  location: string
  processing_status: string
  mmr_runner_count: number
  mmr_matched_count: number
  matchPct: number
}

interface EventsResponse {
  events: EventData[]
  nextCursor?: string | null
}

export default function NYRRDashboard() {
  const { lang } = useLang()
  const [stats, setStats] = useState<StatsData | null>(null)
  const [events, setEvents] = useState<EventData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    async function fetchData() {
      try {
        setError('')
        const [statsRes, eventsRes] = await Promise.all([
          fetch('/api/nyrr/stats'),
          fetch('/api/nyrr/events?limit=10'),
        ])

        if (!statsRes.ok || !eventsRes.ok) {
          throw new Error('Failed to fetch data')
        }

        const statsData = await statsRes.json()
        const eventsData = await eventsRes.json()

        if (statsData.ok && statsData.data) {
          setStats(statsData.data)
        }

        if (eventsData.ok && eventsData.data) {
          setEvents(eventsData.data.events || [])
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  const totalStatus = stats?.statusBreakdown
    ? Object.values(stats.statusBreakdown).reduce((a, b) => a + b, 0)
    : 0

  const statusPercentages = {
    pending: totalStatus
      ? ((stats?.statusBreakdown.Pending || 0) / totalStatus) * 100
      : 0,
    inProgress: totalStatus
      ? ((stats?.statusBreakdown.InProgress || 0) / totalStatus) * 100
      : 0,
    completed: totalStatus
      ? ((stats?.statusBreakdown.Completed || 0) / totalStatus) * 100
      : 0,
    error: totalStatus
      ? ((stats?.statusBreakdown.Error || 0) / totalStatus) * 100
      : 0,
  }

  const getStatusBadgeColor = (status: string) => {
    switch (status.toLowerCase()) {
      case 'pending':
        return 'bg-gray-100 text-gray-700'
      case 'inprogress':
        return 'bg-blue-100 text-blue-700'
      case 'completed':
        return 'bg-green-100 text-green-700'
      case 'error':
        return 'bg-red-100 text-red-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  const getMatchHealthColor = (matchPct: number) => {
    if (matchPct >= 90) return 'bg-green-500'
    if (matchPct >= 70) return 'bg-yellow-500'
    return 'bg-red-500'
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-7xl mx-auto px-4">
        {/* Page Header */}
        <div className="flex items-center gap-3 mb-8">
          <div className="w-10 h-10 bg-[#C8102E] rounded-xl flex items-center justify-center">
            <TrendingUp className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#0A2342]">
              {lang === 'zh' ? 'NYRR 管理面板' : 'NYRR Dashboard'}
            </h1>
            <p className="text-sm text-gray-500">
              {lang === 'zh'
                ? '监管比赛和选手匹配进度'
                : 'Monitor race events and runner matching progress'}
            </p>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-4 mb-8 border-b border-gray-200">
          <Link
            href="/admin/nyrr"
            className="px-4 py-3 font-semibold text-[#0A2342] border-b-2 border-[#0A2342]"
          >
            {lang === 'zh' ? '概览' : 'Overview'}
          </Link>
          <Link
            href="/admin/nyrr/match-review"
            className="px-4 py-3 font-semibold text-gray-500 border-b-2 border-transparent hover:text-gray-700 hover:border-gray-300"
          >
            {lang === 'zh' ? '比赛审核' : 'Match Review'}
          </Link>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {/* Total Events */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">
                  {lang === 'zh' ? '总赛事' : 'Total Events'}
                </p>
                <p className="text-3xl font-bold text-[#0A2342] mt-2">
                  {stats?.totalEvents || 0}
                </p>
              </div>
              <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                <Calendar className="h-6 w-6 text-blue-600" />
              </div>
            </div>
          </div>

          {/* Upcoming Events */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">
                  {lang === 'zh' ? '即将举行' : 'Upcoming Events'}
                </p>
                <p className="text-3xl font-bold text-[#0A2342] mt-2">
                  {stats?.upcomingEvents || 0}
                </p>
              </div>
              <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                <CalendarClock className="h-6 w-6 text-purple-600" />
              </div>
            </div>
          </div>

          {/* MMR Runners */}
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">
                  {lang === 'zh' ? 'MMR 选手' : 'MMR Runners'}
                </p>
                <p className="text-3xl font-bold text-[#0A2342] mt-2">
                  {stats?.totalMmrRunners || 0}
                </p>
              </div>
              <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                <Users className="h-6 w-6 text-green-600" />
              </div>
            </div>
          </div>

          {/* Unmatched Queue */}
          <div
            className={`bg-white rounded-2xl shadow-sm border p-6 ${
              (stats?.unmatchedCount || 0) > 0
                ? 'border-red-200 bg-red-50'
                : 'border-gray-100'
            }`}
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-500">
                  {lang === 'zh' ? '未匹配队列' : 'Unmatched Queue'}
                </p>
                <p
                  className={`text-3xl font-bold mt-2 ${
                    (stats?.unmatchedCount || 0) > 0
                      ? 'text-red-600'
                      : 'text-[#0A2342]'
                  }`}
                >
                  {stats?.unmatchedCount || 0}
                </p>
              </div>
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  (stats?.unmatchedCount || 0) > 0
                    ? 'bg-red-100'
                    : 'bg-gray-100'
                }`}
              >
                <AlertCircle
                  className={`h-6 w-6 ${
                    (stats?.unmatchedCount || 0) > 0
                      ? 'text-red-600'
                      : 'text-gray-400'
                  }`}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Processing Status Chart */}
        {stats && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-8">
            <h2 className="text-lg font-semibold text-[#0A2342] mb-6">
              {lang === 'zh' ? '处理状态' : 'Processing Status'}
            </h2>
            <div className="space-y-4">
              {/* Status Bar */}
              <div className="flex items-center gap-4">
                <div className="flex-1 h-8 bg-gray-100 rounded-full flex overflow-hidden">
                  {statusPercentages.pending > 0 && (
                    <div
                      className="bg-gray-400"
                      style={{ width: `${statusPercentages.pending}%` }}
                    />
                  )}
                  {statusPercentages.inProgress > 0 && (
                    <div
                      className="bg-blue-500"
                      style={{ width: `${statusPercentages.inProgress}%` }}
                    />
                  )}
                  {statusPercentages.completed > 0 && (
                    <div
                      className="bg-green-500"
                      style={{ width: `${statusPercentages.completed}%` }}
                    />
                  )}
                  {statusPercentages.error > 0 && (
                    <div
                      className="bg-red-500"
                      style={{ width: `${statusPercentages.error}%` }}
                    />
                  )}
                </div>
              </div>

              {/* Legend */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-gray-400 rounded-full" />
                  <div>
                    <p className="text-xs text-gray-500">
                      {lang === 'zh' ? '待处理' : 'Pending'}
                    </p>
                    <p className="font-semibold text-[#0A2342]">
                      {stats.statusBreakdown.Pending}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-blue-500 rounded-full" />
                  <div>
                    <p className="text-xs text-gray-500">
                      {lang === 'zh' ? '处理中' : 'In Progress'}
                    </p>
                    <p className="font-semibold text-[#0A2342]">
                      {stats.statusBreakdown.InProgress}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-green-500 rounded-full" />
                  <div>
                    <p className="text-xs text-gray-500">
                      {lang === 'zh' ? '已完成' : 'Completed'}
                    </p>
                    <p className="font-semibold text-[#0A2342]">
                      {stats.statusBreakdown.Completed}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-red-500 rounded-full" />
                  <div>
                    <p className="text-xs text-gray-500">
                      {lang === 'zh' ? '错误' : 'Error'}
                    </p>
                    <p className="font-semibold text-[#0A2342]">
                      {stats.statusBreakdown.Error}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Recent Events Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-[#0A2342] mb-6">
            {lang === 'zh' ? '最近的赛事' : 'Recent Events'}
          </h2>

          {events.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              {lang === 'zh' ? '没有赛事数据' : 'No events data'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-gray-200">
                  <tr className="text-gray-600">
                    <th className="text-left p-3 font-semibold">
                      {lang === 'zh' ? '赛事' : 'Event'}
                    </th>
                    <th className="text-left p-3 font-semibold">
                      {lang === 'zh' ? '日期' : 'Date'}
                    </th>
                    <th className="text-left p-3 font-semibold">
                      {lang === 'zh' ? '距离' : 'Distance'}
                    </th>
                    <th className="text-left p-3 font-semibold">
                      {lang === 'zh' ? '状态' : 'Status'}
                    </th>
                    <th className="text-left p-3 font-semibold">
                      {lang === 'zh' ? 'MMR 选手' : 'MMR Count'}
                    </th>
                    <th className="text-left p-3 font-semibold">
                      {lang === 'zh' ? '已匹配' : 'Matched'}
                    </th>
                    <th className="text-left p-3 font-semibold">
                      {lang === 'zh' ? '匹配率' : 'Match %'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr
                      key={event.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="p-3">
                        <Link
                          href={`/admin/nyrr/events/${event.id}`}
                          className="text-[#0A2342] font-medium hover:text-[#C8102E] transition-colors"
                        >
                          {event.event_name}
                        </Link>
                        <p className="text-xs text-gray-400 mt-1">
                          {event.event_code}
                        </p>
                      </td>
                      <td className="p-3 text-gray-600">
                        {new Date(event.event_date).toLocaleDateString()}
                      </td>
                      <td className="p-3 text-gray-600">{event.distance}</td>
                      <td className="p-3">
                        <span
                          className={`px-2 py-1 rounded-full text-xs font-semibold ${getStatusBadgeColor(
                            event.processing_status
                          )}`}
                        >
                          {event.processing_status}
                        </span>
                      </td>
                      <td className="p-3 text-gray-600 font-medium">
                        {event.mmr_runner_count}
                      </td>
                      <td className="p-3 text-gray-600 font-medium">
                        {event.mmr_matched_count}
                      </td>
                      <td className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
                            <div
                              className={`h-full ${getMatchHealthColor(
                                event.matchPct
                              )}`}
                              style={{ width: `${Math.min(event.matchPct, 100)}%` }}
                            />
                          </div>
                          <span className="font-semibold text-gray-700 w-10">
                            {event.matchPct.toFixed(0)}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
