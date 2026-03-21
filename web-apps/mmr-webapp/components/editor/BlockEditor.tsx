'use client'

import { useState, useCallback } from 'react'
import { useLang } from '@/lib/i18n/context'
import type { ContentBlock, BlockType } from '@/types'
import {
  Type, Heading, Image, Minus, CalendarDays, Trophy, Globe,
  GripVertical, Trash2, Plus, ChevronUp, ChevronDown,
} from 'lucide-react'
import { clsx } from 'clsx'

// ─── Block type config ──────────────────────────────────────
const BLOCK_TYPES: { type: BlockType; icon: React.ElementType; en: string; zh: string }[] = [
  { type: 'text',        icon: Type,         en: 'Text',       zh: '文字段落' },
  { type: 'heading',     icon: Heading,      en: 'Heading',    zh: '标题' },
  { type: 'image',       icon: Image,        en: 'Image',      zh: '图片' },
  { type: 'event-card',  icon: CalendarDays, en: 'Event Card', zh: '活动卡片' },
  { type: 'race-results',icon: Trophy,       en: 'Results',    zh: '比赛成绩' },
  { type: 'nyrr-embed',  icon: Globe,        en: 'NYRR Embed', zh: 'NYRR 嵌入' },
  { type: 'divider',     icon: Minus,        en: 'Divider',    zh: '分隔线' },
]

// ─── Individual block editors ───────────────────────────────
function TextBlockEditor({ block, onChange }: { block: ContentBlock; onChange: (b: ContentBlock) => void }) {
  const { lang } = useLang()
  return (
    <div className="space-y-3">
      <textarea
        value={block.dataEn}
        onChange={e => onChange({ ...block, dataEn: e.target.value })}
        placeholder={lang === 'zh' ? '英文内容…' : 'English content…'}
        rows={3}
        className="input-field resize-none font-sans"
      />
      <textarea
        value={block.dataZh ?? ''}
        onChange={e => onChange({ ...block, dataZh: e.target.value })}
        placeholder={lang === 'zh' ? '中文内容…（选填）' : '中文 content… (optional)'}
        rows={3}
        className="input-field resize-none font-sans"
      />
    </div>
  )
}

function HeadingBlockEditor({ block, onChange }: { block: ContentBlock; onChange: (b: ContentBlock) => void }) {
  const { lang } = useLang()
  return (
    <div className="space-y-3">
      <input
        type="text"
        value={block.dataEn}
        onChange={e => onChange({ ...block, dataEn: e.target.value })}
        placeholder={lang === 'zh' ? '英文标题…' : 'English heading…'}
        className="input-field text-xl font-bold"
      />
      <input
        type="text"
        value={block.dataZh ?? ''}
        onChange={e => onChange({ ...block, dataZh: e.target.value })}
        placeholder="中文标题…（选填）"
        className="input-field text-xl"
      />
    </div>
  )
}

function ImageBlockEditor({ block, onChange }: { block: ContentBlock; onChange: (b: ContentBlock) => void }) {
  const { lang } = useLang()
  return (
    <div className="space-y-3">
      <input
        type="url"
        value={block.dataEn}
        onChange={e => onChange({ ...block, dataEn: e.target.value })}
        placeholder="https://… or Azure Blob URL"
        className="input-field font-mono text-sm"
      />
      <input
        type="text"
        value={block.dataZh ?? ''}
        onChange={e => onChange({ ...block, dataZh: e.target.value })}
        placeholder={lang === 'zh' ? '图片说明（选填）' : 'Caption (optional)'}
        className="input-field"
      />
      {block.dataEn && (
        <Image src={block.dataEn} alt="preview" className="rounded-xl max-h-48 object-cover" />
      )}
    </div>
  )
}

