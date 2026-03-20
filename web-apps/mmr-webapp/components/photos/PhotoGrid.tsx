'use client'

import { useState } from 'react'
import type { Photo } from '@/types'
import PhotoCard from './PhotoCard'
import PhotoDetailOverlay from './PhotoDetailOverlay'

interface Props {
  photos:      Photo[]
  viewerId:    string
  lang:        'en' | 'zh'
  loading?:    boolean
  emptyLabel?: string
}

export default function PhotoGrid({ photos, viewerId, lang, loading, emptyLabel }: Props) {
  const [selected, setSelected] = useState<Photo | null>(null)
  const [list,     setList]     = useState<Photo[]>(photos)

  // Keep list in sync when props update (pagination appends)
  // Simple: treat photos as source of truth when changed from parent
  function handleUpdate(photoId: string, patch: Partial<Photo>) {
    setList(prev => prev.map(p => p.photoId === photoId ? { ...p, ...patch } : p))
    if (selected?.photoId === photoId)
      setSelected(prev => prev ? { ...prev, ...patch } : prev)
  }

  // Sync to new photos array when it changes length (parent fetched more / new tab)
  const syncedList = photos.length !== list.length
    ? photos
    : list

  if (loading) {
    return (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-48 rounded-xl bg-gray-100 animate-pulse" />
        ))}
      </div>
    )
  }

  if (syncedList.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-4xl mb-3">📷</p>
        <p className="text-sm">{emptyLabel ?? (lang === 'zh' ? '暂无照片' : 'No photos yet')}</p>
      </div>
    )
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {syncedList.map(photo => (
          <PhotoCard
            key={photo.photoId}
            photo={photo}
            viewerId={viewerId}
            lang={lang}
            onClick={setSelected}
          />
        ))}
      </div>

      {selected && (
        <PhotoDetailOverlay
          photo={selected}
          viewerId={viewerId}
          lang={lang}
          onClose={() => setSelected(null)}
          onUpdate={handleUpdate}
        />
      )}
    </>
  )
}
