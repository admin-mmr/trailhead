/**
 * PollCard — the "See the full design" link.
 *
 * Two things worth pinning: the link must not be nested inside the select
 * button (invalid HTML, ambiguous click handling), and detail_path arrives from
 * the database so a hostile value must not reach the href.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PollCard from '@/app/(public)/poll/[slug]/_components/PollCard'
import type { PollOption } from '@/lib/db/polls'

jest.mock('@/lib/i18n/context', () => ({ useLang: () => ({ lang: 'en' }) }))

const option = (over: Partial<PollOption> = {}): PollOption => ({
  id: 1,
  code: 'j',
  labelEn: 'J · Family 有家',
  labelZh: 'J · 有家',
  taglineEn: 'Photographs are the navigation.',
  taglineZh: '以会员照片作为导航。',
  imagePath: '/images/poll/option-j.jpg',
  detailPath: '/mockups/option-j-family.html',
  ...over,
})

describe('PollCard full-design link', () => {
  it('renders a new-tab link to the full mockup', () => {
    render(<PollCard option={option()} lang="en" rank={null} onToggle={() => {}} disabled={false} />)
    const link = screen.getByRole('link', { name: /see the full design/i })
    expect(link).toHaveAttribute('href', '/mockups/option-j-family.html')
    expect(link).toHaveAttribute('target', '_blank')
    // noopener matters: the mockup is a full page we open with window.opener otherwise
    expect(link.getAttribute('rel')).toContain('noopener')
    expect(link.getAttribute('rel')).toContain('noreferrer')
  })

  it('keeps the link OUTSIDE the select button', () => {
    render(<PollCard option={option()} lang="en" rank={null} onToggle={() => {}} disabled={false} />)
    const link = screen.getByRole('link', { name: /see the full design/i })
    expect(link.closest('button')).toBeNull()
  })

  it('tells the voter the image is only the top of the page', () => {
    render(<PollCard option={option()} lang="en" rank={null} onToggle={() => {}} disabled={false} />)
    expect(screen.getByText(/top of the page only/i)).toBeInTheDocument()
  })

  it('hides the link when detail_path is missing or hostile', () => {
    for (const bad of [null, 'javascript:alert(1)', '//evil.com', 'data:text/html,x']) {
      const { unmount } = render(
        <PollCard option={option({ detailPath: bad as string | null })} lang="en"
                  rank={null} onToggle={() => {}} disabled={false} />
      )
      expect(screen.queryByRole('link')).toBeNull()
      unmount()
    }
  })

  it('still toggles the rank when the card body is clicked', async () => {
    const onToggle = jest.fn()
    render(<PollCard option={option()} lang="en" rank={null} onToggle={onToggle} disabled={false} />)
    await userEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('a picked card stays clickable so the choice can be cleared', async () => {
    const onToggle = jest.fn()
    render(<PollCard option={option()} lang="en" rank={2} onToggle={onToggle} disabled={true} />)
    expect(screen.getByRole('button')).not.toBeDisabled()
    await userEvent.click(screen.getByRole('button'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })

  it('uses the Chinese label and tagline when lang is zh', () => {
    render(<PollCard option={option()} lang="zh" rank={null} onToggle={() => {}} disabled={false} />)
    expect(screen.getByText('J · 有家')).toBeInTheDocument()
    expect(screen.getByText('以会员照片作为导航。')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /查看完整设计/ })).toBeInTheDocument()
  })
})
