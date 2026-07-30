// ============================================================
// lib/db/gallery.ts — race photo gallery link (config-driven)
//
// The URL lives in the `config` table (V037 `PhotoGalleryUrl`) so an admin can
// change it from the Flask settings panel without a redeploy.
//
// NOTE: this is the EXTERNAL race-photo gallery. It is unrelated to
// /portal/photos, which is the internal photo/bib service.
// ============================================================

import { getConfigValue } from '@/lib/db/config'
import { safeHttpUrlOr } from '@/lib/safe-url'

/** Shipped default, used when the config row is missing, empty or unsafe. */
export const DEFAULT_PHOTO_GALLERY_URL = 'https://mmr-data-pipeline.web.app/'

/**
 * The gallery URL to render, or null if neither config nor the default is a
 * usable http(s) URL (callers should hide the link in that case).
 *
 * The config value is admin-editable, so it is validated rather than trusted —
 * an unvalidated href is a stored-XSS vector via `javascript:`.
 */
export async function getPhotoGalleryUrl(): Promise<string | null> {
  const configured = await getConfigValue('PhotoGalleryUrl', DEFAULT_PHOTO_GALLERY_URL)
  return safeHttpUrlOr(configured, DEFAULT_PHOTO_GALLERY_URL)
}
