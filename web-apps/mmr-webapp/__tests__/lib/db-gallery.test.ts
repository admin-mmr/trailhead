/**
 * Unit tests for lib/db/gallery.ts
 *
 * The gallery URL is admin-editable config, so the important behavior is that an
 * unsafe or broken value degrades to the shipped default instead of reaching an
 * href. See lib/safe-url.ts for the scheme rules themselves.
 */

jest.mock('@/lib/db/config', () => ({ getConfigValue: jest.fn() }))

import { DEFAULT_PHOTO_GALLERY_URL, getPhotoGalleryUrl } from '@/lib/db/gallery'
import { getConfigValue } from '@/lib/db/config'

const mockGetConfig = getConfigValue as jest.Mock

beforeEach(() => jest.clearAllMocks())

describe('getPhotoGalleryUrl', () => {
  it('reads the PhotoGalleryUrl key with the shipped default as fallback', async () => {
    mockGetConfig.mockResolvedValue(DEFAULT_PHOTO_GALLERY_URL)
    await getPhotoGalleryUrl()
    expect(mockGetConfig).toHaveBeenCalledWith('PhotoGalleryUrl', DEFAULT_PHOTO_GALLERY_URL)
  })

  it('returns an admin-configured https URL', async () => {
    mockGetConfig.mockResolvedValue('https://photos.mmrunners.org/2026')
    expect(await getPhotoGalleryUrl()).toBe('https://photos.mmrunners.org/2026')
  })

  it('allows plain http', async () => {
    mockGetConfig.mockResolvedValue('http://gallery.example.com')
    expect(await getPhotoGalleryUrl()).toBe('http://gallery.example.com')
  })

  it.each([
    'javascript:alert(document.cookie)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    '//evil.example.com',
    'not-a-url',
    '   ',
  ])('falls back to the default for the unsafe value %p', async (value) => {
    // An admin typo — or a hostile edit — must not become a live href.
    mockGetConfig.mockResolvedValue(value)
    expect(await getPhotoGalleryUrl()).toBe(DEFAULT_PHOTO_GALLERY_URL)
  })

  it('the shipped default is itself a safe URL', async () => {
    mockGetConfig.mockResolvedValue('javascript:alert(1)')
    const url = await getPhotoGalleryUrl()
    expect(url).not.toBeNull()
    expect(url!.startsWith('https://')).toBe(true)
  })

  it('propagates a DB failure so callers can decide to hide the link', async () => {
    mockGetConfig.mockRejectedValue(new Error('ER_ACCESS_DENIED'))
    await expect(getPhotoGalleryUrl()).rejects.toThrow()
  })
})
