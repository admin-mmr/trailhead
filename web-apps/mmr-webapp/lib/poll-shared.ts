// ============================================================
// lib/poll-shared.ts — literals shared by poll server code and client components
//
// Deliberately free of any server-only import. lib/db/polls.ts pulls in mysql2,
// so importing a *value* from it into a client component breaks the browser
// bundle with "Can't resolve 'net'/'tls'". Anything both sides need lives here.
// ============================================================

export type PollMode = 'single' | 'top3'

/** How many options a ballot must contain, per poll mode. */
export const RANKS_FOR_MODE: Record<PollMode, number> = {
  single: 1,
  top3: 3,
}

export const MAX_COMMENT_LEN = 1000

/** Ordinal labels for the ranked picks, in both languages. */
export const RANK_LABELS: { en: string; zh: string }[] = [
  { en: '1st choice', zh: '第一选择' },
  { en: '2nd choice', zh: '第二选择' },
  { en: '3rd choice', zh: '第三选择' },
]

/** Points awarded per rank — 1st is worth 3, 2nd 2, 3rd 1. Mirrors getPollResults. */
export const RANK_POINTS = [3, 2, 1]

/** Cookie set once a ballot is cast, so the results page unlocks on return. */
export const votedCookieName = (slug: string) => `mmr_poll_voted_${slug.replace(/[^a-z0-9-]/gi, '')}`
