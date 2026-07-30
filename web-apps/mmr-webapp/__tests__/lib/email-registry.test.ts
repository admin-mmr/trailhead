/**
 * The template registry.
 *
 * Two things this protects:
 *   1. every email_type we log has a previewable template, so the club can read
 *      the copy before it reaches a member
 *   2. every template actually renders. A registry entry that throws would take
 *      the admin preview page down, and more importantly it means the sample
 *      arguments no longer match the template's signature — the exact drift this
 *      file exists to catch.
 */

import {
  EMAIL_TEMPLATE_PREVIEWS,
  EMAIL_TYPES,
  findTemplatePreview,
} from '@/lib/email/registry'
import { RENEWAL_STAGES } from '@/lib/membership/renewal-stages'

describe('EMAIL_TYPES coverage', () => {
  it('has a preview for every email type except the ones with no template', () => {
    const covered = new Set(EMAIL_TEMPLATE_PREVIEWS.map((t) => t.emailType))
    const missing = Object.values(EMAIL_TYPES).filter((t) => !covered.has(t))

    // donation_receipt shares paymentConfirmationEmailHtml — same template,
    // different subject — so it has no entry of its own.
    expect(missing).toEqual([EMAIL_TYPES.donation_receipt])
  })

  it('uses only registered email types', () => {
    const valid = new Set<string>(Object.values(EMAIL_TYPES))
    for (const t of EMAIL_TEMPLATE_PREVIEWS) {
      expect(valid.has(t.emailType)).toBe(true)
    }
  })

  it('has unique ids — they are preview URLs', () => {
    const ids = EMAIL_TEMPLATE_PREVIEWS.map((t) => t.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('previews every reminder stage, so the whole cadence is reviewable', () => {
    for (const stage of RENEWAL_STAGES) {
      const id = `renewal_reminder_${stage.stage.toLowerCase()}`
      expect(findTemplatePreview(id)).toBeDefined()
    }
  })
})

describe('every template renders', () => {
  it.each(EMAIL_TEMPLATE_PREVIEWS.map((t) => [t.id, t] as const))(
    '%s renders a complete bilingual document',
    (_id, template) => {
      const html = template.render()

      expect(html).toContain('<!DOCTYPE html>')
      expect(html).toContain('Misty Mountain Runners')
      // Members read both languages — every template carries Chinese copy.
      expect(html).toMatch(/[一-鿿]/)
      expect(template.subject.length).toBeGreaterThan(0)
      expect(template.description.length).toBeGreaterThan(0)
    },
  )

  it('never leaks an unresolved template placeholder', () => {
    for (const template of EMAIL_TEMPLATE_PREVIEWS) {
      const html = template.render()
      expect(html).not.toContain('undefined')
      expect(html).not.toContain('NaN')
      expect(html).not.toContain('${')
    }
  })

  it('uses obviously fake sample data — a preview must not look like real mail', () => {
    for (const template of EMAIL_TEMPLATE_PREVIEWS) {
      const html = template.render()
      // Sample member is A0123 "Wei Chen"; no real reference ids.
      expect(html).not.toMatch(/pi_[a-zA-Z0-9]{20,}/)
    }
  })
})

describe('findTemplatePreview', () => {
  it('returns undefined for an unknown id rather than throwing', () => {
    expect(findTemplatePreview('does-not-exist')).toBeUndefined()
  })

  it('finds a known id', () => {
    expect(findTemplatePreview('welcome')?.emailType).toBe(EMAIL_TYPES.welcome)
  })
})
