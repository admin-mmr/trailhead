/**
 * Login page — OAuth hand-off failure states.
 *
 * Members reported "Continue with Google just spins forever, no timeout". The
 * cause is that next-auth's signIn() ends in `window.location.href = <provider
 * url>`: when accounts.google.com is unreachable (blocked network, or a
 * WeChat/QQ webview refusing the hop) that navigation never commits, the
 * promise never settles, and nothing on the page ever clears the spinner.
 *
 * These tests pin the two escape hatches: a watchdog that offers the email +
 * password fallback, and a catch for a signIn that rejects outright.
 */

import React from 'react'
import { render, screen, act } from '@testing-library/react'
import { signIn } from 'next-auth/react'
import LoginPage from '@/app/login/page'
import { translations } from '@/lib/i18n/translations'

jest.mock('next-auth/react', () => ({ signIn: jest.fn() }))

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

jest.mock('@/lib/i18n/context', () => ({
  useLang: () => ({
    lang: 'en',
    T: (key: keyof typeof translations) => translations[key].en,
  }),
}))

const mockSignIn = signIn as jest.MockedFunction<typeof signIn>

const clickGoogle = () => {
  const btn = screen.getByRole('button', { name: /continue with google/i })
  act(() => { btn.click() })
}

beforeEach(() => {
  jest.useFakeTimers()
  mockSignIn.mockReset()
})

afterEach(() => {
  jest.runOnlyPendingTimers()
  jest.useRealTimers()
})

describe('login page — OAuth stall', () => {
  it('offers the email + password fallback when the provider hand-off never completes', () => {
    // The real failure mode: signIn() never settles.
    mockSignIn.mockImplementation(() => new Promise(() => {}) as never)

    render(<LoginPage />)
    clickGoogle()

    // Before the watchdog fires nothing has changed — a fast redirect must not nag.
    act(() => { jest.advanceTimersByTime(5_000) })
    expect(screen.queryByText(/still waiting for the provider/i)).not.toBeInTheDocument()

    act(() => { jest.advanceTimersByTime(2_000) })
    expect(screen.getByText(/still waiting for the provider/i)).toBeInTheDocument()

    // The fallback must name the route a member with no password can actually
    // take — scoped to the notice, since the page has its own reset link.
    const notice = screen.getByText(/unreachable on some networks/i)
    expect(notice).toHaveTextContent(/email \+ password/i)
    expect(notice).toHaveTextContent(/forgot password/i)
  })

  it('lets the member dismiss the stall notice and try again', () => {
    mockSignIn.mockImplementation(() => new Promise(() => {}) as never)

    render(<LoginPage />)
    clickGoogle()
    act(() => { jest.advanceTimersByTime(7_000) })

    const cancel = screen.getByRole('button', { name: /^cancel$/i })
    act(() => { cancel.click() })

    expect(screen.queryByText(/still waiting for the provider/i)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue with google/i })).not.toBeDisabled()
  })

  it('surfaces an error instead of spinning when signIn rejects', async () => {
    mockSignIn.mockRejectedValue(new Error('network down'))
    jest.spyOn(console, 'error').mockImplementation(() => {})

    render(<LoginPage />)
    await act(async () => {
      screen.getByRole('button', { name: /continue with google/i }).click()
    })

    expect(screen.getByText(/could not reach the sign-in provider/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /continue with google/i })).not.toBeDisabled()
  })

  it('does not warn when the provider hand-off is still in flight normally', () => {
    mockSignIn.mockImplementation(() => new Promise(() => {}) as never)

    render(<LoginPage />)
    clickGoogle()

    act(() => { jest.advanceTimersByTime(1_000) })
    expect(screen.queryByText(/still waiting for the provider/i)).not.toBeInTheDocument()
  })
})
