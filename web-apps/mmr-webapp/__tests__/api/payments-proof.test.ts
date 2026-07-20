/**
 * Contract tests for POST /api/payments/proof
 *
 * Mocks the mysql2 pool and @azure/storage-blob. Verifies: multipart
 * validation (missing fields, size, type), submission-state gating
 * (404 / 409), blob upload + UPDATE params on the happy path, and
 * DB / config error paths.
 */

// ── Mock next/server ─────────────────────────────────────────────────────────
jest.mock('next/server', () => ({
  NextRequest: class {},
  NextResponse: {
    json: jest.fn((body: unknown, init?: { status?: number }) => ({
      status: init?.status ?? 200,
      body,
    })),
  },
}))

jest.mock('@/lib/db/connection', () => ({
  pool: { getConnection: jest.fn() },
  getDb: jest.fn(),
}))
jest.mock('@azure/storage-blob', () => ({
  BlobServiceClient: { fromConnectionString: jest.fn() },
}))

import { POST } from '@/app/api/payments/proof/route'

// tsc sees the real NextResponse types; the runtime mock returns { status, body }.
const post = POST as unknown as (req: unknown) => Promise<{ status: number; body: any }>
import { pool } from '@/lib/db/connection'
import { BlobServiceClient } from '@azure/storage-blob'

const mockGetConnection = pool.getConnection as jest.Mock
const mockFromConnStr = BlobServiceClient.fromConnectionString as jest.Mock

// ── Helpers ──────────────────────────────────────────────────────────────────
const SUB_ID = 'SUB-20260701-ABC12'

function makeFile(overrides: Partial<{ name: string; size: number; type: string }> = {}) {
  return {
    name: 'receipt.png',
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

let conn: { execute: jest.Mock; release: jest.Mock }
let mockUploadData: jest.Mock

beforeEach(() => {
  jest.clearAllMocks()
  process.env.AZURE_STORAGE_CONNECTION_STRING = 'UseDevelopmentStorage=true'

  conn = { execute: jest.fn(), release: jest.fn() }
  mockGetConnection.mockResolvedValue(conn)

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

// ── Input validation ──────────────────────────────────────────────────────────

describe('POST /api/payments/proof — validation', () => {
  it('missing file → 400', async () => {
    const res = await post(makeReq({ submissionId: SUB_ID }))
    expect(res.status).toBe(400)
    expect(res.body.error).toMatch(/Missing proof file or submissionId/)
    expect(mockGetConnection).not.toHaveBeenCalled()
  })

  it('missing submissionId → 400', async () => {
    const res = await post(makeReq({ proof: makeFile() }))
    expect(res.status).toBe(400)
    expect(mockGetConnection).not.toHaveBeenCalled()
  })

  it('file over 10 MB → 413', async () => {
    const res = await post(makeReq({
      proof: makeFile({ size: 10 * 1024 * 1024 + 1 }),
      submissionId: SUB_ID,
    }))
    expect(res.status).toBe(413)
    expect(res.body.error).toMatch(/too large/i)
  })

  it.each(['application/pdf', 'text/html', 'image/svg+xml'])(
    'non-image type "%s" → 415',
    async (type) => {
      const res = await post(makeReq({ proof: makeFile({ type }), submissionId: SUB_ID }))
      expect(res.status).toBe(415)
      expect(res.body.error).toMatch(/Invalid file type/)
    }
  )
})

// ── Submission state gating ───────────────────────────────────────────────────

describe('POST /api/payments/proof — submission state', () => {
  it('unknown submissionId → 404', async () => {
    conn.execute.mockResolvedValueOnce([[]])
    const res = await post(makeReq({ proof: makeFile(), submissionId: 'SUB-NOPE' }))
    expect(res.status).toBe(404)
    expect(res.body.error).toMatch(/not found/i)
    expect(mockUploadData).not.toHaveBeenCalled()
  })

  it.each(['approved', 'cancelled', 'expired'])(
    'submission already %s → 409',
    async (status) => {
      conn.execute.mockResolvedValueOnce([[{ submission_id: SUB_ID, status }]])
      const res = await post(makeReq({ proof: makeFile(), submissionId: SUB_ID }))
      expect(res.status).toBe(409)
      expect(res.body.error).toBe(`Submission already ${status}`)
      expect(mockUploadData).not.toHaveBeenCalled()
    }
  )
})

// ── Happy path ────────────────────────────────────────────────────────────────

describe('POST /api/payments/proof — happy path', () => {
  it('uploads blob and stores proof URL on the submission', async () => {
    conn.execute
      .mockResolvedValueOnce([[{ submission_id: SUB_ID, status: 'pending' }]])  // SELECT
      .mockResolvedValueOnce([{}])                                              // UPDATE

    const res = await post(makeReq({ proof: makeFile(), submissionId: SUB_ID }))

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.proofUrl).toMatch(
      new RegExp(`^https://storage\\.example\\.com/media/payment-proofs/${SUB_ID}-\\d+\\.png$`)
    )

    // SELECT looked up by submissionId
    const [selectSql, selectParams] = conn.execute.mock.calls[0]
    expect(selectSql).toMatch(/SELECT SubmissionID/)
    expect(selectParams).toEqual([SUB_ID])

    // Blob upload happened with the file bytes and content type
    expect(mockUploadData).toHaveBeenCalledTimes(1)
    expect(mockUploadData.mock.calls[0][1]).toEqual({
      blobHTTPHeaders: { blobContentType: 'image/png' },
    })

    // UPDATE stored the proof URL against the submission
    const [updateSql, updateParams] = conn.execute.mock.calls[1]
    expect(updateSql).toMatch(/UPDATE submissions SET ScreenshotFileId/)
    expect(updateParams).toEqual([res.body.proofUrl, SUB_ID])

    // Both connections released
    expect(conn.release).toHaveBeenCalledTimes(2)
  })
})

// ── Error paths ───────────────────────────────────────────────────────────────

describe('POST /api/payments/proof — errors', () => {
  it('missing AZURE_STORAGE_CONNECTION_STRING → 500', async () => {
    delete process.env.AZURE_STORAGE_CONNECTION_STRING
    conn.execute.mockResolvedValueOnce([[{ submission_id: SUB_ID, status: 'pending' }]])
    const res = await post(makeReq({ proof: makeFile(), submissionId: SUB_ID }))
    expect(res.status).toBe(500)
    expect(res.body.error).toBe('Internal server error')
  })

  it('DB error on lookup → 500, connection still released', async () => {
    conn.execute.mockRejectedValueOnce(new Error('connect ETIMEDOUT'))
    const res = await post(makeReq({ proof: makeFile(), submissionId: SUB_ID }))
    expect(res.status).toBe(500)
    expect(conn.release).toHaveBeenCalled()
  })

  it('blob upload failure → 500', async () => {
    conn.execute.mockResolvedValueOnce([[{ submission_id: SUB_ID, status: 'pending' }]])
    mockUploadData.mockRejectedValueOnce(new Error('blob unavailable'))
    const res = await post(makeReq({ proof: makeFile(), submissionId: SUB_ID }))
    expect(res.status).toBe(500)
  })
})
