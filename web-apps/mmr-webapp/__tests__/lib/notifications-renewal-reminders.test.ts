/**
 * The weekly reminder job.
 *
 * The behaviours worth pinning are the ones that would be expensive to discover
 * in production against 400+ real members:
 *   • idempotency — a claimed notification sends nothing on a re-run
 *   • the per-run cap — the GAS/Gmail daily quota is a hard ceiling
 *   • the kill switch — config can stop sends without a deploy
 *   • one failure does not abort the rest of the batch
 *   • stage selection uses NY-time day counts, not the DB's UTC CURDATE()
 */

jest.mock('@/lib/db/renewals', () => ({
  getMembersDueForReminder: jest.fn(),
  getFamilyRoster: jest.fn(),
}))
jest.mock('@/lib/db/config', () => ({ getConfigValue: jest.fn() }))
jest.mock('@/lib/notifications/send-tracked', () => ({ sendTracked: jest.fn() }))

import { runRenewalReminders } from '@/lib/notifications/renewal-reminders'
import { getMembersDueForReminder, getFamilyRoster } from '@/lib/db/renewals'
import { getConfigValue } from '@/lib/db/config'
import { sendTracked } from '@/lib/notifications/send-tracked'

const mockDue = getMembersDueForReminder as jest.Mock
const mockRoster = getFamilyRoster as jest.Mock
const mockConfig = getConfigValue as jest.Mock
const mockSend = sendTracked as jest.Mock

const TODAY = '2027-03-01'

/** A member expiring `daysLeft` days from TODAY. */
function candidate(over: Partial<Record<string, unknown>> = {}) {
  const daysLeft = (over.daysLeft as number) ?? 30
  return {
    memberId:   'A0123',
    email:      'wei@example.com',
    firstName:  'Wei',
    lastName:   'Chen',
    type:       'Individual',
    familyId:   null,
    status:     'active',
    expiration: '2027-03-31',
    daysLeft,
    ...over,
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockConfig.mockImplementation(async (key: string, fallback: string) => {
    if (key === 'RenewalRemindersEnabled') return '1'
    if (key === 'RenewalReminderMaxPerRun') return '150'
    return fallback
  })
  mockRoster.mockResolvedValue([])
  mockSend.mockResolvedValue({ status: 'sent' })
})

