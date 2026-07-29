// ─────────────────────────────────────────────────────────────────────────────
// /portal/events — member race calendar (NYRR events)
//
// Data comes from GET /api/events/calendar (active-member tier, see lib/access.ts).
// RSVP writes land in P1L session 3; this view is read-only and already shows the
// caller's own intent plus running/volunteering counts.
// ─────────────────────────────────────────────────────────────────────────────

import EventsCalendarClient from './EventsCalendarClient'

export const metadata = {
  title: 'Race Calendar | MMR Member Portal',
}

export default function EventsPage() {
  return <EventsCalendarClient />
}
