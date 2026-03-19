import type { Metadata } from 'next'
import EventsClient from './EventsClient'

export const metadata: Metadata = { title: 'Events' }

// In production: fetch from DB or CMS
async function getEvents() {
  return [
    {
      id: 1, date: '2026-03-22', titleEn: 'Central Park Saturday Run',
      titleZh: '中央公园周六跑', location: 'Engineer\'s Gate, Central Park',
      descriptionEn: 'Our weekly Saturday morning group run. All paces welcome. Meet at 8AM.',
      descriptionZh: '每周六早上集体跑步，欢迎各种配速。早8点集合。',
      tags: ['group-run', 'weekly'],
    },
    {
      id: 2, date: '2026-04-06', titleEn: 'Brooklyn Half Prep Run',
      titleZh: '布鲁克林半马备赛跑', location: 'Prospect Park, Brooklyn',
      descriptionEn: '13.1-mile practice run to prep for Brooklyn Half Marathon.',
      descriptionZh: '13.1英里备赛跑，为布鲁克林半马做准备。',
      tags: ['race-prep', 'half-marathon'],
    },
    {
      id: 3, date: '2026-04-27', titleEn: 'NYRR Five Borough Series',
      titleZh: 'NYRR 五区系列赛', location: 'Various Boroughs',
      descriptionEn: 'NYRR official race — MMR team members run together. Register on NYRR.org.',
      descriptionZh: 'NYRR 官方赛事，会员一起参赛。请在 NYRR 网站报名。',
      tags: ['nyrr', 'race'],
      registrationUrl: 'https://www.nyrr.org',
    },
    {
      id: 4, date: '2026-05-10', titleEn: 'Queens 10K Tune-Up',
      titleZh: '皇后区 10K 热身赛', location: 'Flushing Meadows-Corona Park',
      descriptionEn: 'Informal group run + post-run dim sum. Bring your WeChat QR code!',
      descriptionZh: '非正式集训跑 + 赛后饮茶。记得带微信二维码！',
      tags: ['group-run', 'social'],
    },
  ]
}

export default async function EventsPage() {
  const events = await getEvents()
  return <EventsClient events={events} />
}
