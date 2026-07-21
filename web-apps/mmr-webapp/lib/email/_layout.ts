/**
 * _layout.ts — Shared layout wrappers + constants for MMR email templates
 *
 * All templates:
 *  - Use first name only in the greeting
 *  - Include a portal CTA footer
 *  - Welcome feedback with a reply-to prompt
 *  - Bilingual (English + Chinese) — members read both
 *  - Brand-consistent colours (#5c35a8 purple, #E86033 orange)
 */

export const APP_URL  = process.env.NEXT_PUBLIC_APP_URL ?? 'https://mmrunners.org'
export const PORTAL   = `${APP_URL}/portal`
export const FEEDBACK = 'admin@mmrunners.org'

// ── Shared layout wrappers ────────────────────────────────────────────────────

function header(): string {
  return `
    <div style="background:#5c35a8;padding:28px 32px;text-align:center;">
      <h1 style="color:#ffffff;margin:0;font-size:22px;font-family:sans-serif;letter-spacing:1px;">
        Misty Mountain Runners
      </h1>
      <p style="color:rgba(255,255,255,0.7);margin:6px 0 0;font-size:13px;font-family:sans-serif;">
        岚山跑团 · New York Running Community
      </p>
    </div>
  `
}

function portalFooter(firstName: string): string {
  return `
    <div style="margin-top:32px;padding:20px 32px;background:#f8f9fa;border-top:1px solid #e9ecef;">
      <p style="font-family:sans-serif;font-size:13px;color:#666;margin:0 0 12px;">
        Your member portal is always available at:
      </p>
      <a href="${PORTAL}"
         style="display:inline-block;background:#5c35a8;color:#ffffff;padding:10px 24px;
                border-radius:99px;text-decoration:none;font-weight:600;font-size:14px;
                font-family:sans-serif;">
        Open Member Portal →
      </a>
      <p style="font-family:sans-serif;font-size:12px;color:#999;margin:16px 0 0;">
        Have feedback or questions? We'd love to hear from you — just reply to this email or write to
        <a href="mailto:${FEEDBACK}" style="color:#5c35a8;">${FEEDBACK}</a>.
      </p>
    </div>
  `
}

export function wrap(firstName: string, body: string): string {
  return `
    <!DOCTYPE html>
    <html lang="en">
    <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
    <body style="margin:0;padding:0;background:#f0f2f5;">
      <div style="max-width:600px;margin:32px auto;background:#ffffff;
                  border-radius:16px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.06);">
        ${header()}
        <div style="padding:32px;font-family:sans-serif;color:#333;">
          ${body}
        </div>
        ${portalFooter(firstName)}
      </div>
    </body>
    </html>
  `
}
