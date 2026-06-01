/**
 * Tests for the Hall of Fame public page
 * app/(public)/hall-of-fame/page.tsx
 *
 * Strategy: mock global.fetch; render the component; assert UI states.
 * No auth required — this is a public page.
 */

import React from 'react'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import HallOfFamePage from '@/app/(public)/hall-of-fame/page'

// ── i18n mock (defaults to English) ─────────────────────────────────────────
let mockLang: 'en' | 'zh' = 'en'

jest.mock('@/lib/i18n/context', () => ({
  useLang: () => ({ lang: mockLang }),
}))

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeSeries = (overrides: object = {}) => ({
  id: 1,
  name: 'Fred Lebow 5-Mile Classic',
  slug: 'fred-lebow',
  distance_km: 8.0,
  notes: null,
  event_count: 3,
  events_completed: 2,
  events_with_mmr: 2,
  ...overrides,
})

const makeRunner = (overrides: object = {}): object => ({
  runner_name: 'Jane Doe',
  mmr_member_id: 'A1234',
  age: 32,
  finish_time: '00:38:45',
  event_name: 'Fred Lebow 5-Mile',
  event_year: 2024,
  ...overrides,
})

const makeCategory = (key: string, gender: string, overrides: object = {}) => ({
  key,
  label: `${gender} Open`,
  label_zh: `${gender === 'Male' ? '男子' : '女子'} 公开组`,
  gender,
  min_age: null,
  best: makeRunner(),
  podium: [makeRunner(), makeRunner({ runner_name: 'Alice Smith', finish_time: '00:39:10' })],
  ...overrides,
})

function mockFetch(seriesPayload: object, hofPayload?: object) {
  global.fetch = jest.fn().mockImplementation((url: string) => {
    if (url.includes('/api/hof/series') && !url.match(/series\/.+/)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(seriesPayload),
      })
    }
    if (hofPayload && url.match(/\/api\/hof\/series\/.+/)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(hofPayload),
      })
    }
    return Promise.resolve({ ok: false, json: () => Promise.resolve(null) })
  })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  mockLang = 'en'
  jest.clearAllMocks()
})

// ── 1. Loading state ──────────────────────────────────────────────────────────

describe('loading state', () => {
  it('shows loading indicator before fetch resolves', () => {
    // fetch never resolves
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {}))
    render(<HallOfFamePage />)
    expect(screen.getByText(/loading/i)).toBeInTheDocument()
  })

  it('shows Chinese loading text when lang=zh', () => {
    mockLang = 'zh'
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {}))
    render(<HallOfFamePage />)
    expect(screen.getByText('加载中…')).toBeInTheDocument()
  })
})

// ── 2. Empty state ────────────────────────────────────────────────────────────

describe('empty state', () => {
  it('shows "No series data" when API returns empty list', async () => {
    mockFetch({ ok: true, series: [] })
    render(<HallOfFamePage />)
    await waitFor(() =>
      expect(screen.getByText(/no series data/i)).toBeInTheDocument()
    )
  })

  it('shows Chinese empty text when lang=zh', async () => {
    mockLang = 'zh'
    mockFetch({ ok: true, series: [] })
    render(<HallOfFamePage />)
    await waitFor(() =>
      expect(screen.getByText('暂无数据')).toBeInTheDocument()
    )
  })

  it('shows empty state when API returns ok:false', async () => {
    global.fetch = jest.fn().mockResolvedValue({ ok: false, json: () => Promise.resolve(null) })
    render(<HallOfFamePage />)
    await waitFor(() =>
      expect(screen.getByText(/no series data/i)).toBeInTheDocument()
    )
  })

  it('shows empty state when fetch throws (network error)', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('network error'))
    render(<HallOfFamePage />)
    await waitFor(() =>
      expect(screen.getByText(/no series data/i)).toBeInTheDocument()
    )
  })
})

// ── 3. Series list renders ────────────────────────────────────────────────────

describe('series list', () => {
  it('renders series name and distance', async () => {
    mockFetch({ ok: true, series: [makeSeries()] })
    render(<HallOfFamePage />)
    await waitFor(() =>
      expect(screen.getByText('Fred Lebow 5-Mile Classic')).toBeInTheDocument()
    )
    expect(screen.getByText('8 km')).toBeInTheDocument()
  })

  it('renders edition count in English', async () => {
    mockFetch({ ok: true, series: [makeSeries({ events_completed: 3 })] })
    render(<HallOfFamePage />)
    await waitFor(() =>
      expect(screen.getByText(/3 editions with results/i)).toBeInTheDocument()
    )
  })

  it('uses singular "edition" for count=1', async () => {
    mockFetch({ ok: true, series: [makeSeries({ events_completed: 1 })] })
    render(<HallOfFamePage />)
    await waitFor(() =>
      expect(screen.getByText(/1 edition with results/i)).toBeInTheDocument()
    )
  })

  it('renders Chinese edition text when lang=zh', async () => {
    mockLang = 'zh'
    mockFetch({ ok: true, series: [makeSeries({ events_completed: 2 })] })
    render(<HallOfFamePage />)
    await waitFor(() =>
      expect(screen.getByText(/2 届已完成/)).toBeInTheDocument()
    )
  })

  it('renders multiple series', async () => {
    mockFetch({
      ok: true,
      series: [
        makeSeries({ id: 1, name: 'Race A', slug: 'race-a' }),
        makeSeries({ id: 2, name: 'Race B', slug: 'race-b' }),
      ],
    })
    render(<HallOfFamePage />)
    await waitFor(() => {
      expect(screen.getByText('Race A')).toBeInTheDocument()
      expect(screen.getByText('Race B')).toBeInTheDocument()
    })
  })

  it('does not show distance when distance_km is null', async () => {
    mockFetch({ ok: true, series: [makeSeries({ name: 'Custom Race', distance_km: null })] })
    render(<HallOfFamePage />)
    await waitFor(() =>
      expect(screen.getByText('Custom Race')).toBeInTheDocument()
    )
    expect(screen.queryByText(/km/)).not.toBeInTheDocument()
  })
})

