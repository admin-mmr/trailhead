/**
 * family.ts — emails that go to every member of a family, not just one.
 *
 * Two events warrant telling the whole household:
 *   • the family membership was renewed  → everyone learns the new expiration
 *   • someone was added to the family    → everyone sees the updated roster
 *
 * Both templates render the SAME roster block, so a member who gets both mails
 * in the same week sees one consistent list of who is covered. The recipient is
 * marked in that list ("you"), because a plain list of names in a club email is
 * otherwise ambiguous about whether you are on it.
 *
 * See ../_layout.ts for the shared wrapper + brand constants.
 */

import { APP_URL, PORTAL, wrap } from '../_layout'
import { formatLongDate } from '../../date'

export interface FamilyRosterEntry {
  memberId:  string
  firstName: string
  lastName:  string
  /** True for the one person this copy of the email is addressed to. */
  isRecipient?: boolean
  /** Newly added in the change being announced — rendered with a "new" tag. */
  isNew?: boolean
}

function fullName(m: FamilyRosterEntry): string {
  return `${m.firstName} ${m.lastName}`.trim()
}

/**
 * The roster block. Shared by both templates on purpose — see the file header.
 */
export function familyRosterBlock(members: FamilyRosterEntry[]): string {
  const rows = members.map((m) => `
    <tr>
      <td style="padding:8px 0;font-size:14px;color:#333;border-bottom:1px solid #f0f0f0;">
        ${fullName(m)}
        ${m.isRecipient ? '<span style="color:#9b8ec4;font-size:12px;"> (you)</span>' : ''}
        ${m.isNew ? `
        <span style="display:inline-block;background:#e8f5e9;color:#2e7d32;font-size:11px;
                     font-weight:600;padding:2px 8px;border-radius:99px;margin-left:6px;">NEW</span>
        ` : ''}
      </td>
      <td style="padding:8px 0;font-size:13px;color:#888;font-family:monospace;text-align:right;
                 border-bottom:1px solid #f0f0f0;">
        ${m.memberId}
      </td>
    </tr>
  `).join('')

  return `
    <div style="background:#f8f6ff;border:1px solid #e9e3ff;border-radius:12px;
                padding:20px;margin-bottom:24px;">
      <p style="margin:0 0 12px;font-size:13px;color:#9b8ec4;">
        Family membership · ${members.length} member${members.length !== 1 ? 's' : ''} · 家庭会员
      </p>
      <table style="width:100%;border-collapse:collapse;font-family:sans-serif;">
        ${rows}
      </table>
    </div>
  `
}

// ── Family membership renewed ────────────────────────────────────────────────

/**
 * Sent to EVERY member of the family after a family membership payment, so a
 * spouse or child learns their membership is current even though a relative
 * made the payment. The payer separately gets the payment receipt.
 */
export function familyRenewalEmailHtml(params: {
  firstName:   string
  expiresAt:   string
  members:     FamilyRosterEntry[]
  /** Who paid — omitted when we can't attribute it. */
  paidByName?: string
  planLabel?:  string
  testMode?:   boolean
}): string {
  const { firstName, expiresAt, members, paidByName, planLabel, testMode } = params
  const expiry = formatLongDate(expiresAt)

  return wrap(firstName, `
    ${testMode ? `
    <div style="background:#fff8e6;border:1px solid #ffe2a8;border-radius:10px;padding:12px 16px;margin-bottom:20px;">
      <p style="margin:0;font-size:13px;color:#8a5d00;font-weight:600;">
        TEST MODE — this is a test payment, no money changed hands.
      </p>
    </div>
    ` : ''}
    <h2 style="color:#5c35a8;margin:0 0 8px;">Your family membership is renewed ✓</h2>
    <p style="color:#555;margin:0 0 24px;">
      Hi ${firstName}, ${paidByName
        ? `<strong>${paidByName}</strong> renewed your family's Misty Mountain Runners membership.`
        : `your family's Misty Mountain Runners membership has been renewed.`}
      Everyone listed below is active${planLabel ? ` on the ${planLabel}` : ''} through
      <strong>${expiry}</strong>.
    </p>

    <div style="background:#f0f9f2;border:1px solid #cde9d5;border-radius:12px;padding:20px;
                margin-bottom:24px;text-align:center;">
      <p style="margin:0;font-size:13px;color:#4a8a5f;">Active until</p>
      <p style="margin:6px 0 0;font-size:22px;font-weight:700;color:#2e7d32;">${expiry}</p>
    </div>

    ${familyRosterBlock(members)}

    <p style="color:#555;margin:0 0 16px;">
      No action is needed from you. Your portal shows your membership details any time.
    </p>
    <a href="${PORTAL}"
       style="display:inline-block;background:#5c35a8;color:#ffffff;padding:12px 28px;
              border-radius:99px;text-decoration:none;font-weight:600;font-size:15px;">
      View My Membership →
    </a>
    <p style="font-size:13px;color:#888;margin:24px 0 0;">
      您的家庭会员资格已续费成功，有效期至 ${expiry}。以上全部家庭成员均已激活，无需再次操作。
    </p>
  `)
}

// ── Member added to a family ─────────────────────────────────────────────────

/**
 * Sent to EVERY member of the family — including the person just added — when
 * the family roster changes. Everyone sees the same grouped list, which is the
 * point: it doubles as a check that the club grouped the right people.
 */
export function familyMemberAddedEmailHtml(params: {
  firstName:  string
  members:    FamilyRosterEntry[]
  /** Names of the people added in this change (already flagged in `members`). */
  addedNames: string[]
  expiresAt?: string
  familyId?:  string
}): string {
  const { firstName, members, addedNames, expiresAt, familyId } = params
  const expiry = expiresAt ? formatLongDate(expiresAt) : null
  const added = addedNames.join(' and ')
  const plural = addedNames.length !== 1

  return wrap(firstName, `
    <h2 style="color:#5c35a8;margin:0 0 8px;">
      ${added ? `${added} ${plural ? 'were' : 'was'} added to your family membership` : 'Your family membership was updated'}
    </h2>
    <p style="color:#555;margin:0 0 24px;">
      Hi ${firstName}, your Misty Mountain Runners family membership now covers
      ${members.length} member${members.length !== 1 ? 's' : ''}. Here is everyone in the group:
    </p>

    ${familyRosterBlock(members)}

    ${expiry ? `
    <p style="color:#555;margin:0 0 16px;">
      All members above share one membership, active through <strong>${expiry}</strong>.
      One renewal covers the whole family.
    </p>
    ` : `
    <p style="color:#555;margin:0 0 16px;">
      All members above share one membership — one renewal covers the whole family.
    </p>
    `}

    <p style="color:#555;margin:0 0 16px;">
      Doesn't look right? Reply to this email and we'll fix the grouping.
      ${familyId ? `<span style="color:#999;font-size:13px;">(Family ID: ${familyId})</span>` : ''}
    </p>
    <a href="${APP_URL}/portal"
       style="display:inline-block;background:#5c35a8;color:#ffffff;padding:12px 28px;
              border-radius:99px;text-decoration:none;font-weight:600;font-size:15px;">
      View My Membership →
    </a>
    <p style="font-size:13px;color:#888;margin:24px 0 0;">
      您的家庭会员已更新，目前共 ${members.length} 位成员（名单如上）。
      全家共享一份会员资格，一次续费即可覆盖所有成员。如信息有误，请直接回复本邮件。
    </p>
  `)
}
