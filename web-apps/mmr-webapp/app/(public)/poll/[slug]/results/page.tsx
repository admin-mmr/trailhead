import { notFound } from 'next/navigation'
import { getPollBySlug } from '@/lib/db/polls'
import ResultsClient from './ResultsClient'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: { slug: string } }) {
  const poll = await getPollBySlug(params.slug).catch(() => null)
  return { title: poll ? `Results · ${poll.titleEn}` : 'Results · MMR' }
}

export default async function PollResultsPage({ params }: { params: { slug: string } }) {
  const poll = await getPollBySlug(params.slug)
  if (!poll || poll.status === 'draft') notFound()

  // The tally itself is fetched client-side so the after_vote cookie gate lives
  // in one place (the API route) rather than being duplicated here.
  return (
    <ResultsClient
      slug={poll.slug}
      titleEn={poll.titleEn}
      titleZh={poll.titleZh}
      mode={poll.mode}
    />
  )
}
