'use client'

import { useState, useEffect, useCallback } from 'react'
import { Image, BookOpen, Heart, ChevronLeft, ChevronRight, User, BookImage, Tag } from 'lucide-react'
import Link from 'next/link'
import { useLang }  from '@/lib/i18n/context'
import type { Photo, PhotoEvent } from '@/types'
import type { PhotoSortKey } from '@/lib/db/photos'
import PhotoGrid   from '@/components/photos/PhotoGrid'
import SortBar     from '@/components/photos/SortBar'
import MemberSearch, { type MemberResult } from '@/components/photos/MemberSearch'

type Tab = 'mine' | 'albums' | 'favorites'

const PAGE_SIZE = 40

export default function PhotosPage() {
  const { lang } = useLang()

  // ── Auth / session ────────────────────────────────────────────
  const [viewerId, setViewerId] = useState('')
  useEffect(() => {
    fetch('/api/members/me').then(r => r.json()).then(j => {
      if (j.ok) setViewerId(j.data.memberId)
    })
  }, [])

  // ── Tab state ─────────────────────────────────────────────────
  const [tab, setTab] = useState<Tab>('mine')

  // ── Sort state ────────────────────────────────────────────────
  const [sort, setSort] = useState<PhotoSortKey>('date_desc')

  // ── My Photos / Friend lookup ─────────────────────────────────
  const [friendTarget,  setFriendTarget]  = useState<MemberResult | null>(null)
  const [myPhotos,      setMyPhotos]      = useState<Photo[]>([])
  const [myPage,        setMyPage]        = useState(1)
  const [myLoading,     setMyLoading]     = useState(false)
  const [myHasMore,     setMyHasMore]     = useState(false)

  const fetchMyPhotos = useCallback(async (page: number, s: PhotoSortKey, target?: string | null) => {
    setMyLoading(true)
    try {
      const memberId = target ?? undefined
      const qs = new URLSearchParams({
        page: String(page), pageSize: String(PAGE_SIZE), sort: s,
        ...(memberId ? { memberId } : {}),
      })
      const res  = await fetch(`/api/photos/my?${qs}`)
      const json = await res.json()
      if (json.ok) {
        setMyPhotos(prev => page === 1 ? json.data : [...prev, ...json.data])
        setMyHasMore(json.data.length === PAGE_SIZE)
      }
    } finally {
      setMyLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab !== 'mine') return
    setMyPage(1)
    fetchMyPhotos(1, sort, friendTarget?.memberId)
  }, [tab, sort, friendTarget, fetchMyPhotos])

  // ── Albums ────────────────────────────────────────────────────
  const [albums,        setAlbums]        = useState<PhotoEvent[]>([])
  const [albumsLoading, setAlbumsLoading] = useState(false)
  const [selectedAlbum, setSelectedAlbum] = useState<PhotoEvent | null>(null)
  const [albumPhotos,   setAlbumPhotos]   = useState<Photo[]>([])
  const [albumPage,     setAlbumPage]     = useState(1)
  const [albumLoading,  setAlbumLoading]  = useState(false)
  const [albumHasMore,  setAlbumHasMore]  = useState(false)

  useEffect(() => {
    if (tab !== 'albums' || albums.length > 0) return
    setAlbumsLoading(true)
    fetch('/api/photos/albums')
      .then(r => r.json())
      .then(j => { if (j.ok) setAlbums(j.data) })
      .finally(() => setAlbumsLoading(false))
  }, [tab, albums.length])

  const fetchAlbumPhotos = useCallback(async (eventId: string, page: number, s: PhotoSortKey) => {
    setAlbumLoading(true)
    try {
      const qs  = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort: s })
      const res = await fetch(`/api/photos/albums/${eventId}?${qs}`)
      const json = await res.json()
      if (json.ok) {
        setAlbumPhotos(prev => page === 1 ? json.data : [...prev, ...json.data])
        setAlbumHasMore(json.data.length === PAGE_SIZE)
      }
    } finally {
      setAlbumLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!selectedAlbum) return
    setAlbumPage(1)
    fetchAlbumPhotos(selectedAlbum.eventId, 1, sort)
  }, [selectedAlbum, sort, fetchAlbumPhotos])

  // ── Favorites ─────────────────────────────────────────────────
  const [favPhotos,   setFavPhotos]   = useState<Photo[]>([])
  const [favPage,     setFavPage]     = useState(1)
  const [favLoading,  setFavLoading]  = useState(false)
  const [favHasMore,  setFavHasMore]  = useState(false)

  const fetchFavorites = useCallback(async (page: number, s: PhotoSortKey) => {
    setFavLoading(true)
    try {
      const qs  = new URLSearchParams({ page: String(page), pageSize: String(PAGE_SIZE), sort: s })
      const res = await fetch(`/api/photos/favorites?${qs}`)
      const json = await res.json()
      if (json.ok) {
        setFavPhotos(prev => page === 1 ? json.data : [...prev, ...json.data])
        setFavHasMore(json.data.length === PAGE_SIZE)
      }
    } finally {
      setFavLoading(false)
    }
  }, [])

  useEffect(() => {
    if (tab !== 'favorites') return
    setFavPage(1)
    fetchFavorites(1, sort)
  }, [tab, sort, fetchFavorites])

  // ── Tab definitions ───────────────────────────────────────────
  const TABS = [
    { id: 'mine' as Tab,      icon: User,    en: 'My Photos',   zh: '我的照片' },
    { id: 'albums' as Tab,    icon: BookOpen, en: 'All Albums',  zh: '所有相册' },
    { id: 'favorites' as Tab, icon: Heart,   en: 'Favorites',   zh: '我的收藏' },
  ]

  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="section-title">{lang === 'zh' ? '照片' : 'Photos'}</h1>
          <p className="text-gray-500 text-sm">
            {lang === 'zh'
              ? '浏览活动照片，标记人物，收藏喜爱的瞬间。'
              : 'Browse race photos, tag people, and save your favourite moments.'}
          </p>
        </div>
        {/* Quick links to sub-pages */}
        <div className="flex gap-2 text-xs">
          <Link
            href="/portal/photos/references"
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-brand-navy hover:text-brand-navy transition-colors"
          >
            <BookImage className="h-3.5 w-3.5" />
            {lang === 'zh' ? '参考照片' : 'My References'}
          </Link>
          <Link
            href="/portal/photos/bibs"
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:border-brand-navy hover:text-brand-navy transition-colors"
          >
            <Tag className="h-3.5 w-3.5" />
            {lang === 'zh' ? '号码布' : 'Bibs'}
          </Link>
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex border-b border-gray-200 gap-1">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => { setTab(t.id); setSort('date_desc') }}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.id
                ? 'border-brand-navy text-brand-navy'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            <t.icon className="h-4 w-4" />
            {lang === 'zh' ? t.zh : t.en}
          </button>
        ))}
      </div>

      {/* ── My Photos tab ── */}
      {tab === 'mine' && (
        <div className="space-y-4">
          {/* Friend lookup + Sort */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-48 max-w-xs">
              <MemberSearch
                lang={lang}
                selected={friendTarget}
                onSelect={setFriendTarget}
                placeholder={lang === 'zh' ? '查看朋友的照片…' : 'Browse a friend\'s photos…'}
              />
            </div>
            <SortBar value={sort} onChange={s => { setSort(s); setMyPage(1) }} lang={lang} />
          </div>

          {friendTarget && (
            <div className="text-sm text-gray-500">
              {lang === 'zh'
                ? `正在查看：${friendTarget.firstName} ${friendTarget.lastName} 的照片`
                : `Showing photos of ${friendTarget.firstName} ${friendTarget.lastName}`}
            </div>
          )}

          <PhotoGrid
            photos={myPhotos}
            viewerId={viewerId}
            lang={lang}
            loading={myLoading && myPage === 1}
            emptyLabel={lang === 'zh' ? '暂无您的照片' : 'No photos found yet'}
          />

          {myHasMore && (
            <div className="text-center pt-2">
              <button
                onClick={() => {
                  const next = myPage + 1
                  setMyPage(next)
                  fetchMyPhotos(next, sort, friendTarget?.memberId)
                }}
                disabled={myLoading}
                className="btn-secondary text-sm"
              >
                {myLoading ? (lang === 'zh' ? '加载中…' : 'Loading…') : (lang === 'zh' ? '加载更多' : 'Load more')}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── All Albums tab ── */}
      {tab === 'albums' && (
        <div className="space-y-4">
          {selectedAlbum ? (
            <>
              {/* Album header */}
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  onClick={() => { setSelectedAlbum(null); setAlbumPhotos([]) }}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-brand-navy"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {lang === 'zh' ? '返回相册' : 'Back to albums'}
                </button>
                <h2 className="font-semibold text-gray-800">
                  {selectedAlbum.nameEn}
                </h2>
                {selectedAlbum.eventDate && (
                  <span className="text-sm text-gray-500">{selectedAlbum.eventDate}</span>
                )}
                <div className="ml-auto">
                  <SortBar value={sort} onChange={s => { setSort(s); setAlbumPage(1) }} lang={lang} />
                </div>
              </div>

              <PhotoGrid
                photos={albumPhotos}
                viewerId={viewerId}
                lang={lang}
                loading={albumLoading && albumPage === 1}
              />

              {albumHasMore && (
                <div className="text-center pt-2">
                  <button
                    onClick={() => {
                      const next = albumPage + 1
                      setAlbumPage(next)
                      fetchAlbumPhotos(selectedAlbum.eventId, next, sort)
                    }}
                    disabled={albumLoading}
                    className="btn-secondary text-sm"
                  >
                    {albumLoading ? (lang === 'zh' ? '加载中…' : 'Loading…') : (lang === 'zh' ? '加载更多' : 'Load more')}
                  </button>
                </div>
              )}
            </>
          ) : (
            /* Album grid */
            albumsLoading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="h-28 rounded-xl bg-gray-100 animate-pulse" />
                ))}
              </div>
            ) : albums.length === 0 ? (
              <div className="text-center py-20 text-gray-400">
                <p className="text-4xl mb-3">📷</p>
                <p className="text-sm">{lang === 'zh' ? '暂无相册' : 'No albums yet'}</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {albums.map(album => (
                  <button
                    key={album.eventId}
                    onClick={() => setSelectedAlbum(album)}
                    className="card p-5 text-left hover:shadow-md transition-shadow flex items-center justify-between gap-4"
                  >
                    <div>
                      <p className="font-semibold text-gray-800">{album.nameEn}</p>
                      {album.nameZh && <p className="text-gray-500 text-sm">{album.nameZh}</p>}
                      <p className="text-xs text-gray-400 mt-1">
                        {album.eventDate ?? album.eventId}
                        {' · '}
                        {album.photosTotal.toLocaleString()} {lang === 'zh' ? '张' : 'photos'}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 text-gray-300 flex-shrink-0" />
                  </button>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {/* ── Favorites tab ── */}
      {tab === 'favorites' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <SortBar value={sort} onChange={s => { setSort(s); setFavPage(1) }} lang={lang} />
          </div>

          <PhotoGrid
            photos={favPhotos}
            viewerId={viewerId}
            lang={lang}
            loading={favLoading && favPage === 1}
            emptyLabel={lang === 'zh' ? '还没有收藏的照片' : 'No favourites yet — star a photo to save it here'}
          />

          {favHasMore && (
            <div className="text-center pt-2">
              <button
                onClick={() => {
                  const next = favPage + 1
                  setFavPage(next)
                  fetchFavorites(next, sort)
                }}
                disabled={favLoading}
                className="btn-secondary text-sm"
              >
                {favLoading ? (lang === 'zh' ? '加载中…' : 'Loading…') : (lang === 'zh' ? '加载更多' : 'Load more')}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
