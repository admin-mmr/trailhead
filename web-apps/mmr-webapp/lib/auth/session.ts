import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'
import type { SessionUser } from '@/types'

const SECRET  = new TextEncoder().encode(process.env.JWT_SECRET!)
const COOKIE  = 'mmr_session'
const EXPIRY  = '7d'

export async function createSession(user: SessionUser): Promise<string> {
  return new SignJWT({ ...user })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(EXPIRY)
    .sign(SECRET)
}

export async function getSession(): Promise<SessionUser | null> {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE)?.value
  if (!token) return null
  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as unknown as SessionUser
  } catch {
    return null
  }
}

export async function requireSession(): Promise<SessionUser> {
  const session = await getSession()
  if (!session) throw new Error('Unauthorized')
  return session
}

/**
 * Like requireSession, but additionally verifies that the member's
 * status is 'active'.  Use this in API route handlers for active-tier
 * endpoints as a server-side guard (middleware handles page routes).
 *
 * Throws an error with code 403 if the member exists but isn't active.
 */
export async function requireActiveMember(): Promise<SessionUser> {
  const session = await getSession()
  if (!session) {
    const err: any = new Error('Unauthorized')
    err.status = 401
    throw err
  }
  if (session.status !== 'active') {
    const err: any = new Error('Active membership required')
    err.status = 403
    throw err
  }
  return session
}

export function setSessionCookie(token: string) {
  return {
    name: COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  }
}

export function clearSessionCookie() {
  return { name: COOKIE, value: '', maxAge: 0, path: '/' }
}
