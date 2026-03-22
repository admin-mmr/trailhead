// ============================================================
// auth.ts — NextAuth v5 configuration
//
// Handles OAuth social login (Google, Microsoft,
// Facebook) plus email + password (Credentials).
//
// After any successful sign-in, NextAuth redirects to
// /auth/complete which creates the custom mmr_session cookie
// used by middleware and all API routes — so nothing else
// in the app needs to change.
// ============================================================

import NextAuth                from 'next-auth'
import type { NextAuthConfig } from 'next-auth'
import Google                  from 'next-auth/providers/google'
import MicrosoftEntraId        from 'next-auth/providers/microsoft-entra-id'
import Facebook                from 'next-auth/providers/facebook'
import Credentials             from 'next-auth/providers/credentials'
import { findMemberByEmail }   from '@/lib/db/members'
import { verifyPassword }      from '@/lib/auth/password'

// ── Only include a provider if its credentials are actually set ───────────────
// This prevents NextAuth from crashing at startup when keys are blank/missing.
const env = process.env

const config: NextAuthConfig = {
  providers: [
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? [Google({
      clientId:     env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
    })] : []),

    ...(env.MICROSOFT_CLIENT_ID && env.MICROSOFT_CLIENT_SECRET ? [MicrosoftEntraId({
      clientId:     env.MICROSOFT_CLIENT_ID,
      clientSecret: env.MICROSOFT_CLIENT_SECRET,
      // tenantId defaults to 'common' — allows both personal and work accounts
      profile(profile: any) {
        // Work/tenant accounts often omit the 'email' claim; fall back to
        // 'preferred_username' (the UPN, e.g. admin@mmrunners.onmicrosoft.com)
        return {
          id:    profile.sub ?? profile.oid,
          name:  profile.name,
          email: profile.email ?? profile.preferred_username ?? null,
          image: profile.picture ?? null,
        }
      },
    })] : []),

    ...(env.FACEBOOK_CLIENT_ID && env.FACEBOOK_CLIENT_SECRET ? [Facebook({
      clientId:     env.FACEBOOK_CLIENT_ID,
      clientSecret: env.FACEBOOK_CLIENT_SECRET,
    })] : []),

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
