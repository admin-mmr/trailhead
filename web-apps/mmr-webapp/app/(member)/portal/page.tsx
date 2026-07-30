import { requireSession } from '@/lib/auth/session'
import { getMemberById, getPaymentHistory } from '@/lib/db/members'
import { getPhotoGalleryUrl } from '@/lib/db/gallery'
import DashboardClient from './DashboardClient'

export const metadata = { title: 'Dashboard' }

export default async function PortalDashboard() {
  const session = await requireSession()
  const member  = await getMemberById(session.memberId)
  const payments = member ? await getPaymentHistory(session.memberId) : []

  // Config-driven; a lookup failure just hides the card.
  let galleryUrl: string | null = null
  try {
    galleryUrl = await getPhotoGalleryUrl()
  } catch {
    galleryUrl = null
  }

  return <DashboardClient member={member} payments={payments} galleryUrl={galleryUrl} />
}
