import type { Lang } from '@/lib/i18n/translations'

/**
 * A bit of bilingual marketing copy.
 *
 * Home-page copy lives with its section rather than in lib/i18n/translations.ts:
 * it changes with the design, it is never reused elsewhere, and keeping it here
 * means a copy edit touches one file. Reusable UI strings still belong in
 * translations.ts.
 */
export interface Bi {
  en: string
  zh: string
}

export const bi = (en: string, zh: string): Bi => ({ en, zh })

/** Body copy follows the language toggle. */
export const say = (lang: Lang, text: Bi): string => text[lang]

/**
 * Formats a YYYY-MM-DD civil date for the event rail.
 *
 * Parsed by hand, NOT via `new Date('2026-11-01')` — that is UTC midnight and
 * renders as Oct 31 anywhere west of Greenwich. Same bug that hit the
 * fulfillment emails on 07-29.
 */
export function civilDateParts(iso: string): { day: string; month: string; year: string } {
  const [y, m, d] = iso.split('-').map(Number)
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
  return {
    day: String(d).padStart(2, '0'),
    month: MONTHS[(m - 1) % 12] ?? '',
    year: String(y),
  }
}
