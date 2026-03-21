'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import Image from 'next/image'
import { useLang } from '@/lib/i18n/context'
import Navbar from '@/components/layout/Navbar'
import { Save, Eye, Send, ImageIcon, Tag, Globe } from 'lucide-react'
import type { ContentBlock } from '@/types'

// Dynamically import to avoid SSR issues with DOM manipulation
const BlockEditor = dynamic(() => import('@/components/editor/BlockEditor'), { ssr: false })

export default function ContentEditorPage() {
  const { lang } = useLang()
  const [blocks,     setBlocks]     = useState<ContentBlock[]>([])
  const [titleEn,    setTitleEn]    = useState('')
  const [titleZh,    setTitleZh]    = useState('')
  const [coverUrl,   setCoverUrl]   = useState('')
  const [tags,       setTags]       = useState('')
  const [preview,    setPreview]    = useState(false)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)

  async function handlePublish() {
    setSaving(true)
    try {
      const res = await fetch('/api/blog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleEn, titleZh,
          blocks,
          coverImageUrl: coverUrl,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          isPublished: true,
        }),
      })
      const data = await res.json()
      if (data.ok) { setSaved(true); setTimeout(() => setSaved(false), 3000) }
    } finally {
      setSaving(false)
    }
  }

  async function handleSaveDraft() {
    setSaving(true)
    try {
      await fetch('/api/blog', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          titleEn, titleZh, blocks,
          coverImageUrl: coverUrl,
          tags: tags.split(',').map(t => t.trim()).filter(Boolean),
          isPublished: false,
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Navbar isLoggedIn={true} />

      {/* Editor toolbar */}
      <div className="sticky top-16 z-40 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-3 flex items-center gap-3">
          <div className="flex-1">
            <span className="text-sm font-semibold text-brand-navy">
              {lang === 'zh' ? '内容编辑器' : 'Content Editor'}
            </span>
            {saved && (
              <span className="ml-3 text-green-600 text-xs font-medium animate-fade-in">
                ✓ {lang === 'zh' ? '已保存' : 'Saved'}
              </span>
            )}
          </div>
          <button
            onClick={() => setPreview(!preview)}
            className={`btn-ghost flex items-center gap-2 text-sm ${preview ? 'text-brand-orange' : ''}`}
          >
            <Eye className="h-4 w-4" />
            {lang === 'zh' ? '预览' : 'Preview'}
          </button>
          <button
            onClick={handleSaveDraft}
            disabled={saving}
            className="btn-ghost flex items-center gap-2 text-sm"
          >
            <Save className="h-4 w-4" />
            {lang === 'zh' ? '草稿' : 'Draft'}
          </button>
          <button
            onClick={handlePublish}
            disabled={saving || !titleEn}
            className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50"
          >
            <Send className="h-4 w-4" />
            {lang === 'zh' ? '发布' : 'Publish'}
          </button>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid lg:grid-cols-3 gap-8">
          {/* Main editor area */}
          <div className="lg:col-span-2 space-y-6">
            {/* Title */}
            <div className="card p-6 space-y-4">
              <input
                type="text"
                value={titleEn}
                onChange={e => setTitleEn(e.target.value)}
                placeholder={lang === 'zh' ? '英文标题…' : 'Post title in English…'}
                className="w-full text-3xl font-bold text-gray-900 border-0 focus:outline-none placeholder-gray-300"
              />
              <input
                type="text"
                value={titleZh}
                onChange={e => setTitleZh(e.target.value)}
                placeholder="中文标题…（选填）"
                className="w-full text-2xl text-gray-700 border-0 focus:outline-none placeholder-gray-300"
              />
            </div>

            {/* Block editor */}
            <BlockEditor initialBlocks={blocks} onChange={setBlocks} />
          </div>

          {/* Sidebar: settings */}
          <div className="space-y-4">
            {/* Cover image */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <ImageIcon className="h-4 w-4 text-gray-500" />
                <h3 className="font-semibold text-sm text-gray-700">
                  {lang === 'zh' ? '封面图片' : 'Cover Image'}
                </h3>
              </div>
              <input
                type="url"
                value={coverUrl}
                onChange={e => setCoverUrl(e.target.value)}
                placeholder="https://… Azure Blob URL"
                className="input-field text-sm"
              />
              {coverUrl && (
                <Image src={coverUrl} alt="cover" className="rounded-xl mt-3 w-full h-32 object-cover" />
              )}
              <p className="text-xs text-gray-400 mt-2">
                {lang === 'zh' ? '从 Azure Blob 存储上传图片后粘贴 URL。' : 'Upload to Azure Blob Storage, paste URL here.'}
              </p>
            </div>

            {/* Tags */}
            <div className="card p-5">
              <div className="flex items-center gap-2 mb-3">
                <Tag className="h-4 w-4 text-gray-500" />
                <h3 className="font-semibold text-sm text-gray-700">
                  {lang === 'zh' ? '标签' : 'Tags'}
                </h3>
              </div>
              <input
                type="text"
                value={tags}
                onChange={e => setTags(e.target.value)}
                placeholder={lang === 'zh' ? 'race, nyrr, training' : 'race, nyrr, training'}
                className="input-field text-sm"
              />
              <p className="text-xs text-gray-400 mt-2">
                {lang === 'zh' ? '用逗号分隔多个标签' : 'Comma-separated tags'}
              </p>
            </div>

            {/* Language note */}
            <div className="card p-5 bg-brand-navy/5 border-brand-navy/10">
              <div className="flex items-center gap-2 mb-2">
                <Globe className="h-4 w-4 text-brand-navy" />
                <h3 className="font-semibold text-sm text-brand-navy">
                  {lang === 'zh' ? '双语支持' : 'Bilingual'}
                </h3>
              </div>
              <p className="text-xs text-gray-500 leading-relaxed">
                {lang === 'zh'
                  ? '每个内容块都支持英文和中文。中文内容选填——仅填英文也可发布。'
                  : 'Each block supports English and Chinese. Chinese is optional — publish with English only is fine.'}
              </p>
            </div>

            {/* Block count */}
            <div className="card p-4 text-center">
              <p className="text-2xl font-bold text-brand-navy">{blocks.length}</p>
              <p className="text-xs text-gray-500 mt-1">
                {lang === 'zh' ? '内容块' : 'content blocks'}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
