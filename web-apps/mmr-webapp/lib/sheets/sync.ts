/**
 * Google Sheets sync — appends/updates member rows in the "Membership Master" sheet.
 *
 * Uses the Google Sheets API v4 with a service account.
 * Credentials loaded from:
 *   GOOGLE_SERVICE_ACCOUNT_JSON   — the service account JSON (either as env var, or read from GOOGLE_APPLICATION_CREDENTIALS file path for local dev)
 *   GOOGLE_SHEETS_MEMBERSHIP_ID   — the target spreadsheet ID for Membership Master sheet
 *
 * The sheet name "Membership Master" is expected with columns:
 *   A=MemberID, B=FirstName, C=LastName, D=Email, E=PhoneNumber,
 *   F=WeChatID, G=District, H=Gender, I=YearBorn, J=NYRRRunnerName,
 *   K=Type, L=Status, M=JoinYear
 */

import type { Member } from '@/types'
import * as fs from 'fs'

// Lazy-loaded googleapis to avoid build errors when deps aren't installed
let sheetsApi: any = null

async function loadServiceAccountJson(): Promise<any> {
  // Priority 1: GOOGLE_SERVICE_ACCOUNT_JSON env var (for Azure SWA)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON)
    } catch (err) {
      console.error('Failed to parse GOOGLE_SERVICE_ACCOUNT_JSON:', err)
      throw new Error('Invalid GOOGLE_SERVICE_ACCOUNT_JSON format')
    }
  }

  // Priority 2: GOOGLE_APPLICATION_CREDENTIALS file path (for local dev)
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    try {
      const fileContent = fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, 'utf-8')
      return JSON.parse(fileContent)
    } catch (err) {
      console.error('Failed to read GOOGLE_APPLICATION_CREDENTIALS file:', err)
      throw new Error('Cannot read service account JSON file')
    }
  }

  throw new Error('Google Sheets credentials not configured. Set GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS.')
}

async function getSheetsClient() {
  if (sheetsApi) return sheetsApi

  const spreadsheetId = process.env.GOOGLE_SHEETS_MEMBERSHIP_ID

  if (!spreadsheetId) {
    throw new Error('GOOGLE_SHEETS_MEMBERSHIP_ID not configured.')
  }

  const serviceAccountJson = await loadServiceAccountJson()

  // Dynamic import to avoid build-time issues
  const { google } = await import('googleapis')
  const auth = new google.auth.GoogleAuth({
    credentials: serviceAccountJson,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  })
  sheetsApi = google.sheets({ version: 'v4', auth })
  return sheetsApi
}

const SHEET_NAME = 'Membership Master'

function memberToRow(m: Member): string[] {
  return [
    m.memberId,
    m.firstName     ?? '',
    m.lastName      ?? '',
    m.email,
    m.phone         ?? '',
    m.wechatId      ?? '',
    m.district      ?? '',
    m.gender        ?? '',
    m.yearBorn != null ? String(m.yearBorn) : '',
    m.nyrrRunnerName ?? '',
    m.membershipType ?? 'individual',
    m.status         ?? 'pending',
    m.joinYear != null ? String(m.joinYear) : '',
  ]
}

/**
 * Find the row number for a given MemberID in column A.
 * Returns the 1-based row number, or null if not found.
 */
async function findMemberRow(sheets: any, spreadsheetId: string, memberId: string): Promise<number | null> {
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${SHEET_NAME}'!A:A`,
  })
  const values: string[][] = resp.data.values ?? []
  for (let i = 0; i < values.length; i++) {
    if (values[i][0] === memberId) return i + 1  // 1-based
  }
  return null
}

/**
 * Sync a member record to Google Sheets.
 * If the member already exists (by MemberID in column A), updates the row.
 * Otherwise, appends a new row.
 */
export async function syncMemberToSheets(member: Member): Promise<void> {
  const spreadsheetId = process.env.SPREADSHEET_ID
  if (!spreadsheetId) {
    console.warn('[sheets/sync] SPREADSHEET_ID not set, skipping sync')
    return
  }

  try {
    const sheets = await getSheetsClient()
    const row    = memberToRow(member)

    const existingRow = await findMemberRow(sheets, spreadsheetId, member.memberId)

    if (existingRow) {
      // Update existing row
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${SHEET_NAME}'!A${existingRow}:M${existingRow}`,
        valueInputOption: 'USER_ENTERED',
        requestBody: { values: [row] },
      })
    } else {
      // Append new row
      await sheets.spreadsheets.values.append({
        spreadsheetId,
        range: `'${SHEET_NAME}'!A:M`,
        valueInputOption: 'USER_ENTERED',
        insertDataOption: 'INSERT_ROWS',
        requestBody: { values: [row] },
      })
    }
  } catch (err) {
    console.error('[sheets/sync] Failed to sync member:', err)
    throw err
  }
}

/**
 * Sync a payment event to the "WebApp Events" sheet tab.
 * Columns: EventID, MemberID, Email, PaymentIntent, Amount, PaymentMethod,
 *          PayerName, PaymentDate, MemoField, Last4, Status, Timestamp
 */
export async function syncEventToSheets(event: {
  eventId: string
  memberId: string
  email: string
  paymentIntent: string
  amount: number
  paymentMethod: string
  payerName: string
  paymentDate: string
  memoField?: string
  last4?: string
  status: string
}): Promise<void> {
  const spreadsheetId = process.env.SPREADSHEET_ID
  if (!spreadsheetId) return

  try {
    const sheets = await getSheetsClient()
    const row = [
      event.eventId,
      event.memberId,
      event.email,
      event.paymentIntent,
      String(event.amount),
      event.paymentMethod,
      event.payerName,
      event.paymentDate,
      event.memoField ?? '',
      event.last4 ?? '',
      event.status,
      new Date().toISOString(),
    ]

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: "'WebApp Events'!A:L",
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    })
  } catch (err) {
    console.error('[sheets/sync] Failed to sync event:', err)
    throw err
  }
}
