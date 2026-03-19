import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/auth/session'

export function GET() {
  const res = NextResponse.redirect(new URL('/', process.env.NEXT_PUBLIC_APP_URL!))
  res.cookies.set(clearSessionCookie())
  return res
}