describe('runRenewalReminders', () => {
  it('sends one reminder per due member and reports the stage breakdown', async () => {
    mockDue.mockResolvedValue([
      candidate({ memberId: 'A0001', daysLeft: 60 }),
      candidate({ memberId: 'A0002', daysLeft: 30 }),
      candidate({ memberId: 'A0003', daysLeft: 3 }),
    ])

    const result = await runRenewalReminders({ today: TODAY })

    expect(result.sent).toBe(3)
    expect(result.failed).toBe(0)
    expect(result.byStage).toEqual({ T60: 1, T30: 1, T7: 1 })
    expect(mockSend).toHaveBeenCalledTimes(3)
  })

  it('does nothing at all when the config kill switch is off', async () => {
    mockConfig.mockImplementation(async (key: string, fallback: string) =>
      key === 'RenewalRemindersEnabled' ? '0' : fallback,
    )

    const result = await runRenewalReminders({ today: TODAY })

    expect(result.enabled).toBe(false)
    expect(result.sent).toBe(0)
    expect(mockDue).not.toHaveBeenCalled()  // not even a query
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('is idempotent — an already-claimed notification counts as skipped, not sent', async () => {
    mockDue.mockResolvedValue([candidate({ daysLeft: 30 })])
    mockSend.mockResolvedValue({ status: 'skipped', reason: 'already_sent' })

    const result = await runRenewalReminders({ today: TODAY })

    expect(result.sent).toBe(0)
    expect(result.skipped).toBe(1)
    expect(result.byStage).toEqual({})
  })

  it('passes a dedupe key built from member, expiration, and stage', async () => {
    mockDue.mockResolvedValue([
      candidate({ memberId: 'A0777', expiration: '2027-03-31', daysLeft: 30 }),
    ])

    await runRenewalReminders({ today: TODAY })

    expect(mockSend).toHaveBeenCalledWith(
      expect.objectContaining({ dedupeKey: 'renewal:A0777:2027-03-31:T30', stage: 'T30' }),
    )
  })

  it('stops at the per-run cap and says so — the Gmail quota is a hard ceiling', async () => {
    mockDue.mockResolvedValue(
      Array.from({ length: 10 }, (_, i) =>
        candidate({ memberId: `A${String(i).padStart(4, '0')}`, daysLeft: 30 }),
      ),
    )

    const result = await runRenewalReminders({ today: TODAY, limit: 4 })

    expect(result.sent).toBe(4)
    expect(result.cappedAt).toBe(4)
    expect(mockSend).toHaveBeenCalledTimes(4)
    // The remaining six are untouched, so next week's run picks them up.
    expect(result.considered).toBe(10)
  })

  it('reads the cap from config when no override is given', async () => {
    mockConfig.mockImplementation(async (key: string, fallback: string) => {
      if (key === 'RenewalRemindersEnabled') return '1'
      if (key === 'RenewalReminderMaxPerRun') return '2'
      return fallback
    })
    mockDue.mockResolvedValue([
      candidate({ memberId: 'A0001', daysLeft: 30 }),
      candidate({ memberId: 'A0002', daysLeft: 30 }),
      candidate({ memberId: 'A0003', daysLeft: 30 }),
    ])

    const result = await runRenewalReminders({ today: TODAY })

    expect(result.sent).toBe(2)
    expect(result.cappedAt).toBe(2)
  })

  it('keeps going after a failed send and records the member id', async () => {
    mockDue.mockResolvedValue([
      candidate({ memberId: 'A0001', daysLeft: 30 }),
      candidate({ memberId: 'A0002', daysLeft: 30 }),
      candidate({ memberId: 'A0003', daysLeft: 30 }),
    ])
    mockSend
      .mockResolvedValueOnce({ status: 'sent' })
      .mockResolvedValueOnce({ status: 'failed', error: 'GAS webhook timeout' })
      .mockResolvedValueOnce({ status: 'sent' })

    const result = await runRenewalReminders({ today: TODAY })

    expect(result.sent).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.errors).toEqual(['A0002: GAS webhook timeout'])
  })

  it('caps the error list so one broken batch cannot return a 400-line body', async () => {
    mockDue.mockResolvedValue(
      Array.from({ length: 30 }, (_, i) =>
        candidate({ memberId: `A${String(i).padStart(4, '0')}`, daysLeft: 30 }),
      ),
    )
    mockSend.mockResolvedValue({ status: 'failed', error: 'boom' })

    const result = await runRenewalReminders({ today: TODAY })

    expect(result.failed).toBe(30)
    expect(result.errors).toHaveLength(20)
  })

  it('skips members outside every band instead of guessing a stage', async () => {
    mockDue.mockResolvedValue([
      candidate({ memberId: 'A0001', daysLeft: 200 }),   // too early
      candidate({ memberId: 'A0002', daysLeft: -486 }),  // long gone
      candidate({ memberId: 'A0003', daysLeft: 30 }),    // due
    ])

    const result = await runRenewalReminders({ today: TODAY })

    expect(result.sent).toBe(1)
    expect(mockSend).toHaveBeenCalledTimes(1)
    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ memberId: 'A0003' }))
  })

  it('claims nothing and sends nothing on a dry run', async () => {
    mockDue.mockResolvedValue([
      candidate({ memberId: 'A0001', daysLeft: 30 }),
      candidate({ memberId: 'A0002', daysLeft: 3 }),
    ])

    const result = await runRenewalReminders({ today: TODAY, dryRun: true })

    expect(result.dryRun).toBe(true)
    expect(result.sent).toBe(2)              // "would send"
    expect(result.byStage).toEqual({ T30: 1, T7: 1 })
    expect(mockSend).not.toHaveBeenCalled()  // the important assertion
  })

  it('tells a family member who else is covered, and looks the roster up once', async () => {
    mockRoster.mockResolvedValue([
      { memberId: 'A0001', firstName: 'Wei',  lastName: 'Chen', email: 'a@x.com', status: 'active', expiration: '2027-03-31' },
      { memberId: 'A0002', firstName: 'Mei',  lastName: 'Chen', email: 'b@x.com', status: 'active', expiration: '2027-03-31' },
      { memberId: 'A0003', firstName: 'Lily', lastName: 'Chen', email: 'c@x.com', status: 'active', expiration: '2027-03-31' },
    ])
    mockDue.mockResolvedValue([
      candidate({ memberId: 'A0001', familyId: 'B001', type: 'Family', daysLeft: 30 }),
      candidate({ memberId: 'A0002', familyId: 'B001', type: 'Family', daysLeft: 30 }),
      candidate({ memberId: 'A0003', familyId: 'B001', type: 'Family', daysLeft: 30 }),
    ])

    const result = await runRenewalReminders({ today: TODAY })

    expect(result.sent).toBe(3)
    // Three family members, ONE roster query — otherwise a family of four runs
    // the same query four times, every week.
    expect(mockRoster).toHaveBeenCalledTimes(1)
    const html = mockSend.mock.calls[0][0].html as string
    expect(html).toContain('Mei Chen')
    expect(html).toContain('covers 3 people')
  })

  it('does not CC the admin on reminders — 400 copies would bury the inbox', async () => {
    mockDue.mockResolvedValue([candidate({ daysLeft: 30 })])

    await runRenewalReminders({ today: TODAY })

    expect(mockSend).toHaveBeenCalledWith(expect.objectContaining({ ccAdmin: false }))
  })

  it('uses lapsed wording and subject once the date has passed', async () => {
    mockDue.mockResolvedValue([candidate({ daysLeft: -10, expiration: '2027-02-19' })])

    await runRenewalReminders({ today: TODAY })

    const call = mockSend.mock.calls[0][0]
    expect(call.stage).toBe('LAPSED_14')
    expect(call.subject).toMatch(/has expired/i)
    expect(call.html).toContain('has expired')
    expect(call.html).toContain('10 days')
    // Must not promise time that no longer exists.
    expect(call.html).not.toContain('days</strong> away')
  })

  it('says "expires today" rather than "0 days away" on the expiration date', async () => {
    mockDue.mockResolvedValue([candidate({ daysLeft: 0 })])

    await runRenewalReminders({ today: TODAY })

    const call = mockSend.mock.calls[0][0]
    expect(call.stage).toBe('T7')
    expect(call.subject).toBe('Your MMR membership expires today')
    expect(call.html).toContain('expires <strong>today</strong>')
  })

  it('queries the widest band once, using the supplied NY date', async () => {
    mockDue.mockResolvedValue([])

    await runRenewalReminders({ today: TODAY })

    expect(mockDue).toHaveBeenCalledTimes(1)
    expect(mockDue).toHaveBeenCalledWith(-75, 75, TODAY)
  })
})