function EventCardEditor({ block, onChange }: { block: ContentBlock; onChange: (b: ContentBlock) => void }) {
  const { lang } = useLang()
  const meta = (block.meta ?? {}) as Record<string, string>
  const upd = (k: string, v: string) => onChange({ ...block, meta: { ...meta, [k]: v } })

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <input type="text" className="input-field"
          value={block.dataEn} onChange={e => onChange({ ...block, dataEn: e.target.value })}
          placeholder={lang === 'zh' ? '英文活动名' : 'Event title (EN)'} />
        <input type="text" className="input-field"
          value={block.dataZh ?? ''} onChange={e => onChange({ ...block, dataZh: e.target.value })}
          placeholder="活动名称（中文）" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <input type="date" className="input-field"
          value={meta.date ?? ''} onChange={e => upd('date', e.target.value)} />
        <input type="text" className="input-field"
          value={meta.location ?? ''} onChange={e => upd('location', e.target.value)}
          placeholder={lang === 'zh' ? '地点' : 'Location'} />
      </div>
      <input type="url" className="input-field"
        value={meta.registrationUrl ?? ''} onChange={e => upd('registrationUrl', e.target.value)}
        placeholder={lang === 'zh' ? '报名链接（选填）' : 'Registration URL (optional)'} />
    </div>
  )
}

function RaceResultsEditor({ block, onChange }: { block: ContentBlock; onChange: (b: ContentBlock) => void }) {
  const { lang } = useLang()
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500">
        {lang === 'zh' ? '粘贴比赛成绩 CSV（姓名, 时间, 排名）' : 'Paste race results CSV (Name, Time, Place)'}
      </p>
      <textarea
        value={block.dataEn}
        onChange={e => onChange({ ...block, dataEn: e.target.value })}
        rows={5}
        className="input-field font-mono text-xs resize-none"
        placeholder="Name,Time,Place&#10;John Smith,1:23:45,42"
      />
    </div>
  )
}

function NyrrEmbedEditor({ block, onChange }: { block: ContentBlock; onChange: (b: ContentBlock) => void }) {
  const { lang } = useLang()
  return (
    <div className="space-y-2">
      <p className="text-sm text-gray-500">
        {lang === 'zh' ? 'NYRR 赛事代码（在 NYRR 网址中查找）' : 'NYRR event code (found in NYRR.org URL)'}
      </p>
      <input
        type="text"
        value={block.dataEn}
        onChange={e => onChange({ ...block, dataEn: e.target.value })}
        placeholder="e.g. M2026BK"
        className="input-field font-mono"
      />
      <p className="text-xs text-gray-400">
        {lang === 'zh' ? '将自动显示 MMR 队员成绩' : 'Will auto-display MMR team member results for this race'}
      </p>
    </div>
  )
}

// ─── Block renderer map ──────────────────────────────────────
function BlockEditorContent({ block, onChange }: { block: ContentBlock; onChange: (b: ContentBlock) => void }) {
  if (block.type === 'divider') return <div className="border-t-2 border-dashed border-gray-200 my-2" />
  if (block.type === 'text')         return <TextBlockEditor block={block} onChange={onChange} />
  if (block.type === 'heading')      return <HeadingBlockEditor block={block} onChange={onChange} />
  if (block.type === 'image')        return <ImageBlockEditor block={block} onChange={onChange} />
  if (block.type === 'event-card')   return <EventCardEditor block={block} onChange={onChange} />
  if (block.type === 'race-results') return <RaceResultsEditor block={block} onChange={onChange} />
  if (block.type === 'nyrr-embed')   return <NyrrEmbedEditor block={block} onChange={onChange} />
  return null
}

// ─── Main BlockEditor component ──────────────────────────────
interface BlockEditorProps {
  initialBlocks?: ContentBlock[]
  onChange?: (blocks: ContentBlock[]) => void
}

let _uid = 0
function uid() { return `block-${++_uid}` }

