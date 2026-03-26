'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import {
  ChevronLeft,
  Loader2,
  AlertCircle,
  Save,
  Trash2,
  ExternalLink,
  Calendar,
} from 'lucide-react'
import { useLang } from '@/lib/i18n/context'

interface MemberData {
  MemberID: string
  FirstName: string
  LastName: string
  Email: string
  NYRRRunnerName: string | null
  YearBorn: number | null
  YearBornGuess: number | null
  Gender: string | null
  Status: string
}

interface RaceData {
  id: number
  nyrr_runner_id: number
  runner_name: string
  bib_number: string | null
  finish_time: string | null
  pace: string | null
  overall_place: number | null
  gender_place: number | null
  age: number | null
  gender: string | null
  match_method: string | null
  event_name: string
  event_date: string
  distance: string
  event_code: string
  event_id: number
}

interface MemberResponse {
  ok: boolean
  data: {
    member: MemberData
    races: RaceData[]
  }
}

export default function MemberProfilePage() {
  const { lang } = useLang()
  const params = useParams()
  const memberId = params?.id as string

  const [member, setMember] = useState<MemberData | null>(null)
  const [races, setRaces] = useState<RaceData[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [nyrrName, setNyrrName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [saveMessage, setSaveMessage] = useState('')
  const [saveError, setSaveError] = useState('')
  const [showUnlinkConfirm, setShowUnlinkConfirm] = useState(false)
  const [unlinking, setUnlinking] = useState(false)

  // Fetch member data on mount
  useEffect(() => {
    async function fetchMember() {
      try {
        setError('')
        const res = await fetch(`/api/nyrr/members/${memberId}`)

        if (!res.ok) {
          throw new Error('Failed to fetch member')
        }

        const data = (await res.json()) as MemberResponse

        if (data.ok && data.data) {
          setMember(data.data.member)
          setRaces(data.data.races || [])
          setNyrrName(data.data.member.NYRRRunnerName || '')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'An error occurred')
      } finally {
        setLoading(false)
      }
    }

    if (memberId) {
      fetchMember()
    }
  }, [memberId])

  // Save NYRR name
  const handleSaveNyrrName = async () => {
    if (!member) return

    setSavingName(true)
    setSaveError('')
    setSaveMessage('')

    try {
      const res = await fetch(`/api/nyrr/members/${memberId}/edit-name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nyrrRunnerName: nyrrName }),
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Failed to save')
      }

      setMember({ ...member, NYRRRunnerName: nyrrName })
      setSaveMessage(
        lang === 'zh' ? '已保存NYRR选手名称' : 'NYRR runner name saved'
      )
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setSavingName(false)
    }
  }

  // Unlink all matches
  const handleUnlink = async () => {
    if (!member) return

    setUnlinking(true)

    try {
      // For now, just clear the NYRR name which will delink matches
      const res = await fetch(`/api/nyrr/members/${memberId}/edit-name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nyrrRunnerName: null }),
      })

      if (!res.ok) {
        throw new Error('Failed to unlink matches')
      }

      setMember({ ...member, NYRRRunnerName: null })
      setNyrrName('')
      setShowUnlinkConfirm(false)
      setSaveMessage(
        lang === 'zh' ? '已解除所有关联' : 'All matches unlinked'
      )
      setTimeout(() => setSaveMessage(''), 3000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'An error occurred')
    } finally {
      setUnlinking(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-400" />
      </div>
    )
  }

  if (!member) {
    return (
      <div className="min-h-screen bg-gray-50 py-10">
        <div className="max-w-7xl mx-auto px-4">
          <Link
            href="/admin/nyrr"
            className="inline-flex items-center gap-2 text-[#0A2342] hover:text-[#C8102E] mb-6 font-medium transition-colors"
          >
            <ChevronLeft className="h-4 w-4" />
            {lang === 'zh' ? '返回' : 'Back'}
          </Link>
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8 text-center">
            <AlertCircle className="h-8 w-8 text-red-500 mx-auto mb-4" />
            <p className="text-gray-600">
              {lang === 'zh' ? '找不到选手信息' : 'Member not found'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="max-w-7xl mx-auto px-4">
        {/* Back Link */}
        <Link
          href="/admin/nyrr"
          className="inline-flex items-center gap-2 text-[#0A2342] hover:text-[#C8102E] mb-6 font-medium transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          {lang === 'zh' ? '返回' : 'Back'}
        </Link>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Member Header Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-start md:justify-between md:gap-6">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <h1 className="text-3xl font-bold text-[#0A2342]">
                  {member.FirstName} {member.LastName}
                </h1>
                <span
                  className={`px-3 py-1 rounded-full text-xs font-semibold ${
                    member.Status === 'Active'
                      ? 'bg-green-100 text-green-700'
                      : member.Status === 'Inactive'
                        ? 'bg-yellow-100 text-yellow-700'
                        : 'bg-gray-100 text-gray-700'
                  }`}
                >
                  {member.Status}
                </span>
              </div>

              <div className="space-y-2 text-gray-600 text-sm mb-4">
                <p>
                  <span className="font-medium text-gray-700">
                    {lang === 'zh' ? '会员ID: ' : 'Member ID: '}
                  </span>
                  {member.MemberID}
                </p>
                <p>
                  <span className="font-medium text-gray-700">
                    {lang === 'zh' ? '邮箱: ' : 'Email: '}
                  </span>
                  <a
                    href={`mailto:${member.Email}`}
                    className="text-[#0A2342] hover:text-[#C8102E] transition-colors"
                  >
                    {member.Email}
                  </a>
                </p>
                {member.Gender && (
                  <p>
                    <span className="font-medium text-gray-700">
                      {lang === 'zh' ? '性别: ' : 'Gender: '}
                    </span>
                    {member.Gender}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* NYRR Name Editor */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="text-lg font-semibold text-[#0A2342] mb-6">
            {lang === 'zh' ? 'NYRR 选手名称' : 'NYRR Runner Name'}
          </h2>

          {saveMessage && (
            <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded-lg text-green-700 text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {saveMessage}
            </div>
          )}

          {saveError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {saveError}
            </div>
          )}

          <div className="space-y-4">
            {/* NYRR Name Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {lang === 'zh' ? 'NYRR名称' : 'NYRR Name'}
              </label>
              <div className="flex gap-3">
                <input
                  type="text"
                  value={nyrrName}
                  onChange={(e) => setNyrrName(e.target.value)}
                  className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0A2342]"
                  placeholder={lang === 'zh' ? '输入NYRR选手名称' : 'Enter NYRR runner name'}
                />
                <button
                  onClick={handleSaveNyrrName}
                  disabled={savingName}
                  className="px-4 py-2 bg-[#0A2342] text-white rounded-lg hover:bg-[#082032] disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium transition-colors"
                >
                  {savingName ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {lang === 'zh' ? '保存中...' : 'Saving...'}
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      {lang === 'zh' ? '保存' : 'Save'}
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Birth Year Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4 border-t border-gray-100">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {lang === 'zh' ? '出生年份' : 'Year Born'}
                </label>
                <input
                  type="text"
                  value={member.YearBorn || '-'}
                  disabled
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  {lang === 'zh' ? '出生年份（估计）' : 'Year Born (Guess)'}
                </label>
                <input
                  type="text"
                  value={member.YearBornGuess || '-'}
                  disabled
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-600"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Unlink Button */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6 mb-6">
          <h2 className="text-lg font-semibold text-[#0A2342] mb-4">
            {lang === 'zh' ? '操作' : 'Actions'}
          </h2>

          {showUnlinkConfirm ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 font-medium mb-4">
                {lang === 'zh'
                  ? '确定要解除所有NYRR比赛关联吗？此操作将清除选手的NYRR名称和所有比赛记录。'
                  : 'Are you sure you want to unlink all NYRR race matches? This will clear the runner\'s NYRR name and race history.'}
              </p>
              <div className="flex gap-3">
                <button
                  onClick={handleUnlink}
                  disabled={unlinking}
                  className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 font-medium transition-colors"
                >
                  {unlinking ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {lang === 'zh' ? '解除中...' : 'Unlinking...'}
                    </>
                  ) : (
                    <>
                      <Trash2 className="h-4 w-4" />
                      {lang === 'zh' ? '确认解除' : 'Confirm Unlink'}
                    </>
                  )}
                </button>
                <button
                  onClick={() => setShowUnlinkConfirm(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 font-medium transition-colors"
                >
                  {lang === 'zh' ? '取消' : 'Cancel'}
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setShowUnlinkConfirm(true)}
              className="px-4 py-2 bg-red-50 text-red-600 border border-red-200 rounded-lg hover:bg-red-100 flex items-center gap-2 font-medium transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              {lang === 'zh'
                ? '解除所有NYRR关联'
                : 'Unlink All NYRR Matches'}
            </button>
          )}
        </div>

        {/* Race History Table */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          <h2 className="text-lg font-semibold text-[#0A2342] mb-6 flex items-center gap-2">
            <Calendar className="h-5 w-5" />
            {lang === 'zh' ? '比赛历史' : 'Race History'}
          </h2>

          {races.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              {lang === 'zh' ? '暂无比赛记录。' : 'No race history found.'}
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
                      {lang === 'zh' ? '号码' : 'Bib'}
                    </th>
                    <th className="text-left p-3 font-semibold">
                      {lang === 'zh' ? '成绩' : 'Time'}
                    </th>
                    <th className="text-left p-3 font-semibold">
                      {lang === 'zh' ? '配速' : 'Pace'}
                    </th>
                    <th className="text-left p-3 font-semibold">
                      {lang === 'zh' ? '名次' : 'Place'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {races.map((race) => (
                    <tr
                      key={race.id}
                      className="border-b border-gray-100 hover:bg-gray-50 transition-colors"
                    >
                      <td className="p-3">
                        <Link
                          href={`/admin/nyrr/events/${race.event_id}`}
                          className="text-[#0A2342] font-medium hover:text-[#C8102E] transition-colors flex items-center gap-2"
                        >
                          {race.event_name}
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                        <p className="text-xs text-gray-400 mt-1">
                          {race.event_code}
                        </p>
                      </td>
                      <td className="p-3 text-gray-600">
                        {new Date(race.event_date).toLocaleDateString()}
                      </td>
                      <td className="p-3 text-gray-600">{race.distance}</td>
                      <td className="p-3 text-gray-600">
                        {race.bib_number || '-'}
                      </td>
                      <td className="p-3 text-gray-600 font-medium">
                        {race.finish_time || '-'}
                      </td>
                      <td className="p-3 text-gray-600">
                        {race.pace || '-'}
                      </td>
                      <td className="p-3 text-gray-600">
                        {race.overall_place ? (
                          <span>
                            {race.overall_place}
                            {race.gender_place && (
                              <span className="text-xs text-gray-400 ml-1">
                                ({lang === 'zh' ? '性' : 'G'}{race.gender_place})
                              </span>
                            )}
                          </span>
                        ) : (
                          '-'
                        )}
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
