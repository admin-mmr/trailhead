'use client'

import { useState } from 'react'
import {
  X, Heart, Star, MessageSquare, AlertTriangle,
  UserCheck, UserX, UserPlus, BookImage, Send,
} from 'lucide-react'
import type { Photo, PhotoDetection } from '@/types'
import MemberSearch, { type MemberResult } from './MemberSearch'

interface Props {
  photo:    Photo
  viewerId: string
  lang:     'en' | 'zh'
  onClose:  () => void
  onUpdate: (photoId: string, patch: Partial<Photo>) => void
}

export default function PhotoDetailOverlay({ photo, viewerId, lang, onClose, onUpdate }: Props) {
  const [favorite,    setFavorite]    = useState(photo.isFavorite ?? false)
  const [rating,      setRating]      = useState<number>(photo.myFeedback?.rating ?? 0)
  const [story,       setStory]       = useState(photo.myFeedback?.story ?? '')
  const [saving,      setSaving]      = useState(false)
  const [savedMsg,    setSavedMsg]    = useState('')
  const [activePanel, setActivePanel] = useState<'none' | 'feedback' | 'correct'>('none')
  const [correctDet,  setCorrectDet]  = useState<PhotoDetection | null>(null)
  const [suggestMember, setSuggestMember] = useState<MemberResult | null>(null)
  const [inviteEmail, setInviteEmail] = useState('')

  async function toggleFav() {
    const res  = await fetch(`/api/photos/${photo.photoId}/favorite`, { method: 'POST' })
    const json = await res.json()
    if (json.ok) {
      const next = !favorite
      setFavorite(next)
      onUpdate(photo.photoId, { isFavorite: next })
    }
  }

  async function saveFeedback() {
    if (!rating && !story.trim()) return
    setSaving(true)
    try {
      await fetch(`/api/photos/${photo.photoId}/feedback`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ rating: rating || undefined, story: story.trim() || undefined }),
      })
      setSavedMsg(lang === 'zh' ? '已保存！' : 'Saved!')
      onUpdate(photo.photoId, { myFeedback: { rating: rating || undefined, story: story || undefined } })
    } finally {
      setSaving(false)
      setTimeout(() => setSavedMsg(''), 2500)
    }
  }

  async function addToReferences(det: PhotoDetection) {
    const res  = await fetch(`/api/photos/${photo.photoId}/reference`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ detectionId: det.id }),
    })
    const json = await res.json()
    setSavedMsg(json.ok
      ? (lang === 'zh' ? '已添加到参考库' : 'Added to reference library')
      : (json.error ?? 'Error'))
    setTimeout(() => setSavedMsg(''), 3000)
  }

  async function submitCorrection(det: PhotoDetection, type: 'wrong_person' | 'correct_person' | 'missing_person') {
    const res = await fetch(`/api/photos/detections/${det.id}/correction`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        correctionType:     type,
        suggestedMemberId:  suggestMember?.memberId,
      }),
    })
    const json = await res.json()
    setSavedMsg(json.ok
      ? (lang === 'zh' ? '反馈已提交，感谢！' : 'Correction submitted, thank you!')
      : (json.error ?? 'Error'))
    setActivePanel('none')
    setTimeout(() => setSavedMsg(''), 3000)
  }

  async function sendTagInvite(det: PhotoDetection) {
    if (!inviteEmail.trim()) return
    await fetch(`/api/photos/detections/${det.id}/invite`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ inviteEmail: inviteEmail.trim() }),
    })
    setSavedMsg(lang === 'zh' ? '邀请已发送！' : 'Invite sent!')
    setInviteEmail('')
    setActivePanel('none')
    setTimeout(() => setSavedMsg(''), 3000)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative bg-white rounded-2xl overflow-hidden shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col md:flex-row">

        {/* ── Left: Photo ── */}
        <div className="relative flex-1 bg-black flex items-center justify-center min-h-64">
          {photo.blobThumbUrl
            ? <img src={photo.blobThumbUrl} alt="Photo" className="max-h-[70vh] object-contain w-full" />
            : <span className="text-white/30 text-sm">{lang === 'zh' ? '无图片' : 'No image'}</span>
          }

          {/* Close button */}
          <button
            onClick={onClose}
            className="absolute top-3 right-3 p-1.5 rounded-full bg-black/50 text-white hover:bg-black/70"
          >
            <X className="h-5 w-5" />
          </button>

          {/* Favorite button */}
          <button
            onClick={toggleFav}
            className={`absolute bottom-3 right-3 p-2 rounded-full shadow-md transition-colors ${
              favorite ? 'bg-red-500 text-white' : 'bg-white text-gray-500 hover:bg-red-50 hover:text-red-500'
            }`}
          >
            <Heart className="h-5 w-5" fill={favorite ? 'currentColor' : 'none'} />
          </button>

          {/* Event label */}
          {photo.eventNameEn && (
            <div className="absolute top-3 left-3 bg-black/50 text-white text-xs px-2 py-1 rounded-full">
              {photo.eventNameEn}
            </div>
          )}
        </div>

        {/* ── Right: Info panel ── */}
        <div className="w-full md:w-72 flex flex-col overflow-y-auto">

          {/* Photo meta */}
          <div className="px-5 pt-5 pb-3 border-b border-gray-100">
            <p className="text-xs text-gray-400 font-mono">{photo.photoId}</p>
            {photo.takenAt && (
              <p className="text-xs text-gray-500 mt-0.5">
                {new Date(photo.takenAt).toLocaleDateString()}
              </p>
            )}
          </div>

          {/* ── Detection tags ── */}
          <div className="px-5 py-4 border-b border-gray-100">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              {lang === 'zh' ? '人物标签' : 'People Tags'}
            </h3>
            {photo.detections.length === 0 && (
              <p className="text-sm text-gray-400">
                {lang === 'zh' ? '未检测到人物' : 'No detections'}
              </p>
            )}
            <ul className="space-y-2">
              {photo.detections.map(det => {
                const isMe = det.matchedMemberId === viewerId
                const tagged = det.matchedMemberId && !det.isWrong

                return (
                  <li key={det.id} className={`rounded-xl p-3 text-sm ${
                    det.isWrong ? 'bg-red-50' : isMe ? 'bg-brand-navy/5' : 'bg-gray-50'
                  }`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        {tagged ? (
                          <p className="font-medium">
                            {det.matchedName ?? det.matchedMemberId}
                            {isMe && <span className="ml-1 text-brand-orange text-xs">(You)</span>}
                          </p>
                        ) : det.isWrong ? (
                          <p className="text-red-500 font-medium text-xs">
                            {lang === 'zh' ? '标记有误' : 'Flagged incorrect'}
                          </p>
                        ) : (
                          <p className="text-gray-400 italic text-xs">
                            {lang === 'zh' ? '未识别' : 'Unknown person'}
                          </p>
                        )}
                        {det.bibNormalized && (
                          <p className="text-xs text-gray-500 mt-0.5">
                            Bib #{det.bibNormalized}
                          </p>
                        )}
                      </div>

                      {/* Action icons */}
                      <div className="flex gap-1 flex-shrink-0">
                        {/* Add to references — only for my detections */}
                        {isMe && !det.isWrong && (
                          <button
                            title={lang === 'zh' ? '加入参考库' : 'Add to reference library'}
                            onClick={() => addToReferences(det)}
                            className="p-1 rounded-lg hover:bg-brand-navy/10 text-brand-navy"
                          >
                            <BookImage className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {/* Flag wrong */}
                        {!det.isWrong && (
                          <button
                            title={lang === 'zh' ? '标记错误' : 'Flag as wrong'}
                            onClick={() => { setCorrectDet(det); setActivePanel('correct') }}
                            className="p-1 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500"
                          >
                            <UserX className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {/* Invite unknown */}
                        {!det.matchedMemberId && !det.isWrong && (
                          <button
                            title={lang === 'zh' ? '邀请此人' : 'Invite this person'}
                            onClick={() => { setCorrectDet(det); setActivePanel('correct') }}
                            className="p-1 rounded-lg hover:bg-blue-50 text-gray-400 hover:text-blue-500"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>

          {/* ── Correction / invite panel ── */}
          {activePanel === 'correct' && correctDet && (
            <div className="px-5 py-4 border-b border-gray-100 bg-orange-50">
              <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-3">
                {lang === 'zh' ? '纠正标签' : 'Correct This Tag'}
              </h3>

              <div className="space-y-2">
                {correctDet.matchedMemberId && (
                  <button
                    onClick={() => submitCorrection(correctDet, 'wrong_person')}
                    className="w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-white border border-red-200 text-red-600 hover:bg-red-50"
                  >
                    <AlertTriangle className="h-4 w-4" />
                    {lang === 'zh' ? '标记为错误人员' : 'This is the wrong person'}
                  </button>
                )}

                <div>
                  <p className="text-xs text-gray-500 mb-1.5">
                    {lang === 'zh' ? '建议正确人员：' : 'Suggest who this is:'}
                  </p>
                  <MemberSearch lang={lang} selected={suggestMember} onSelect={setSuggestMember} />
                  {suggestMember && (
                    <button
                      onClick={() => submitCorrection(correctDet, 'correct_person')}
                      className="mt-2 w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-white border border-green-200 text-green-700 hover:bg-green-50"
                    >
                      <UserCheck className="h-4 w-4" />
                      {lang === 'zh' ? '提交建议' : 'Submit suggestion'}
                    </button>
                  )}
                </div>

                {!correctDet.matchedMemberId && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1.5">
                      {lang === 'zh' ? '或邀请他们加入 MMR：' : 'Or invite them to join MMR:'}
                    </p>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder="email@example.com"
                      className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-navy/20"
                    />
                    <button
                      onClick={() => sendTagInvite(correctDet)}
                      disabled={!inviteEmail.trim()}
                      className="mt-2 w-full flex items-center gap-2 text-sm px-3 py-2 rounded-lg bg-white border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-40"
                    >
                      <Send className="h-4 w-4" />
                      {lang === 'zh' ? '发送邀请' : 'Send invite'}
                    </button>
                  </div>
                )}

                <button
                  onClick={() => { setActivePanel('none'); setCorrectDet(null); setSuggestMember(null) }}
                  className="w-full text-xs text-gray-400 hover:text-gray-600 py-1"
                >
                  {lang === 'zh' ? '取消' : 'Cancel'}
                </button>
              </div>
            </div>
          )}

          {/* ── Feedback: rating + story ── */}
          <div className="px-5 py-4 flex-1">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              {lang === 'zh' ? '我的评价' : 'My Feedback'}
            </h3>

            {/* Star rating */}
            <div className="flex gap-1 mb-3">
              {[1, 2, 3, 4, 5].map(n => (
                <button
                  key={n}
                  onClick={() => setRating(rating === n ? 0 : n)}
                  className="p-0.5"
                >
                  <Star
                    className={`h-5 w-5 transition-colors ${
                      n <= rating ? 'fill-yellow-400 text-yellow-400' : 'text-gray-300 hover:text-yellow-200'
                    }`}
                  />
                </button>
              ))}
            </div>

            {/* Story */}
            <textarea
              value={story}
              onChange={e => setStory(e.target.value)}
              maxLength={2000}
              rows={4}
              placeholder={lang === 'zh' ? '写下这张照片的故事…' : 'Share a memory or story…'}
              className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-navy/20 resize-none"
            />

            <div className="flex items-center gap-3 mt-2">
              <button
                onClick={saveFeedback}
                disabled={saving || (!rating && !story.trim())}
                className="btn-primary text-sm py-1.5 px-4 disabled:opacity-40"
              >
                {saving ? (lang === 'zh' ? '保存中…' : 'Saving…') : (lang === 'zh' ? '保存' : 'Save')}
              </button>
              {savedMsg && <p className="text-xs text-green-600">{savedMsg}</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
