// ============================================================
// lib/db/polls.ts — community poll service (MIGRATION_V038)
//
// Barrel only. The implementation lives in lib/db/polls/ so no file exceeds the
// 300-line limit; importers keep using '@/lib/db/polls' unchanged (same pattern
// as lib/email/templates.ts).
//
//   polls/types.ts — shared shapes + PollError
//   polls/read.ts  — getPollBySlug, getPollResults, hasMemberVoted
//   polls/vote.ts  — resolveVoter, castBallot
//
// Generic enough for any club poll; the website design vote is the first use
// case. Voting needs no login: the voter identifies with MemberID + last name,
// checked against `members`. One ballot per member per poll is enforced by the
// UNIQUE key uq_ballot_poll_member, not by a read-then-write in application
// code — two simultaneous submits therefore cannot both create a ballot.
//
// ⚠️ Never import a *value* from this module into a client component: it pulls
// in mysql2 and the browser bundle will fail on 'net'/'tls'. `import type` is
// fine (erased at compile time). Shared literals live in lib/poll-shared.ts.
// ============================================================

export type {
  Poll,
  PollOption,
  PollResults,
  PollResultRow,
  CastBallotInput,
} from './polls/types'

export { PollError } from './polls/types'

export { getPollBySlug, getPollResults, hasMemberVoted } from './polls/read'
export { resolveVoter, castBallot } from './polls/vote'
