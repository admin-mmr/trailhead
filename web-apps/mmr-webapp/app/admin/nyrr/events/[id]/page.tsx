'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ChevronLeft,
  ExternalLink,
  Loader2,
  AlertTriangle,
  TrendingUp,
  Users,
  CheckCircle,
  XCircle,
  HelpCircle,
  Search,
  ChevronDown,
} from 'lucide-react'
import { useLang } from '@/lib/i18n/context'

interface EventData {
  id: number
  event_code: string
  event_name: string
  event_date: string
  distance: string
  location: string
  event_url: string
  processing_status: 'pending' | 'processing' | 'completed' | 'failed'
  result_count: number
  mmr_runner_count: number
  mmr_matched_count: number
  is_upcoming: boolean
  notes?: string
}

interface RunnerData {
  id: number
  nyrr_runner_id: number
  runner_name: string
  first_name: string
  last_name: string
  age: number
  gender: string
  bib_number: string
  finish_time: string | null
  pace: string | null
  overall_place: number | null
  team_code: string | null
  match_method: 'auto_name' | 'auto_lastname' | 'manual' | 'unmatched' | 'not_member' | null
  mmr_member_id: number | null
  member_name: string | null
}

interface RunnerResponse {
  ok: boolean
  data: {
    runners: RunnerData[]
    nextCursor?: string
  }
}

interface CandidateData {
  id: number
  first_name: string
  last_name: string
  email: string
  age: number
  gender: string
  membership_status: string
}

type FilterType = 'all' | 'mmr_only' | 'matched' | 'unmatched' | 'not_member'

const MATCH_METHOD_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  auto_name: { bg: 'bg-green-100', text: 'text-green-700', label: 'Auto Name' },
  auto_lastname: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Auto Last' },
  manual: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'Manual' },
  unmatched: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Unmatched' },
  not_member: { bg: 'bg-gray-100', text: 'text-gray-700', label: 'Not Member' },
}

