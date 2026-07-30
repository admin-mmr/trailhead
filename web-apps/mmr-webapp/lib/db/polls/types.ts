// ============================================================
// lib/db/polls/types.ts — shapes shared by the poll read and write paths
//
// PollError lives here rather than in lib/poll-shared.ts because it is a class
// (a value), and poll-shared.ts must stay importable from client components.
// ============================================================

import type { PollMode } from '@/lib/poll-shared'

export interface PollOption {
  id: number
  code: string
  labelEn: string
  labelZh: string | null
  taglineEn: string | null
  taglineZh: string | null
  imagePath: string | null
  detailPath: string | null
}

export interface Poll {
  id: number
  slug: string
  titleEn: string
  titleZh: string | null
  descriptionEn: string | null
  descriptionZh: string | null
  mode: PollMode
  status: 'draft' | 'open' | 'closed'
  resultsVisibility: 'after_vote' | 'public' | 'admin'
  voterCheck: 'member' | 'open'
  options: PollOption[]
}

/** One option's standing. `points` weights rank 1 highest (top3 mode only). */
export interface PollResultRow {
  code: string
  labelEn: string
  labelZh: string | null
  firsts: number
  seconds: number
  thirds: number
  points: number
}

export interface PollResults {
  totalBallots: number
  rows: PollResultRow[]
  comments: string[]
}

export interface CastBallotInput {
  poll: Poll
  memberId: string | null
  /** Option codes in rank order. Length must match the poll mode. */
  choiceCodes: string[]
  comment?: string | null
  ipHash?: string | null
}

/** Thrown for conditions the caller should surface as a 4xx, not a 500. */
export class PollError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'PollError'
  }
}
