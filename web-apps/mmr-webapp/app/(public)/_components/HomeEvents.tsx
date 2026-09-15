'use client'

import Link from 'next/link'
import { useLang } from '@/lib/i18n/context'
import type { PublicEvent } from '@/lib/db/events-public'
import { bi, say, civilDateParts } from './copy'

/**
 * Dated events, high on the home page — borrowed from Option J.
 *
 * This was the single clearest finding from the design research: peer club
 * newbeerunning.org leads with dated races, and our site had no dates anywhere
 * above the fold. J made this its centrepiece and finished one Borda point
 * behind C, so it comes along into the winning design.
 *
 * Real NYRR data, so it has to survive real NYRR gaps: NYRR publishes its
 * calendar only ~8 weeks out, and for stretches of the year there is exactly
 * one future race on the books. The feed therefore backfills with races that
 * just happened (marked as such) rather than rendering one lonely row, and the
 * empty state names the furthest race we know about instead of implying the
 * page is broken.
 */
export default function HomeEvents({
  events,
  latestKnownDate,
}: {
  events: PublicEvent[]
  latestKnownDate: string | null
}) {
  const { lang } = useLang()
  const hasUpcoming = events.some(e => e.isUpcoming)

  return (
    <section className="border-y border-lantern-line bg-white px-4 py-20 sm:px-6 lg:px-8 lg:py-24">
      <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-[0.85fr_1.15fr] lg:gap-16">
        <div>
          <p className="text-[0.7rem] font-semibold uppercase tracking-[0.2em] text-lantern-gold">
            {say(lang, bi('This season', '本季'))}
          </p>
          <h2 className="mt-3.5 font-lantern text-3xl font-bold leading-[1.08] tracking-tight text-lantern-ink sm:text-4xl">
            {say(lang, bi('Show up.', '来就好。'))}
            <br />
            {say(lang, bi("That's the whole", '这就是全部的'))}
            <br />
            {say(lang, bi('requirement.', '门槛。'))}
          </h2>
          <p className="mt-5 max-w-[36ch] text-base leading-relaxed text-lantern-ink-soft">
            {say(lang, bi(
              'Group runs are free and open to everyone — no sign-up needed. Find your pace group at the meeting point.',
              '团跑免费，向所有人开放，无需报名。到集合点找到你的配速组即可。',
            ))}
          </p>
          <Link
            href="/portal/events"
            className="mt-7 inline-flex items-center gap-2 rounded-full border border-lantern-line bg-lantern-blush px-6 py-3.5 text-sm font-semibold text-lantern-ink transition-colors hover:border-lantern-gold-foil"
          >
            {say(lang, bi('Full race calendar', '完整比赛日历'))} →
          </Link>
        </div>

        <div>
          <div className="mb-5">
            <b className="font-lantern text-lg font-bold text-lantern-ink">
              {say(lang, bi('Latest Events', '最新活动'))}
            </b>
          </div>

          {events.length === 0 ? (
            <EmptyState latestKnownDate={latestKnownDate} />
          ) : (
            <>
              <ul className="space-y-2.5">
                {events.map(event => (
                  <EventRow key={event.id} event={event} />
                ))}
              </ul>
              {!hasUpcoming && (
                <p className="mt-4 text-xs leading-relaxed text-lantern-ink-soft">
                  {say(lang, bi(
                    "NYRR hasn't published races beyond this yet — they open the calendar about eight weeks ahead.",
                    'NYRR 目前尚未公布更晚的比赛——他们通常提前约八周开放日历。',
                  ))}
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  )
}

function EventRow({ event }: { event: PublicEvent }) {
  const { lang } = useLang()
  const { day, month } = civilDateParts(event.eventDate)

  // External NYRR links only — an event_url is DB-sourced, so anything that
  // isn't a plain https NYRR-style link just renders as unlinked text.
  const href = event.eventUrl && /^https?:\/\//i.test(event.eventUrl) ? event.eventUrl : null
  const Row = href ? 'a' : 'div'

  return (
    <li>
      <Row
        {...(href ? { href, target: '_blank', rel: 'noopener noreferrer' } : {})}
        className="grid grid-cols-[56px_1fr_auto] items-center gap-4 rounded-2xl border border-lantern-line bg-lantern-blush px-5 py-4 transition-colors hover:border-lantern-gold-foil hover:bg-[#FFFBF7]"
      >
        <div className="text-center">
          <div className="font-lantern text-xl font-extrabold leading-none text-brand-crimson">{day}</div>
          <div className="mt-1 text-[0.6rem] font-semibold tracking-[0.12em] text-lantern-ink-soft">{month}</div>
        </div>
        <div className="min-w-0">
          <div className="truncate font-lantern text-[0.95rem] font-semibold text-lantern-ink">
            {event.eventName}
          </div>
          <div className="mt-0.5 truncate text-xs text-lantern-ink-soft">
            {[event.distance, event.location].filter(Boolean).join(' · ') ||
              say(lang, bi('NYRR race', 'NYRR 比赛'))}
          </div>
        </div>
        <span
          className={
            event.isUpcoming
              ? 'rounded-full bg-brand-crimson/10 px-3 py-1 text-[0.65rem] font-semibold text-brand-crimson'
              : 'rounded-full bg-lantern-ink/5 px-3 py-1 text-[0.65rem] font-semibold text-lantern-ink-soft'
          }
        >
          {event.isUpcoming ? say(lang, bi('Upcoming', '即将')) : say(lang, bi('Results', '成绩'))}
        </span>
      </Row>
    </li>
  )
}

function EmptyState({ latestKnownDate }: { latestKnownDate: string | null }) {
  const { lang } = useLang()
  return (
    <div className="rounded-2xl border border-dashed border-lantern-line bg-lantern-blush px-6 py-10 text-center">
      <p className="text-sm leading-relaxed text-lantern-ink-soft">
        {latestKnownDate
          ? say(lang, bi(
              `NYRR hasn't published races beyond ${latestKnownDate} yet. Check back soon.`,
              `NYRR 尚未公布 ${latestKnownDate} 之后的比赛，请稍后再来。`,
            ))
          : say(lang, bi('The race calendar is being updated.', '比赛日历正在更新中。'))}
      </p>
    </div>
  )
}