// ── 4. View HOF button state ──────────────────────────────────────────────────

describe('"View HOF" button', () => {
  it('is enabled when series has MMR events', async () => {
    mockFetch({ ok: true, series: [makeSeries({ events_with_mmr: 2 })] })
    render(<HallOfFamePage />)
    await waitFor(() => screen.getByText(/view hof/i))
    expect(screen.getByText(/view hof/i).closest('button')).not.toBeDisabled()
  })

  it('is disabled when series has no MMR events', async () => {
    mockFetch({ ok: true, series: [makeSeries({ events_with_mmr: 0 })] })
    render(<HallOfFamePage />)
    await waitFor(() => screen.getByText(/view hof/i))
    expect(screen.getByText(/view hof/i).closest('button')).toBeDisabled()
  })

  it('shows Chinese button label when lang=zh', async () => {
    mockLang = 'zh'
    mockFetch({ ok: true, series: [makeSeries()] })
    render(<HallOfFamePage />)
    await waitFor(() =>
      expect(screen.getByText('查看荣誉榜')).toBeInTheDocument()
    )
  })
})

// ── 5. Expand / collapse ──────────────────────────────────────────────────────

describe('expand behavior', () => {
  const seriesData = { ok: true, series: [makeSeries()] }
  const hofData: object = {
    series: makeSeries(),
    categories: [
      makeCategory('male_open', 'Male'),
      makeCategory('female_open', 'Female'),
    ],
  }

  it('shows HOF categories after clicking View HOF', async () => {
    mockFetch(seriesData, hofData)
    render(<HallOfFamePage />)
    await waitFor(() => screen.getByText(/view hof/i))

    await act(async () => {
      fireEvent.click(screen.getByText(/view hof/i))
    })

    await waitFor(() =>
      expect(screen.getByText('Male Open')).toBeInTheDocument()
    )
    expect(screen.getByText('Female Open')).toBeInTheDocument()
  })

  it('collapses when View HOF is clicked again', async () => {
    mockFetch(seriesData, hofData)
    render(<HallOfFamePage />)
    await waitFor(() => screen.getByText(/view hof/i))

    const btn = screen.getByText(/view hof/i)
    await act(async () => { fireEvent.click(btn) })
    await waitFor(() => screen.getByText('Male Open'))

    await act(async () => { fireEvent.click(btn) })
    await waitFor(() =>
      expect(screen.queryByText('Male Open')).not.toBeInTheDocument()
    )
  })

  it('does not fetch HOF data again on second expand (cache hit)', async () => {
    mockFetch(seriesData, hofData)
    render(<HallOfFamePage />)
    await waitFor(() => screen.getByText(/view hof/i))

    const btn = screen.getByText(/view hof/i)
    // expand → collapse → expand
    await act(async () => { fireEvent.click(btn) })
    await waitFor(() => screen.getByText('Male Open'))
    await act(async () => { fireEvent.click(btn) })
    await act(async () => { fireEvent.click(btn) })
    await waitFor(() => screen.getByText('Male Open'))

    // fetch called twice: once for series list, once for HOF data (not three times)
    expect(global.fetch).toHaveBeenCalledTimes(2)
  })

  it('shows "Failed to load" when HOF fetch fails', async () => {
    global.fetch = jest.fn().mockImplementation((url: string) => {
      if (url.includes('/api/hof/series') && !url.match(/series\/.+/)) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(seriesData) })
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve(null) })
    })
    render(<HallOfFamePage />)
    await waitFor(() => screen.getByText(/view hof/i))

    await act(async () => { fireEvent.click(screen.getByText(/view hof/i)) })
    await waitFor(() =>
      expect(screen.getByText(/failed to load/i)).toBeInTheDocument()
    )
  })
})

// ── 6. Category card rendering ────────────────────────────────────────────────

