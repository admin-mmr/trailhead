// ============================================================
// auth.ts — NextAuth v5 configuration
//
// Handles OAuth social login (Google, Apple, Microsoft,
// Facebook, Yahoo) plus email + password (Credentials).
//
// After any successful sign-in, NextAuth redirects to
// /auth/complete which creates the custom mmr_session cookie
// used by middleware and all API routes — so nothing else
// in the app needs to change.
// ============================================================

import NextAuth                from 'next-auth'
import type { NextAuthConfig } from 'next-auth'
import Google                  from 'next-auth/providers/google'
import Apple                   from 'next-auth/providers/apple'
import MicrosoftEntraId        from 'next-auth/providers/microsoft-entra-id'
import Facebook                from 'next-auth/providers/facebook'
import Credentials             from 'next-auth/providers/credentials'
import { findMemberByEmail }   from '@/lib/db/members'
import { verifyPassword }      from '@/lib/auth/password'

// ── Yahoo: custom OIDC provider (not built into NextAuth v5) ─────────────────
// issuer is required — NextAuth appends /.well-known/openid-configuration to it.
// We also set wellKnown explicitly because Yahoo's discovery URL is non-standard.
const Yahoo = {
  id:        'yahoo',
  name:      'Yahoo',
  type:      'oidc' as const,
  issuer:    'https://api.login.yahoo.com',
  wellKnown: 'https://login.yahoo.com/.well-known/openid-configuration',
  clientId:     process.env.YAHOO_CLIENT_ID,
  clientSecret: process.env.YAHOO_CLIENT_SECRET,
  profile(profile: any) {
    return { id: profile.sub, name: profile.name, email: profile.email, image: profile.picture }
  },
}

// ── Only include a provider if its credentials are actually set ───────────────
// This prevents NextAuth from crashing at startup when keys are blank/missing.
const env = process.env

const config: NextAuthConfig = {
  providers: [
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? [Google({
      clientId:     env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    })] : []),

    ...(env.APPLE_ID && env.APPLE_SECRET ? [Apple({
      clientId:     env.APPLE_ID,
      clientSecret: env.APPLE_SECRET,
    })] : []),

    ...(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET ? [MicrosoftEntraId({
      clientId:     env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      // tenantId defaults to 'common' — allows both personal and work accounts
    })] : []),

    ...(env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET ? [Facebook({
      clientId:     env.FACEBOOK_CLIENT_ID,
      clientSecret: env.FACEBOOK_CLIENT_SECRET,
    })] : []),

    ...(env.YAHOO_CLIENT_ID && env.YAHOO_CLIENT_SECRET ? [Yahoo as any] : []),

    Credentials({
      credentials: {
        email:    { label: 'Email',    type: 'email'    },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        const email    = credentials?.email    as string | undefined
        const password = credentials?.password as string | undefined
        if (!email || !password) return null

        const member = await findMemberByEmail(email)
        if (!member?.passwordHash) return null

        const valid = await verifyPassword(password, member.passwordHash)
        if (!valid) return null

        return {
          id:    member.memberId,
          email: member.email,
          name:  member.englishName ?? member.chineseName ?? member.email,
        }
      },
    }),
  ],

  pages: {
    signIn: '/login',
    error:  '/login',        // redirect errors back to login with ?error=...
  },

  callbacks: {
    // Store provider + account ID in the NextAuth JWT so the bridge
    // route (/auth/complete) can persist them in the members table.
    async jwt({ token, account }) {
      if (account) {
        token.provider          = account.provider
        token.providerAccountId = account.providerAccountId
      }
      return token
    },
    async session({ session, token }) {
      session.provider          = token.provider          as string | undefined
      session.providerAccountId = token.providerAccountId as string | undefined
      return session
    },
  },

  // Required for non-Vercel deployments (Azure Static Web Apps)
  trustHost: true,
}

export const { handlers, auth, signIn, signOut } = NextAuth(config)
