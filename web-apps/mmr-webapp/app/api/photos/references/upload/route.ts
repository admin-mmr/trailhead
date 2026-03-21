import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMember } from '@/lib/auth/session'
import { addReferencePhoto } from '@/lib/db/photos'
import { BlobServiceClient } from '@azure/storage-blob'

const AZURE_CONNECTION_STR = process.env.AZURE_STORAGE_CONNECTION_STRING ?? ''
const CONTAINER            = 'media'

// POST /api/photos/references/upload
// Multipart body: file (image), photoTakenAt? (ISO string)
// Uploads the image to Azure Blob, adds an entry in member_reference_photos (source=direct_upload).
export async function POST(req: NextRequest) {
  const session = await requireActiveMember()

  const formData = await req.formData()
  const file     = formData.get('file') as File | null
  const takenAt  = formData.get('photoTakenAt') as string | null

  if (!file || !file.type.startsWith('image/'))
    return NextResponse.json({ ok: false, error: 'Image file required' }, { status: 400 })

  if (file.size > 10 * 1024 * 1024)
    return NextResponse.json({ ok: false, error: 'File too large (max 10 MB)' }, { status: 413 })

  // Upload to Azure Blob Storage
  const blobName = `members/${session.memberId}/refs/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`
  let blobUrl: string

  try {
    const blobClient = BlobServiceClient
      .fromConnectionString(AZURE_CONNECTION_STR)
      .getContainerClient(CONTAINER)
      .getBlockBlobClient(blobName)

    const buffer = Buffer.from(await file.arrayBuffer())
    await blobClient.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: file.type },
    })
    blobUrl = blobClient.url
  } catch (err) {
    console.error('[upload-reference] blob error', err)
    return NextResponse.json({ ok: false, error: 'Upload failed' }, { status: 500 })
  }

  const refId = await addReferencePhoto(session.memberId, blobUrl, {
    source:            'direct_upload',
    originalFilename:  file.name,
    photoTakenAt:      takenAt ?? undefined,
  })

  return NextResponse.json({ ok: true, data: { refId, blobUrl } })
}
