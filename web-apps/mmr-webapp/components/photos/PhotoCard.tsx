'use client'

import Image from 'next/image'

import { useState } from 'react'
import { Heart, Star, MessageSquare } from 'lucide-react'
import type { Photo } from '@/types'

interface Props {
  photo:     Photo
  viewerId:  string
  lang:      'en' | 'zh'
  onClick:   (photo: Photo) => void
}

export default function PhotoCard({ photo, viewerId, lang, onClick }: Props) {
  const [favorite, setFavorite] = useState(photo.isFavorite ?? false)
  const [toggling, setToggling] = useState(false)

  async function toggleFav(e: React.MouseEvent) {
    e.stopPropagation()
    if (toggling) return
    setToggling(true)
    try {
      const res  = await fetch(`/api/photos/${photo.photoId}/favorite`, { method: 'POST' })
      const json = await res.json()
      if (json.ok) setFavorite(json.data?.isFavorite ?? !favorite)
    } finally {
      setToggling(false)
    }
  }

  // Detections that are matched and not wrong — show as name tags
  const tags = photo.detections.filter(d => d.matchedMemberId && !d.isWrong)
  const myMatch = photo.detections.find(
    d => d.matchedMemberId === viewerId && !d.isWrong
  )

  return (
    <div
      className="group relative cursor-pointer rounded-xl overflow-hidden bg-gray-100 shadow-sm hover:shadow-md transition-shadow"
      onClick={() => onClick(photo)}
    >
      {/* Thumbnail */}
      {photo.blobThumbUrl ? (
        <Image
          src={photo.blobThumbUrl}
          alt={`Photo from ${photo.eventNameEn ?? photo.eventId}`}
          className="w-full h-48 object-cover group-hover:scale-105 transition-transform duration-300"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-48 flex items-center justify-center text-gray-400 text-xs">
          {lang === 'zh' ? '无预览' : 'No preview'}
        </div>
      )}

      {/* "You're in this photo" indicator */}
      {myMatch && (
        <div className="absolute top-2 left-2 bg-brand-orange text-white text-xs font-bold px-2 py-0.5 rounded-full shadow">
          {lang === 'zh' ? '我' : 'You'}
        </div>
      )}

      {/* Favorite button */}
      <button
        onClick={toggleFav}
        disabled={toggling}
        className={`absolute top-2 right-2 p-1.5 rounded-full shadow transition-colors ${
          favorite
            ? 'bg-red-500 text-white'
            : 'bg-white/80 text-gray-500 hover:bg-red-50 hover:text-red-400'
        }`}
        aria-label={favorite
          ? (lang === 'zh' ? '取消收藏' : 'Unfavorite')
          : (lang === 'zh' ? '收藏' : 'Favorite')}
      >
        <Heart className="h-3.5 w-3.5" fill={favorite ? 'currentColor' : 'none'} />
      </button>

      {/* Bottom bar: tags + feedback indicators */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
        {/* Name tags */}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-1">
            {tags.slice(0, 3).map(d => (
              <span
                key={d.id}
                className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                  d.matchedMemberId === viewerId
                    ? 'bg-brand-orange text-white'
                    : 'bg-white/20 text-white'
                }`}
              >
                {d.matchedName ?? d.matchedMemberId}
              </span>
            ))}
            {tags.length > 3 && (
              <span className="text-xs px-1.5 py-0.5 rounded-full bg-white/20 text-white">
                +{tags.length - 3}
              </span>
            )}
          </div>
        )}

        {/* Feedback micro-stats */}
        <div className="flex items-center gap-2.5 text-white/70">
          {photo.myFeedback?.rating && (
            <span className="flex items-center gap-0.5 text-xs">
              <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
              {photo.myFeedback.rating}
            </span>
          )}
          {photo.myFeedback?.story && (
            <span className="flex items-center gap-0.5 text-xs">
              <MessageSquare className="h-3 w-3" />
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
