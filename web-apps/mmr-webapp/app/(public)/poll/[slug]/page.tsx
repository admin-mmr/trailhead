import { notFound } from 'next/navigation'
import { getPollBySlug } from '@/lib/db/polls'
import PollClient from './PollClient'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const poll = await getPollBySlug(params.slug).catch(() => null)
  return { title: poll ? `${poll.titleEn} · MMR` : 'Poll · MMR' }
}

export default async function PollPage({ params }: { params: { slug: string } }) {
  const poll = await getPollBySlug(params.slug)
  // Draft polls are invisible until an admin opens them.
  if (!poll || poll.status === 'draft') notFound()
  return <PollClient poll={poll} />
}