export default function EventDetailPage() {
  const { lang } = useLang()
  const params = useParams()
  const eventId = params?.id as string

  const [event, setEvent] = useState<EventData | null>(null)
  const [runners, setRunners] = useState<RunnerData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<FilterType>('all')
  const [nextCursor, setNextCursor] = useState<string | undefined>()
  const [loadingMore, setLoadingMore] = useState(false)
  const [selectedRunner, setSelectedRunner] = useState<RunnerData | null>(null)
  const [candidates, setCandidates] = useState<CandidateData[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [matchingRunnerId, setMatchingRunnerId] = useState<number | null>(null)

  const unmatched_count = useMemo(() => {
    if (!event) return 0
    const not_member_count = event.result_count - event.mmr_runner_count
    return event.mmr_runner_count - event.mmr_matched_count - not_member_count
  }, [event])

  // Fetch event details
  useEffect(() => {
    async function fetchEvent() {
      if (!eventId) return
      try {
        const res = await fetch(`/api/nyrr/events/${eventId}`)
        const data = await res.json()
        if (res.ok && data.ok) {
          setEvent(data.data)
        } else {
          setError(data.error || 'Failed to load event')
        }
      } catch {
        setError('Failed to load event')
      }
    }

    fetchEvent()
  }, [eventId])

  // Fetch runners
  useEffect(() => {
    async function fetchRunners() {
      if (!eventId) return
      setLoading(true)
      setError('')
      try {
        const url = new URL(`/api/nyrr/events/${eventId}/runners`, window.location.origin)
        url.searchParams.append('filter', filter)
        url.searchParams.append('limit', '50')
        if (nextCursor) {
          url.searchParams.append('cursor', nextCursor)
        }

        const res = await fetch(url.toString())
        const data: RunnerResponse = await res.json()
        if (res.ok && data.ok) {
          if (nextCursor) {
            setRunners(prev => [...prev, ...data.data.runners])
          } else {
            setRunners(data.data.runners)
          }
          setNextCursor(data.data.nextCursor)
        } else {
          setError('Failed to load runners')
        }
      } catch {
        setError('Failed to load runners')
      } finally {
        setLoading(false)
      }
    }

    if (eventId) {
      setRunners([])
      setNextCursor(undefined)
      fetchRunners()
    }
  }, [eventId, filter])

  // Fetch candidates when quick match is opened
  useEffect(() => {
    async function fetchCandidates() {
      if (!selectedRunner) return
      setLoadingCandidates(true)
      try {
        const lastName = selectedRunner.last_name
        const res = await fetch(`/api/nyrr/candidates/${encodeURIComponent(lastName)}`)
        const data = await res.json()
        if (res.ok && data.ok) {
          setCandidates(data.data)
        } else {
          setCandidates([])
        }
      } catch {
        setCandidates([])
      } finally {
        setLoadingCandidates(false)
      }
    }

    fetchCandidates()
  }, [selectedRunner])

  const handleLoadMore = async () => {
    if (!nextCursor || loadingMore) return
    setLoadingMore(true)
    try {
      const url = new URL(`/api/nyrr/events/${eventId}/runners`, window.location.origin)
      url.searchParams.append('filter', filter)
      url.searchParams.append('limit', '50')
      url.searchParams.append('cursor', nextCursor)

      const res = await fetch(url.toString())
      const data: RunnerResponse = await res.json()
      if (res.ok && data.ok) {
        setRunners(prev => [...prev, ...data.data.runners])
        setNextCursor(data.data.nextCursor)
      }
    } catch {
      setError('Failed to load more runners')
    } finally {
      setLoadingMore(false)
    }
  }

  const handleQuickMatch = async (candidateId: number) => {
    if (!selectedRunner || !event) return
    setMatchingRunnnerId(selectedRunner.id)
    try {
      const res = await fetch('/api/nyrr/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nyrr_runner_id: selectedRunner.nyrr_runner_id,
          mmr_member_id: candidateId,
          event_id: event.id,
          match_method: 'manual',
        }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        // Refresh runners list
        const runnerRes = await fetch(
          `/api/nyrr/events/${eventId}/runners?filter=${filter}&limit=50`
        )
        const runnerData: RunnerResponse = await runnerRes.json()
        if (runnerRes.ok && runnerData.ok) {
          setRunners(runnerData.data.runners)
          setNextCursor(runnerData.data.nextCursor)
        }
        setSelectedRunner(null)
      }
    } catch {
      setError('Failed to match runner')
    } finally {
      setMatchingRunnnerId(null)
    }
  }

  const handleNotMember = async () => {
    if (!selectedRunner || !event) return
    setMatchingRunnnerId(selectedRunner.id)
    try {
      const res = await fetch('/api/nyrr/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nyrr_runner_id: selectedRunner.nyrr_runner_id,
          event_id: event.id,
          match_method: 'not_member',
        }),
      })
      const data = await res.json()
      if (res.ok && data.ok) {
        // Refresh runners list
        const runnerRes = await fetch(
          `/api/nyrr/events/${eventId}/runners?filter=${filter}&limit=50`
        )
        const runnerData: RunnerResponse = await runnerRes.json()
        if (runnerRes.ok && runnerData.ok) {
          setRunners(runnerData.data.runners)
          setNextCursor(runnerData.data.nextCursor)
        }
        setSelectedRunner(null)
      }
    } catch {
      setError('Failed to mark as not member')
    } finally {
      setMatchingRunnnerId(null)
    }
  }

  if (loading && !event) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (error && !event) {
    return (
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-6xl mx-auto px-4">
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            {error}
          </div>
        </div>
      </div>
    )
  }

  if (!event) return null

  const statusColor = {
    pending: 'bg-yellow-100 text-yellow-700',
    processing: 'bg-blue-100 text-blue-700',
    completed: 'bg-green-100 text-green-700',
    failed: 'bg-red-100 text-red-700',
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-7xl mx-auto px-4 space-y-6">
        {/* Back link */}
        <Link
          href="/admin/nyrr"
          className="flex items-center gap-2 text-[#0A2342] hover:text-[#C8102E] font-semibold text-sm transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          {lang === 'zh' ? '返回' : 'Back'}
        </Link>

        {/* Error message */}
        {error && (
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Event Header Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div className="flex-1 min-w-0">
              <h1 className="text-3xl font-bold text-[#0A2342] mb-2">{event.event_name}</h1>
              <div className="space-y-1 text-gray-600">
                <p className="text-sm">
                  <span className="font-semibold">{lang === 'zh' ? '日期:' : 'Date:'}</span>{' '}
                  {new Date(event.event_date).toLocaleDateString()}
                </p>
                <p className="text-sm">
                  <span className="font-semibold">{lang === 'zh' ? '距离:' : 'Distance:'}</span>{' '}
                  {event.distance}
                </p>
                <p className="text-sm">
                  <span className="font-semibold">{lang === 'zh' ? '地点:' : 'Location:'}</span>{' '}
                  {event.location}
                </p>
              </div>
            </div>
            <div className="flex-shrink-0">
              <span
                className={`px-3 py-1.5 rounded-full text-xs font-semibold ${
                  statusColor[event.processing_status]
                }`}
              >
                {event.processing_status.toUpperCase()}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 pt-4 border-t border-gray-100">
            <a
              href={event.event_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-[#0A2342] hover:text-[#C8102E] font-semibold text-sm transition-colors"
            >
              {lang === 'zh' ? '查看 NYRR 成绩' : 'View NYRR Results'}
              <ExternalLink className="h-4 w-4" />
            </a>
            {event.notes && (
              <p className="text-xs text-gray-500 ml-auto">{event.notes}</p>
            )}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {lang === 'zh' ? '总参赛者' : 'Total Runners'}
                </p>
                <p className="text-2xl font-bold text-[#0A2342] mt-2">
                  {event.result_count}
                </p>
              </div>
              <Users className="h-6 w-6 text-gray-300" />
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {lang === 'zh' ? 'MMR 参赛者' : 'MMR Runners'}
                </p>
                <p className="text-2xl font-bold text-[#0A2342] mt-2">
                  {event.mmr_runner_count}
                </p>
              </div>
              <TrendingUp className="h-6 w-6 text-gray-300" />
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {lang === 'zh' ? '已匹配' : 'Matched'}
                </p>
                <p className="text-2xl font-bold text-green-600 mt-2">
                  {event.mmr_matched_count}
                </p>
              </div>
              <CheckCircle className="h-6 w-6 text-green-300" />
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {lang === 'zh' ? '未匹配' : 'Unmatched'}
                </p>
                <p className="text-2xl font-bold text-yellow-600 mt-2">
                  {unmatched_count}
                </p>
              </div>
              <HelpCircle className="h-6 w-6 text-yellow-300" />
            </div>
          </div>

          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  {lang === 'zh' ? '非成员' : 'Not Member'}
                </p>
                <p className="text-2xl font-bold text-gray-600 mt-2">
                  {event.result_count - event.mmr_runner_count}
                </p>
              </div>
              <XCircle className="h-6 w-6 text-gray-300" />
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex gap-2 flex-wrap">
            {(['all', 'mmr_only', 'matched', 'unmatched', 'not_member'] as FilterType[]).map(
              f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
                    filter === f
                      ? 'bg-[#0A2342] text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  {f === 'all' && (lang === 'zh' ? '全部' : 'All')}
                  {f === 'mmr_only' && (lang === 'zh' ? 'MMR 参赛者' : 'MMR Only')}
                  {f === 'matched' && (lang === 'zh' ? '已匹配' : 'Matched')}
                  {f === 'unmatched' && (lang === 'zh' ? '未匹配' : 'Unmatched')}
                  {f === 'not_member' && (lang === 'zh' ? '非成员' : 'Not Member')}
                </button>
              )
            )}
          </div>
        </div>

        {/* Runners Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-[#0A2342] mb-4">
            {lang === 'zh' ? `参赛者 (${runners.length})` : `Runners (${runners.length})`}
          </h2>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left p-3 font-semibold text-gray-700">
                    {lang === 'zh' ? '姓名' : 'Name'}
                  </th>
                  <th className="text-left p-3 font-semibold text-gray-700">
                    {lang === 'zh' ? '号码布' : 'Bib'}
                  </th>
                  <th className="text-left p-3 font-semibold text-gray-700">
                    {lang === 'zh' ? '年龄' : 'Age'}
                  </th>
                  <th className="text-left p-3 font-semibold text-gray-700">
                    {lang === 'zh' ? '性别' : 'Gender'}
                  </th>
                  <th className="text-left p-3 font-semibold text-gray-700">
                    {lang === 'zh' ? '成绩' : 'Time'}
                  </th>
                  <th className="text-left p-3 font-semibold text-gray-700">
                    {lang === 'zh' ? '排名' : 'Place'}
                  </th>
                  <th className="text-left p-3 font-semibold text-gray-700">
                    {lang === 'zh' ? '队伍' : 'Team'}
                  </th>
                  <th className="text-left p-3 font-semibold text-gray-700">
                    {lang === 'zh' ? '匹配状态' : 'Match Status'}
                  </th>
                  <th className="text-left p-3 font-semibold text-gray-700">
                    {lang === 'zh' ? '成员' : 'Member'}
                  </th>
                </tr>
              </thead>
              <tbody>
                {runners.map(runner => {
                  const matchStatus = runner.match_method || 'unmatched'
                  const colors = MATCH_METHOD_COLORS[matchStatus]
                  return (
                    <tr
                      key={runner.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="p-3 font-medium text-gray-900">{runner.runner_name}</td>
                      <td className="p-3 text-gray-700">{runner.bib_number}</td>
                      <td className="p-3 text-gray-700">{runner.age}</td>
                      <td className="p-3 text-gray-700">{runner.gender}</td>
                      <td className="p-3 text-gray-700 font-mono">
                        {runner.finish_time || '–'}
                      </td>
                      <td className="p-3 text-gray-700">
                        {runner.overall_place || '–'}
                      </td>
                      <td className="p-3 text-gray-700">{runner.team_code || '–'}</td>
                      <td className="p-3">
                        <span className={`px-2 py-1 rounded-full text-xs font-semibold ${colors.bg} ${colors.text}`}>
                          {colors.label}
                        </span>
                      </td>
                      <td className="p-3">
                        {runner.match_method === 'unmatched' ? (
                          <button
                            onClick={() => setSelectedRunner(runner)}
                            className="text-[#0A2342] hover:text-[#C8102E] font-semibold text-xs underline"
                          >
                            {lang === 'zh' ? '快速匹配' : 'Quick Match'}
                          </button>
                        ) : runner.member_name ? (
                          <span className="text-gray-900 font-medium">{runner.member_name}</span>
                        ) : (
                          '–'
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {runners.length === 0 && (
            <div className="text-center py-8 text-gray-500">
              {lang === 'zh' ? '没有找到参赛者' : 'No runners found'}
            </div>
          )}

          {nextCursor && (
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="px-6 py-2.5 bg-[#0A2342] text-white rounded-xl font-semibold hover:bg-[#0d2d55] disabled:opacity-50 transition-colors flex items-center gap-2"
              >
                {loadingMore && <Loader2 className="h-4 w-4 animate-spin" />}
                {lang === 'zh' ? '加载更多' : 'Load More'}
              </button>
            </div>
          )}
        </div>

        {/* Quick Match Modal */}
        {selectedRunner && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
            <div className="bg-white rounded-2xl shadow-lg max-w-lg w-full max-h-[90vh] overflow-y-auto">
              <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
                <h3 className="text-xl font-bold text-[#0A2342]">
                  {lang === 'zh' ? '快速匹配' : 'Quick Match'}
                </h3>
                <button
                  onClick={() => setSelectedRunner(null)}
                  className="text-gray-400 hover:text-gray-600 transition-colors"
                >
                  <ChevronDown className="h-6 w-6 rotate-180" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="p-4 bg-gray-50 rounded-xl">
                  <p className="text-sm font-semibold text-gray-700 mb-1">
                    {lang === 'zh' ? '参赛者' : 'Runner'}
                  </p>
                  <p className="text-lg font-bold text-[#0A2342]">
                    {selectedRunner.runner_name}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {lang === 'zh' ? '号码布:' : 'Bib:'} {selectedRunner.bib_number}
                  </p>
                </div>

                <div>
                  <p className="text-sm font-semibold text-gray-700 mb-3">
                    {lang === 'zh' ? '候选成员' : 'Candidate Members'}
                  </p>

                  {loadingCandidates ? (
                    <div className="flex justify-center py-6">
                      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    </div>
                  ) : candidates.length > 0 ? (
                    <div className="space-y-2 max-h-64 overflow-y-auto">
                      {candidates.map(candidate => (
                        <button
                          key={candidate.id}
                          onClick={() => handleQuickMatch(candidate.id)}
                          disabled={matchingRunnerId === selectedRunner.id}
                          className="w-full p-3 border border-gray-200 rounded-xl hover:border-[#0A2342] hover:bg-blue-50 transition-colors text-left disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1">
                              <p className="font-semibold text-[#0A2342]">
                                {candidate.first_name} {candidate.last_name}
                              </p>
                              <p className="text-xs text-gray-600">{candidate.email}</p>
                              <p className="text-xs text-gray-500 mt-1">
                                {lang === 'zh' ? '年龄:' : 'Age:'} {candidate.age} ·{' '}
                                {lang === 'zh' ? '性别:' : 'Gender:'} {candidate.gender}
                              </p>
                            </div>
                            {matchingRunnerId === selectedRunner.id && (
                              <Loader2 className="h-4 w-4 animate-spin text-gray-400 flex-shrink-0 mt-1" />
                            )}
                          </div>
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="text-center py-6 text-gray-500 text-sm">
                      {lang === 'zh'
                        ? '没有找到候选成员'
                        : 'No candidate members found'}
                    </div>
                  )}
                </div>

                <div className="border-t border-gray-200 pt-4">
                  <button
                    onClick={handleNotMember}
                    disabled={matchingRunnerId === selectedRunner.id}
                    className="w-full px-4 py-2.5 border border-gray-300 text-gray-700 rounded-xl font-semibold hover:bg-gray-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                  >
                    {matchingRunnerId === selectedRunner.id && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}
                    {lang === 'zh' ? '标记为非成员' : 'Mark as Not Member'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
