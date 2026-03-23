import { Calendar } from 'lucide-react'

// ─────────────────────────────────────────────────────────────────────────────
// /portal/events — Upcoming Events (coming soon)
//
// Placeholder page while the events feature is under development.
// Access is controlled by the /portal 'active' tier rule in lib/access.ts.
// ─────────────────────────────────────────────────────────────────────────────

export const metadata = {
  title: 'Upcoming Events | MMR Member Portal',
}

export default function EventsPage() {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center px-4">
      <div className="w-16 h-16 bg-brand-navy/10 rounded-2xl flex items-center justify-center mb-6">
        <Calendar className="w-8 h-8 text-brand-navy" />
      </div>

      <h1 className="text-2xl font-bold text-[#0A2342] mb-2">Upcoming Events</h1>
      <p className="text-gray-400 text-sm mb-4">近期活动</p>

      <p className="text-gray-600 max-w-sm mb-2">
        Member-only runs and club events will appear here. This feature is coming soon!
      </p>
      <p className="text-gray-400 text-sm max-w-sm">
        会员专属活动即将上线，敬请期待。
      </p>
    </div>
  )
}
