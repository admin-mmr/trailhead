/**
 * Contract tests for POST /api/photos/references/upload
 *
 * Multipart upload: validates the file, uploads to Azure Blob, then calls
 * addReferencePhoto (source=direct_upload). Mocks the session guard,
 * @azure/storage-blob and addReferencePhoto. Verifies auth (401/403),
 * file validation (400/413), the happy-path blob upload + helper call, and
 * the blob failure (500) path.
 */

jest.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: {
    json: jest.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    })),
  },
}))

jest.mock('@/lib/auth/session', () => ({
  requireActiveMember: jest.fn(),
  getSession: jest.fn(),
  requireSession: jest.fn(),
}))
jest.mock('@/lib/db/photos', () => ({ addReferencePhoto: jest.fn() }))
jest.mock('@azure/storage-blob', () => ({
  BlobServiceClient: { fromConnectionString: jest.fn() },
}))

import { POST } from '@/app/api/photos/references/upload/route'
import { requireActiveMember } from '@/lib/auth/session'
import { addReferencePhoto } from '@/lib/db/photos'
import { BlobServiceClient } from '@azure/storage-blob'

const post = POST as unknown as (req: unknown) => Promise<{ status: number; body: any }>
const mockRequire = requireActiveMember as jest.Mock
const mockAdd = addReferencePhoto as jest.Mock
const mockFromConnStr = BlobServiceClient.fromConnectionString as jest.Mock

const MEMBER = { memberId: 'MMR-2026-0001', email: 'a@example.com', status: 'active' }

function httpError(status: number, message = 'x'): Error {
  const err: any = new Error(message)
  err.status = status
  return err
}

function makeFile(overrides: Partial<{ name: string; size: number; type: string }> = {}) {
  return {
    name: 'face.png',
    size: 1024,
    type: 'image/png',
    arrayBuffer: async () => new ArrayBuffer(8),
    ...overrides,
  }
}
function makeReq(fields: Record<string, unknown>) {
  return {
    formData: async () => ({ get: (key: string) => fields[key] ?? null }),
  } as any
}

let mockUploadData: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  mockRequire.mockResolvedValue(MEMBER)
  mockAdd.mockResolvedValue(99)

  mockUploadData = jest.fn().mockResolvedValue(undefined)
  mockFromConnStr.mockReturnValue({
    getContainerClient: jest.fn(() => ({
      getBlockBlobClient: jest.fn((blobName: string) => ({
        url: `https://storage.example.com/media/${blobName}`,
        uploadData: mockUploadData,
      })),
    })),
  })
})

describe('POST /api/photos/references/upload', () => {
  it('401 when no session, nothing uploaded', async () => {
    mockRequire.mockRejectedValue(httpError(401))
    const res = await post(makeReq({ file: makeFile() }))
    expect(res.status).toBe(401)
    expect(mockUploadData).not.toHaveBeenCalled()
    expect(mockAdd).not.toHaveBeenCalled()
  })

  it('403 when member not active', async () => {
    mockRequire.mockRejectedValue(httpError(403, 'Active membership required'))
    const res = await post(makeReq({ file: makeFile() }))
    expect(res.status).toBe(403)
  })

  it('400 when file missing', async () => {
    const res = await post(makeReq({}))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Image file required/)
    expect(mockUploadData).not.toHaveBeenCalled()
  })

  it('400 for a non-image file', async () => {
    const res = await post(makeReq({ file: makeFile({ type: 'application/pdf' }) }))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Image file required/)
  })

  it('413 when file over 10 MB', async () => {
    const res = await post(makeReq({ file: makeFile({ size: 10 * 1024 * 1024 + 1 }) }))
    expect(res.status).toBe(413)
    expect(res.body.error).toMatch(/too large/i)
    expect(mockUploadData).not.toHaveBeenCalled()
  })

  it('happy path uploads the blob and records a direct_upload ref', async () => {
    const res = await post(makeReq({ file: makeFile(), photoTakenAt: '2024-01-02' }))
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
    expect(res.body.data.refId).toBe(99)
    expect(res.body.data.blobUrl).toMatch(
      /^https:\/\/storage\.example\.com\/media\/members\/MMR-2026-0001\/refs\/\d+-face\.png$/
    )

    expect(mockUploadData).toHaveBeenCalledTimes(1)
    expect(mockUploadData.mock.calls[0][1]).toEqual({
      blobHTTPHeaders: { blobContentType: 'image/png' },
    })

    expect(mockAdd).toHaveBeenCalledWith(MEMBER.memberId, res.body.data.blobUrl, {
      source: 'direct_upload',
      originalFilename: 'face.png',
      photoTakenAt: '2024-01-02',
    })
  })

  it('blob upload failure → 500, no DB write', async () => {
    mockUploadData.mockRejectedValueOnce(new Error('blob unavailable'))
    const res = await post(makeReq({ file: makeFile() }))
    expect(res.status).toBe(500)
    expect(res.body.error).toMatch(/Upload failed/)
    expect(mockAdd).not.toHaveBeenCalled()
  })
})
