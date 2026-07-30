/**
 * Family fan-out.
 *
 * The privacy property is the one to pin: each household member gets their OWN
 * copy, so no member's address is ever disclosed to a relative. And a
 * single-member "family" must get nothing — that is an individual membership
 * whose receipt already said everything.
 */

jest.mock('@/lib/db/renewals', () => ({
  getFamilyRoster: jest.fn(),
  getFamilyRosterForMember: jest.fn(),
}))
jest.mock('@/lib/notifications/send-tracked', () => ({ sendTracked: jest.fn() }))

import { notifyFamilyRenewal, notifyFamilyRosterChange } from '@/lib/notifications/family'
import { getFamilyRoster, getFamilyRosterForMember } from '@/lib/db/renewals'
import { sendTracked } from '@/lib/notifications/send-tracked'

const mockRoster = getFamilyRoster as jest.Mock
const mockRosterForMember = getFamilyRosterForMember as jest.Mock
const mockSend = sendTracked as jest.Mock

const member = (id: string, first: string, over: Record<string, unknown> = {}) => ({
  memberId: id,
  firstName: first,
  lastName: 'Chen',
  email: `${first.toLowerCase()}@example.com`,
  status: 'active',
  expiration: '2028-03-31',
  ...over,
})

const FAMILY = [member('A0001', 'Wei'), member('A0002', 'Mei'), member('A0003', 'Lily')]

beforeEach(() => {
  jest.clearAllMocks()
  mockSend.mockResolvedValue({ status: 'sent' })
})

describe('notifyFamilyRenewal', () => {
  beforeEach(() => mockRosterForMember.mockResolvedValue(FAMILY))

  it('emails the rest of the household when the payer already has a receipt', async () => {
    const result = await notifyFamilyRenewal({
      payerMemberId: 'A0001',
      expiresAt: '2028-03-31',
      dedupeSuffix: 'pi_123',
      skipPayer: true,
    })

    expect(result.sent).toBe(2)
    const recipients = mockSend.mock.calls.map((c) => c[0].memberId)
    expect(recipients).toEqual(['A0002', 'A0003'])
  })

  it('sends one personalised copy each — never one email addressed to everyone', async () => {
    await notifyFamilyRenewal({ payerMemberId: 'A0001', expiresAt: '2028-03-31' })

    expect(mockSend).toHaveBeenCalledTimes(3)
    for (const [call] of mockSend.mock.calls) {
      // Exactly one address per send, and it belongs to the member being told.
      expect(call.to).toBe(`${call.memberId === 'A0001' ? 'wei' : call.memberId === 'A0002' ? 'mei' : 'lily'}@example.com`)
    }
  })

  it('marks the recipient in their own copy of the roster', async () => {
    await notifyFamilyRenewal({ payerMemberId: 'A0001', expiresAt: '2028-03-31' })

    const meiCall = mockSend.mock.calls.find((c) => c[0].memberId === 'A0002')![0]
    // "(you)" appears exactly once, next to Mei.
    expect(meiCall.html.match(/\(you\)/g)).toHaveLength(1)
    expect(meiCall.html).toContain('Mei Chen')
    expect(meiCall.html.indexOf('Mei Chen')).toBeLessThan(meiCall.html.indexOf('(you)'))
  })

  it('says who paid, so a relative knows why they got the mail', async () => {
    await notifyFamilyRenewal({ payerMemberId: 'A0002', expiresAt: '2028-03-31', skipPayer: true })

    const html = mockSend.mock.calls[0][0].html as string
    expect(html).toContain('Mei Chen')
    expect(html).toContain('2028')
  })

  it('sends nothing for a one-person family — that is an individual membership', async () => {
    mockRosterForMember.mockResolvedValue([member('A0001', 'Wei')])

    const result = await notifyFamilyRenewal({ payerMemberId: 'A0001', expiresAt: '2028-03-31' })

    expect(result.sent).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('keys dedupe on the payment reference so a webhook retry cannot double-mail', async () => {
    await notifyFamilyRenewal({
      payerMemberId: 'A0001', expiresAt: '2028-03-31', dedupeSuffix: 'pi_abc',
    })

    for (const [call] of mockSend.mock.calls) {
      expect(call.dedupeKey).toBe(`family_renewal:${call.memberId}:pi_abc`)
    }
  })

  it('swallows a DB failure — the payment is already banked', async () => {
    mockRosterForMember.mockRejectedValue(new Error('connection lost'))

    const result = await notifyFamilyRenewal({ payerMemberId: 'A0001', expiresAt: '2028-03-31' })

    expect(result.sent).toBe(0)
    expect(result.errors).toEqual(['connection lost'])
  })
})

describe('notifyFamilyRosterChange', () => {
  beforeEach(() => mockRoster.mockResolvedValue(FAMILY))

  it('emails everyone including the newly added member', async () => {
    const result = await notifyFamilyRosterChange({
      familyId: 'B001',
      addedMemberIds: ['A0003'],
    })

    expect(result.sent).toBe(3)
    expect(mockSend.mock.calls.map((c) => c[0].memberId)).toEqual(['A0001', 'A0002', 'A0003'])
  })

  it('names the added member in the subject and flags them in the roster', async () => {
    await notifyFamilyRosterChange({ familyId: 'B001', addedMemberIds: ['A0003'] })

    const call = mockSend.mock.calls[0][0]
    expect(call.subject).toContain('Lily Chen')
    expect(call.subject).toContain('was added')
    expect(call.html).toContain('NEW')
  })

  it('pluralises when two members are added at once (upgrade-and-add)', async () => {
    await notifyFamilyRosterChange({ familyId: 'B001', addedMemberIds: ['A0001', 'A0002'] })

    expect(mockSend.mock.calls[0][0].subject).toContain('were added')
  })

  it('shows the shared expiration only when the family actually agrees on one', async () => {
    await notifyFamilyRosterChange({ familyId: 'B001', addedMemberIds: ['A0003'] })
    expect(mockSend.mock.calls[0][0].html).toContain('active through')

    // A regrouping can briefly leave dates mixed. Promising the latest one would
    // tell a member they are covered longer than they are.
    mockSend.mockClear()
    mockRoster.mockResolvedValue([
      member('A0001', 'Wei'),
      member('A0002', 'Mei', { expiration: '2027-03-31' }),
    ])
    await notifyFamilyRosterChange({ familyId: 'B001', addedMemberIds: ['A0002'] })
    const html = mockSend.mock.calls[0][0].html as string
    expect(html).not.toContain('active through')
    expect(html).toContain('one renewal covers the whole family')
  })

  it('reports nothing to notify for an unknown family instead of throwing', async () => {
    mockRoster.mockResolvedValue([])

    const result = await notifyFamilyRosterChange({ familyId: 'NOPE', addedMemberIds: [] })

    expect(result.recipients).toBe(0)
    expect(mockSend).not.toHaveBeenCalled()
  })

  it('counts a failed member without aborting the rest of the household', async () => {
    mockSend
      .mockResolvedValueOnce({ status: 'sent' })
      .mockResolvedValueOnce({ status: 'failed', error: 'bad address' })
      .mockResolvedValueOnce({ status: 'sent' })

    const result = await notifyFamilyRosterChange({ familyId: 'B001', addedMemberIds: ['A0003'] })

    expect(result.sent).toBe(2)
    expect(result.failed).toBe(1)
    expect(result.errors).toEqual(['A0002: bad address'])
  })
})
