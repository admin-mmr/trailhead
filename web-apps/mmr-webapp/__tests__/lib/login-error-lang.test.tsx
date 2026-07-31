/**
 * Login error copy must follow the member's language.
 *
 * Regression: the `?error=` message used to be seeded in a `useState`
 * initializer, which runs once on the first render — when `lang` is still the
 * 'en' default, because LanguageProvider reads localStorage in an effect AFTER
 * mount. Every member therefore saw English error copy no matter their
 * preference, which quietly defeated the bilingual `oauth_no_member` message.
 *
 * This test drives the REAL LanguageProvider (not a mock) so the
 * mount-then-hydrate ordering is the same as in the browser.
 */

import React from 'react'
import { render, screen, act } from '@testing-library/react'
import LoginPage from '@/app/login/page'
import { LanguageProvider, useLang } from '@/lib/i18n/context'

// The 中文 toggle lives in the site navbar, not on the login page, so expose
// setLang here to simulate a member switching language mid-session.
function LangSwitch() {
  const { setLang } = useLang()
  return <button onClick={() => setLang('zh')}>switch-to-zh</button>
}

jest.mock('next-auth/react', () => ({ signIn: jest.fn() }))

let search = 'error=oauth_no_member'
jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(search),
}))

const renderWithLang = (stored: 'en' | 'zh' | null) => {
  if (stored) localStorage.setItem('mmr-lang', stored)
  else localStorage.removeItem('mmr-lang')
  return render(
    <LanguageProvider>
      <LangSwitch />
      <LoginPage />
    </LanguageProvider>,
  )
}

beforeEach(() => {
  search = 'error=oauth_no_member'
  localStorage.clear()
})

describe('login error copy vs language', () => {
  it('renders the oauth_no_member message in Chinese for a 中文 member', () => {
    renderWithLang('zh')

    // Provider hydration happens in an effect; the copy must catch up with it.
    expect(screen.getByText(/不在会员名单中/)).toBeInTheDocument()
    expect(screen.queryByText(/not on our member list/i)).not.toBeInTheDocument()
  })

  it('renders it in English for an English member', () => {
    renderWithLang('en')

    expect(screen.getByText(/not on our member list/i)).toBeInTheDocument()
  })

  it('follows a language switch made after the page has loaded', () => {
    renderWithLang('en')
    expect(screen.getByText(/not on our member list/i)).toBeInTheDocument()

    act(() => { screen.getByRole('button', { name: 'switch-to-zh' }).click() })

    expect(screen.getByText(/不在会员名单中/)).toBeInTheDocument()
  })

  it('shows no error block when there is no ?error=', () => {
    search = ''
    renderWithLang('zh')

    expect(screen.queryByText(/不在会员名单中/)).not.toBeInTheDocument()
    expect(screen.queryByText(/sign-in failed/i)).not.toBeInTheDocument()
  })
})
