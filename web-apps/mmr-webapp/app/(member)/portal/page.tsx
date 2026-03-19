import { requireSession } from '@/lib/auth/session'
import { getMemberById, getPaymentHistory } from '@/lib/db/members'
import DashboardClient from './DashboardClient'

export const metadata = { title: 'Dashboard' }

export default async function PortalDashboard() {
  const session = await requireSession()
  const member  = await getMemberById(session.memberId)
  const payments = member ? await getPaymentHistory(session.memberId) : []

  return <DashboardClient member={member} payments={payments} />
}