export default function BlockEditor({ initialBlocks = [], onChange }: BlockEditorProps) {
  const { lang } = useLang()
  const [blocks, setBlocks]     = useState<ContentBlock[]>(initialBlocks)
  const [addMenu, setAddMenu]   = useState(false)
  const [selected, setSelected] = useState<string | null>(null)

  function updateBlocks(next: ContentBlock[]) {
    setBlocks(next)
    onChange?.(next)
  }

  function addBlock(type: BlockType) {
    const block: ContentBlock = { id: uid(), type, dataEn: '', dataZh: '' }
    updateBlocks([...blocks, block])
    setAddMenu(false)
    setSelected(block.id)
  }

  function updateBlock(updated: ContentBlock) {
    updateBlocks(blocks.map(b => b.id === updated.id ? updated : b))
  }

  function removeBlock(id: string) {
    updateBlocks(blocks.filter(b => b.id !== id))
    setSelected(null)
  }

  function moveBlock(id: string, dir: -1 | 1) {
    const i = blocks.findIndex(b => b.id === id)
    if (i < 0) return
    const next = [...blocks]
    const swap = i + dir
    if (swap < 0 || swap >= next.length) return
    ;[next[i], next[swap]] = [next[swap], next[i]]
    updateBlocks(next)
  }

  return (
    <div className="space-y-3">
      {/* Block list */}
      {blocks.length === 0 && (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl">
          <p className="text-gray-400 mb-3">
            {lang === 'zh' ? '点击下方按钮添加内容块' : 'Add your first content block below'}
          </p>
        </div>
      )}

      {blocks.map((block, i) => {
        const typeCfg = BLOCK_TYPES.find(t => t.type === block.type)!
        const Icon    = typeCfg?.icon ?? Type
        const isSelected = selected === block.id

        return (
          <div
            key={block.id}
            onClick={() => setSelected(block.id)}
            className={clsx(
              'rounded-2xl border-2 transition-all cursor-pointer',
              isSelected ? 'border-brand-orange shadow-md' : 'border-gray-100 hover:border-gray-200'
            )}
          >
            {/* Block header */}
            <div className={clsx(
              'flex items-center gap-2 px-4 py-2 rounded-t-xl',
              isSelected ? 'bg-brand-orange/5' : 'bg-gray-50'
            )}>
              <GripVertical className="h-4 w-4 text-gray-300 cursor-grab" />
              <Icon className="h-4 w-4 text-gray-500" />
              <span className="text-xs font-medium text-gray-500">
                {lang === 'zh' ? typeCfg?.zh : typeCfg?.en}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={e => { e.stopPropagation(); moveBlock(block.id, -1) }}
                  disabled={i === 0}
                  className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"
                >
                  <ChevronUp className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); moveBlock(block.id, 1) }}
                  disabled={i === blocks.length - 1}
                  className="p-1 rounded hover:bg-gray-200 disabled:opacity-30 transition-colors"
                >
                  <ChevronDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={e => { e.stopPropagation(); removeBlock(block.id) }}
                  className="p-1 rounded hover:bg-red-100 text-red-500 transition-colors"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Block content */}
            <div className="p-4">
              <BlockEditorContent block={block} onChange={updateBlock} />
            </div>
          </div>
        )
      })}

      {/* Add block button */}
      <div className="relative">
        <button
          onClick={() => setAddMenu(!addMenu)}
          className="w-full border-2 border-dashed border-gray-200 rounded-2xl py-3 flex items-center justify-center gap-2
                     text-gray-400 hover:border-brand-orange hover:text-brand-orange transition-colors"
        >
          <Plus className="h-4 w-4" />
          <span className="text-sm font-medium">
            {lang === 'zh' ? '添加内容块' : 'Add block'}
          </span>
        </button>

        {addMenu && (
          <div className="absolute bottom-full mb-2 left-0 right-0 bg-white rounded-2xl shadow-xl border border-gray-100 p-3 z-20 animate-slide-up">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {BLOCK_TYPES.map(({ type, icon: Icon, en, zh }) => (
                <button
                  key={type}
                  onClick={() => addBlock(type)}
                  className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-brand-orange/5 hover:text-brand-orange transition-colors text-gray-600"
                >
                  <Icon className="h-5 w-5" />
                  <span className="text-xs font-medium">{lang === 'zh' ? zh : en}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