describe('category card', () => {
  it('shows podium runners with medals', async () => {
    const runner1 = makeRunner({ runner_name: 'Top Runner', finish_time: '00:35:00' })
    const runner2 = makeRunner({ runner_name: 'Second Runner', finish_time: '00:36:00' })
    const cat = makeCategory('male_open', 'Male', { podium: [runner1, runner2] })
    const series = makeSeries()

    mockFetch(
      { ok: true, series: [series] },
      { series, categories: [cat] }
    )
    render(<HallOfFamePage />)
    await waitFor(() => screen.getByText(/view hof/i))
    await act(async () => { fireEvent.click(screen.getByText(/view hof/i)) })

    await waitFor(() => screen.getByText('Top Runner'))
    expect(screen.getByText('Second Runner')).toBeInTheDocument()
    expect(screen.getByText('🥇')).toBeInTheDocument()
    expect(screen.getByText('🥈')).toBeInTheDocument()
  })

  it('shows "No data yet" for empty category', async () => {
    const cat = makeCategory('male_open', 'Male', { podium: [], best: null })
    mockFetch(
      { ok: true, series: [makeSeries()] },
      { series: makeSeries(), categories: [cat] }
    )
    render(<HallOfFamePage />)
    await waitFor(() => screen.getByText(/view hof/i))
    await act(async () => { fireEvent.click(screen.getByText(/view hof/i)) })
    await waitFor(() =>
      expect(screen.getByText(/no data yet/i)).toBeInTheDocument()
    )
  })

  it('shows Chinese "暂无数据" for empty category when lang=zh', async () => {
    mockLang = 'zh'
    const cat = makeCategory('male_open', 'Male', { podium: [], best: null })
    mockFetch(
      { ok: true, series: [makeSeries()] },
      { series: makeSeries(), categories: [cat] }
    )
    render(<HallOfFamePage />)
    await waitFor(() => screen.getByText('查看荣誉榜'))
    await act(async () => { fireEvent.click(screen.getByText('查看荣誉榜')) })
    await waitFor(() =>
      expect(screen.getAllByText('暂无数据').length).toBeGreaterThan(0)
    )
  })

  it('shows Chinese label when lang=zh', async () => {
    mockLang = 'zh'
    const cat = makeCategory('male_open', 'Male')
    mockFetch(
      { ok: true, series: [makeSeries()] },
      { series: makeSeries(), categories: [cat] }
    )
    render(<HallOfFamePage />)
    await waitFor(() => screen.getByText('查看荣誉榜'))
    await act(async () => { fireEvent.click(screen.getByText('查看荣誉榜')) })
    await waitFor(() =>
      expect(screen.getByText('男子 公开组')).toBeInTheDocument()
    )
  })

  it('shows finish time and event name in podium row', async () => {
    const runner = makeRunner({ finish_time: '00:38:45', event_name: 'Fred Lebow 5-Mile', event_year: 2024 })
    const cat = makeCategory('male_open', 'Male', { podium: [runner] })
    mockFetch(
      { ok: true, series: [makeSeries()] },
      { series: makeSeries(), categories: [cat] }
    )
    render(<HallOfFamePage />)
    await waitFor(() => screen.getByText(/view hof/i))
    await act(async () => { fireEvent.click(screen.getByText(/view hof/i)) })
    await waitFor(() => screen.getByText('00:38:45'))
    expect(screen.getByText(/Fred Lebow 5-Mile/)).toBeInTheDocument()
  })
})

// ── 7. Header / footer copy ───────────────────────────────────────────────────

describe('page header and footer', () => {
  beforeEach(() => {
    global.fetch = jest.fn().mockReturnValue(new Promise(() => {}))
  })

  it('shows English title', () => {
    render(<HallOfFamePage />)
    expect(screen.getByText('MMR Hall of Fame')).toBeInTheDocument()
  })

  it('shows Chinese title when lang=zh', () => {
    mockLang = 'zh'
    render(<HallOfFamePage />)
    expect(screen.getByText('MMR 荣誉殿堂')).toBeInTheDocument()
  })

  it('shows trophy emoji', () => {
    render(<HallOfFamePage />)
    expect(screen.getByText('🏆')).toBeInTheDocument()
  })

  it('shows English footer note', () => {
    render(<HallOfFamePage />)
    expect(screen.getByText(/NYRR official results/i)).toBeInTheDocument()
  })

  it('shows Chinese footer note when lang=zh', () => {
    mockLang = 'zh'
    render(<HallOfFamePage />)
    expect(screen.getByText(/NYRR 官方成绩/)).toBeInTheDocument()
  })
})

// ── 8. Across-editions count in expanded view ─────────────────────────────────

describe('expanded series footer', () => {
  it('shows edition count in expanded HOF header', async () => {
    const series = makeSeries({ events_completed: 5 })
    const hofData = {
      series,
      categories: [makeCategory('male_open', 'Male')],
    }
    mockFetch({ ok: true, series: [series] }, hofData)
    render(<HallOfFamePage />)
    await waitFor(() => screen.getByText(/view hof/i))
    await act(async () => { fireEvent.click(screen.getByText(/view hof/i)) })
    await waitFor(() =>
      expect(screen.getByText(/across 5 race editions/i)).toBeInTheDocument()
    )
  })
})
