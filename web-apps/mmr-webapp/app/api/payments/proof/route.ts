import { NextRequest, NextResponse } from 'next/server'
import { BlobServiceClient } from '@azure/storage-blob'
import { pool } from '@/lib/db/connection'

const CONTAINER = process.env.AZURE_STORAGE_CONTAINER ?? 'media'
const PROOF_FOLDER = 'payment-proofs'

// ── POST /api/payments/proof ─────────────────────────────────────────────────
// Accepts multipart/form-data with fields:
//   proof  — image file (PNG, JPG, HEIC, etc.)
//   submissionId — the SUB-YYYYMMDD-XXXXX reference from /api/payments/submit
export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('proof') as File | null
    const submissionId = formData.get('submissionId') as string | null

    if (!file || !submissionId) {
      return NextResponse.json({ error: 'Missing proof file or submissionId' }, { status: 400 })
    }

    // Validate file size (max 10 MB)
    const MAX_BYTES = 10 * 1024 * 1024
    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'File too large (max 10 MB)' }, { status: 413 })
    }

    // Validate file type
    const allowed = ['image/png', 'image/jpeg', 'image/heic', 'image/heif', 'image/webp', 'image/gif']
    if (!allowed.includes(file.type)) {
      return NextResponse.json({ error: 'Invalid file type. Please upload an image.' }, { status: 415 })
    }

    // Verify submission exists and is still pending
    const conn = await pool.getConnection()
    let submissionRow: { submission_id: string; status: string } | undefined
    try {
      const [rows] = await conn.execute(
        'SELECT SubmissionID AS submission_id, Status AS status FROM submissions WHERE SubmissionID = ? LIMIT 1',
        [submissionId]
      ) as [{ submission_id: string; status: string }[], unknown]
      submissionRow = rows[0]
    } finally {
      conn.release()
    }

    if (!submissionRow) {
      return NextResponse.json({ error: 'Payment submission not found' }, { status: 404 })
    }
    // Status enum values are lowercase: 'pending', 'approved', 'cancelled', 'expired'
    if (submissionRow.status === 'approved' || submissionRow.status === 'cancelled' || submissionRow.status === 'expired') {
      return NextResponse.json({ error: `Submission already ${submissionRow.status}` }, { status: 409 })
    }

    // Upload to Azure Blob Storage
    const connStr = process.env.AZURE_STORAGE_CONNECTION_STRING
    if (!connStr) throw new Error('AZURE_STORAGE_CONNECTION_STRING not set')

    const blobService = BlobServiceClient.fromConnectionString(connStr)
    const containerClient = blobService.getContainerClient(CONTAINER)

    const ext = file.name.split('.').pop() ?? 'jpg'
    const blobName = `${PROOF_FOLDER}/${submissionId}-${Date.now()}.${ext}`
    const blockBlobClient = containerClient.getBlockBlobClient(blobName)

    const buffer = Buffer.from(await file.arrayBuffer())
    await blockBlobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: file.type },
    })

    const proofUrl = blockBlobClient.url

    // Update submissions with proof URL
    const conn2 = await pool.getConnection()
    try {
      // ScreenshotFileId stores the Azure Blob proof URL (VARCHAR 255, fits all Azure URLs)
      // UpdatedAt auto-updates via DB trigger (on update CURRENT_TIMESTAMP)
      await conn2.execute(
        'UPDATE submissions SET ScreenshotFileId = ? WHERE SubmissionID = ?',
        [proofUrl, submissionId]
      )
    } finally {
      conn2.release()
    }

    return NextResponse.json({ success: true, proofUrl })
  } catch (err) {
    console.error('[payments/proof] Error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
