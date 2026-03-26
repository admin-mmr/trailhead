'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLang } from '@/lib/i18n/context'
import {
  ArrowLeft,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Users,
  Calendar,
  Clock,
  Zap,
  X,
} from 'lucide-react'

interface Runner {
  id: number
  runner_name: string
  first_name: string
  last_name: string
  age: number
  gender: string
  bib_number: string
  finish_time: string
}

interface EventGroup {
  event_id: string
  event_name: string
  event_date: string
  runners: Runner[]
}

interface UnmatchedData {
  groups: EventGroup[]
  totalCount: number
}

interface Candidate {
  MemberID: string
  FirstName: string
  LastName: string
  Email: string
  YearBorn: number | null
  Status: string
  Gender: string
  NYRRRunnerName: string | null
}

interface Toast {
  id: string
  message: string
  type: 'success' | 'error'
}

export default function MatchReviewPage() {
  const { lang } = useLang()

  // Data states
  const [unmatched, setUnmatched] = useState<EventGroup[]>([])
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Selection states
  const [selectedRunner, setSelectedRunner] = useState<Runner | null>(null)
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [loadingCandidates, setLoadingCandidates] = useState(false)
  const [candidatesError, setCandidatesError] = useState('')

  // UI states
  const [toasts, setToasts] = useState<Toast[]>([])
  const [matchingId, setMatchingId] = useState<string | null>(null)

  // Fetch unmatched runners
  useEffect(() => {
    async function fetchUnmatched() {
      try {
        setError('')
        const res = await fetch('/api/nyrr/unmatched')

        if (!res.ok) {
          throw new Error('Failed to fetch unmatched runners')
        }

        const data = await res.json()

        if (data.ok && data.data) {
          setUnmatched(data.data.groups || [])
          setTotalCount(data.data.totalCount || 0)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchUnmatched()
  }, [])

  // Fetch candidates when runner is selected
  useEffect(() => {
    async function fetchCandidates() {
      if (!selectedRunner) {
        setCandidates([])
        return
      }

      try {
        setLoadingCandidates(true)
        setCandidatesError('')

        const lastName = selectedRunner.last_name
        const res = await fetch(`/api/nyrr/candidates/${encodeURIComponent(lastName)}`)

        if (!res.ok) {
          throw new Error('Failed to fetch candidates')
        }

        const data = await res.json()

        if (data.ok && Array.isArray(data.data)) {
          // Rank candidates: first-name matches first
          const ranked = data.data.sort((a: Candidate, b: Candidate) => {
            const aFirstNameMatch = a.FirstName.toLowerCase() === selectedRunner.first_name.toLowerCase() ? 0 : 1
            const bFirstNameMatch = b.FirstName.toLowerCase() === selectedRunner.first_name.toLowerCase() ? 0 : 1
            return aFirstNameMatch - bFirstNameMatch
          })
          setCandidates(ranked)
        }
      } catch (err) {
        setCandidatesError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoadingCandidates(false)
      }
    }

    fetchCandidates()
  }, [selectedRunner])

  // Add toast notification
  const addToast = (message: string, type: 'success' | 'error') => {
    const id = Math.random().toString(36).substr(2, 9)
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, 3000)
  }

  // Handle confirm match
  const handleConfirmMatch = async (memberId: string) => {
    if (!selectedRunner) return

    setMatchingId(memberId)
    try {
      const res = await fetch('/api/nyrr/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runnerId: selectedRunner.id,
          memberId: memberId,
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to confirm match')
      }

      addToast(
        lang === 'zh' ? '匹配成功！' : 'Match confirmed!',
        'success'
      )

      // Remove matched runner from unmatched list
      const updatedGroups = unmatched.map(group => ({
        ...group,
        runners: group.runners.filter(r => r.id !== selectedRunner.id),
      })).filter(group => group.runners.length > 0)

      setUnmatched(updatedGroups)
      setTotalCount(Math.max(0, totalCount - 1))

      // Select next runner
      if (updatedGroups.length > 0) {
        const nextRunner = updatedGroups[0].runners[0]
        setSelectedRunner(nextRunner)
        setSelectedEventId(updatedGroups[0].event_id)
      } else {
        setSelectedRunner(null)
        setSelectedEventId(null)
      }
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to confirm match',
        'error'
      )
    } finally {
      setMatchingId(null)
    }
  }

  // Handle not a member
  const handleNotAMember = async () => {
    if (!selectedRunner) return

    setMatchingId('not_member')
    try {
      const res = await fetch('/api/nyrr/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          runnerId: selectedRunner.id,
          memberId: null,
          matchMethod: 'not_member',
        }),
      })

      if (!res.ok) {
        throw new Error('Failed to mark as not a member')
      }

      addToast(
        lang === 'zh' ? '已标记为非会员' : 'Marked as not a member',
        'success'
      )

      // Remove runner from unmatched list
      const updatedGroups = unmatched.map(group => ({
        ...group,
        runners: group.runners.filter(r => r.id !== selectedRunner.id),
      })).filter(group => group.runners.length > 0)

      setUnmatched(updatedGroups)
      setTotalCount(Math.max(0, totalCount - 1))

      // Select next runner
      if (updatedGroups.length > 0) {
        const nextRunner = updatedGroups[0].runners[0]
        setSelectedRunner(nextRunner)
        setSelectedEventId(updatedGroups[0].event_id)
      } else {
        setSelectedRunner(null)
        setSelectedEventId(null)
      }
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : 'Failed to mark as not a member',
        'error'
      )
    } finally {
      setMatchingId(null)
    }
  }

  // Handle skip
  const handleSkip = () => {
    setSelectedRunner(null)
    setCandidates([])
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  const getStatusBadgeColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'active':
        return 'bg-green-100 text-green-700'
      case 'inactive':
        return 'bg-gray-100 text-gray-700'
      case 'pending':
        return 'bg-yellow-100 text-yellow-700'
      default:
        return 'bg-gray-100 text-gray-700'
    }
  }

  const allMatched = unmatched.length === 0 || unmatched.every(g => g.runners.length === 0)

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-7xl mx-auto px-4">
        {/* Page Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link
            href="/admin/nyrr"
            className="p-2 hover:bg-gray-200 rounded-lg transition-colors"
          >
            <ArrowLeft className="h-5 w-5 text-gray-600" />
          </Link>
          <div>
            <h1 className="text-2xl font-bold text-[#0A2342]">
              {lang === 'zh' ? '匹配审核' : 'Match Review'}
            </h1>
            <p className="text-sm text-gray-500 mt-1">
              {lang === 'zh'
                ? '查看并确认未匹配的选手'
                : 'Review and confirm unmatched runners'}
            </p>
          </div>
          {totalCount > 0 && (
            <div className="ml-auto bg-red-100 text-red-700 px-4 py-2 rounded-full font-semibold text-sm">
              {totalCount} {lang === 'zh' ? '个待处理' : 'pending'}
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="flex gap-4 mb-8 border-b border-gray-200">
          <Link
            href="/admin/nyrr"
            className="px-4 py-3 font-semibold text-gray-500 border-b-2 border-transparent hover:text-gray-700 hover:border-gray-300"
          >
            {lang === 'zh' ? '概览' : 'Overview'}
          </Link>
          <div className="px-4 py-3 font-semibold text-[#0A2342] border-b-2 border-[#0A2342]">
            {lang === 'zh' ? '比赛审核' : 'Match Review'}
          </div>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* All Matched Success State */}
        {allMatched ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-12 text-center">
            <div className="flex justify-center mb-6">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center">
                <CheckCircle2 className="h-8 w-8 text-green-600" />
              </div>
            </div>
            <h2 className="text-2xl font-bold text-[#0A2342] mb-2">
              {lang === 'zh' ? '全部处理完毕！' : 'All caught up!'}
            </h2>
            <p className="text-gray-500">
              {lang === 'zh'
                ? '所有选手都已成功匹配或标记'
                : 'All runners have been successfully matched or marked'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left Panel - Unmatched Runners */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-[#0A2342] mb-6">
                {lang === 'zh' ? '未匹配的选手' : 'Unmatched Runners'}
              </h2>

              <div className="space-y-6">
                {unmatched.map((group) => (
                  <div key={group.event_id}>
                    {/* Event Group Header */}
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <h3 className="font-semibold text-[#0A2342]">
                          {group.event_name}
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">
                          {new Date(group.event_date).toLocaleDateString(
                            lang === 'zh' ? 'zh-CN' : 'en-US'
                          )}
                        </p>
                      </div>
                      <div className="bg-blue-100 text-blue-700 px-3 py-1 rounded-full text-sm font-semibold">
                        {group.runners.length}
                      </div>
                    </div>

                    {/* Runner Cards */}
                    <div className="space-y-2">
                      {group.runners.map((runner) => (
                        <button
                          key={runner.id}
                          onClick={() => {
                            setSelectedRunner(runner)
                            setSelectedEventId(group.event_id)
                          }}
                          className={`w-full text-left p-3 rounded-xl border-2 transition-all ${
                            selectedRunner?.id === runner.id
                              ? 'border-[#C8102E] bg-red-50'
                              : 'border-gray-200 bg-gray-50 hover:border-gray-300'
                          }`}
                        >
                          <p className="font-semibold text-sm text-[#0A2342]">
                            {runner.runner_name}
                          </p>
                          <div className="grid grid-cols-3 gap-2 mt-2 text-xs text-gray-600">
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400">Age:</span>
                              <span>{runner.age}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400">Gender:</span>
                              <span>{runner.gender}</span>
                            </div>
                            <div className="flex items-center gap-1">
                              <span className="text-gray-400">Bib:</span>
                              <span className="font-mono">{runner.bib_number}</span>
                            </div>
                          </div>
                          <div className="mt-2 text-xs text-gray-500">
                            {lang === 'zh' ? '完成时间：' : 'Finish time: '}
                            <span className="font-mono">{runner.finish_time}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right Panel - Member Candidates */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <h2 className="text-lg font-semibold text-[#0A2342] mb-6">
                {lang === 'zh' ? '候选会员' : 'Member Candidates'}
              </h2>

              {!selectedRunner ? (
                <div className="flex flex-col items-center justify-center h-64 text-center">
                  <Users className="h-12 w-12 text-gray-300 mb-3" />
                  <p className="text-gray-500">
                    {lang === 'zh'
                      ? '选择跑者以查找匹配'
                      : 'Select a runner to find matches'}
                  </p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Selected Runner Summary */}
                  <div className="bg-blue-50 rounded-xl p-4 border border-blue-200 mb-6">
                    <p className="text-xs text-blue-600 uppercase font-semibold mb-1">
                      {lang === 'zh' ? '选中的选手' : 'Selected runner'}
                    </p>
                    <p className="font-semibold text-[#0A2342]">
                      {selectedRunner.runner_name}
                    </p>
                    <p className="text-xs text-gray-600 mt-1">
                      {selectedRunner.first_name} {selectedRunner.last_name}
                    </p>
                  </div>

                  {/* Loading State */}
                  {loadingCandidates && (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="h-5 w-5 animate-spin text-gray-400" />
                    </div>
                  )}

                  {/* Error State */}
                  {candidatesError && (
                    <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 flex-shrink-0" />
                      {candidatesError}
                    </div>
                  )}

                  {/* Candidates List */}
                  {!loadingCandidates && candidates.length === 0 && (
                    <div className="text-center py-8">
                      <p className="text-gray-500">
                        {lang === 'zh'
                          ? '未找到匹配的候选会员'
                          : 'No matching candidates found'}
                      </p>
                    </div>
                  )}

                  {!loadingCandidates && candidates.length > 0 && (
                    <div className="space-y-3">
                      {candidates.map((candidate) => (
                        <div
                          key={candidate.MemberID}
                          className="bg-gray-50 rounded-xl p-4 border border-gray-200"
                        >
                          {/* Candidate Info */}
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex-1">
                              <p className="font-semibold text-[#0A2342]">
                                {candidate.FirstName} {candidate.LastName}
                              </p>
                              <p className="text-xs text-gray-500 mt-0.5">
                                ID: <span className="font-mono">{candidate.MemberID}</span>
                              </p>
                              <p className="text-xs text-gray-500 truncate">
                                {candidate.Email}
                              </p>
                            </div>
                            {candidate.Status && (
                              <span
                                className={`px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap ml-2 ${getStatusBadgeColor(
                                  candidate.Status
                                )}`}
                              >
                                {candidate.Status}
                              </span>
                            )}
                          </div>

                          {/* Candidate Details */}
                          <div className="grid grid-cols-2 gap-2 mb-3 text-xs text-gray-600">
                            <div>
                              <span className="text-gray-400">
                                {lang === 'zh' ? '出生年份：' : 'Year born: '}
                              </span>
                              {candidate.YearBorn ? candidate.YearBorn : '—'}
                            </div>
                            <div>
                              <span className="text-gray-400">
                                {lang === 'zh' ? '性别：' : 'Gender: '}
                              </span>
                              {candidate.Gender}
                            </div>
                          </div>

                          {candidate.NYRRRunnerName && (
                            <div className="mb-3 p-2 bg-blue-50 rounded-lg text-xs text-blue-700">
                              <span className="font-semibold">NYRR Name:</span> {candidate.NYRRRunnerName}
                            </div>
                          )}

                          {/* Action Buttons */}
                          <div className="flex gap-2">
                            <button
                              onClick={() => handleConfirmMatch(candidate.MemberID)}
                              disabled={matchingId !== null}
                              className="flex-1 px-3 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                            >
                              {matchingId === candidate.MemberID && (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              )}
                              {lang === 'zh' ? '确认匹配' : 'Confirm'}
                            </button>
                            <button
                              onClick={() => handleNotAMember()}
                              disabled={matchingId !== null}
                              className="px-3 py-2 bg-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-400 transition-colors disabled:bg-gray-300 disabled:cursor-not-allowed"
                              title={lang === 'zh' ? '标记为非会员' : 'Not a member'}
                            >
                              {lang === 'zh' ? '非会员' : 'Not a member'}
                            </button>
                          </div>
                        </div>
                      ))}

                      {/* Skip Button */}
                      <button
                        onClick={handleSkip}
                        disabled={matchingId !== null}
                        className="w-full px-4 py-2 border border-gray-300 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors disabled:bg-gray-50 disabled:cursor-not-allowed"
                      >
                        {lang === 'zh' ? '跳过' : 'Skip'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Toasts */}
      <div className="fixed bottom-4 right-4 space-y-2 z-50">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium ${
              toast.type === 'success'
                ? 'bg-green-600 text-white'
                : 'bg-red-600 text-white'
            }`}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <AlertCircle className="h-4 w-4" />
            )}
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  )
}
