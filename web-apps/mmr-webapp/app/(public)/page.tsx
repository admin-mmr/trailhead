import { getHomeEvents, getLatestKnownEventDate, getClubStats } from '@/lib/db/events-public'
import { getMembershipPrice } from '@/lib/db/config'
import HomeHero from './_components/HomeHero'
import HomeStats from './_components/HomeStats'
import HomeEvents from './_components/HomeEvents'
import HomeBenefits from './_components/HomeBenefits'
import HomeExplore from './_components/HomeExplore'
import HomeJoinCta, { type Pricing } from './_components/HomeJoinCta'

// The club's numbers and the NYRR calendar both move on their own schedule;
// an hour-stale marketing page is fine and keeps the DB out of every visit.
export const revalidate = 3600

/**
 * Public home page — Option C · "Lantern", the design the club voted for in the
 * website-design-2026 poll (Sept 2026), with Option J's dated-events rail and
 * photo-tile navigation folded in.
 *
 * Server component so the events rail, stat counts and membership prices are
 * real data rather than hardcoded copy. Every read is individually guarded:
 * this is the front door, and it must render even when MySQL is unreachable.
 */
export default async function HomePage() {
  const [events, latestKnownDate, stats, pricing] = await Promise.all([
    getHomeEvents(5).catch(() => []),
    getLatestKnownEventDate().catch(() => null),
    getClubStats().catch(() => null),
    loadPricing(),
  ])

  return (
    <>
      <HomeHero activeMembers={stats?.activeMembers ?? null} />
      <HomeStats
        activeMembers={stats?.activeMembers ?? null}
        racesThisYear={stats?.racesThisYear ?? null}
      />
      <HomeEvents events={events} latestKnownDate={latestKnownDate} />
      <HomeBenefits />
      <HomeExplore />
      <HomeJoinCta pricing={pricing} />
    </>
  )
}

/**
 * Prices come from the config table — the same keys Stripe Checkout recomputes
 * against. The fallbacks match MEMBERSHIP_PRICING so an unreachable DB quotes
 * the current published prices rather than $0.
 */
async function loadPricing(): Promise<Pricing> {
  const [individual, family, familyUpgrade] = await Promise.all([
    getMembershipPrice('Individual Membership').catch(() => null),
    getMembershipPrice('Family Membership').catch(() => null),
    getMembershipPrice('Family Upgrade').catch(() => null),
  ])
  return {
    individual: individual ?? 30,
    family: family ?? 50,
    familyUpgrade: familyUpgrade ?? 20,
  }
}
