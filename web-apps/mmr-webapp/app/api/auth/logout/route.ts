import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth/session'

export const dynamic = 'force-dynamic'

export function GET() {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const res = NextResponse.redirect(new URL('/', baseUrl))
  res.cookies.set(clearSessionCookie())
  return res
}
