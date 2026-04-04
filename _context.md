### 04-03 15:45 UTC — Fixed schema export & updated transaction import

**Changed:**
1. Fixed `/api/export-schema` tuple indices for SHOW CREATE {VIEW|PROCEDURE|FUNCTION} — all now access [3] for SQL statement ✅
2. Updated `/api/sync/import-transactions` to:
   - Read from Google Sheets: Timestamp, Sender, Amount, Memo, TransactionDate, TransactionNumber, MessageId, Subject, OriginalMemo
   - Map Source (Sheets) → PaymentMethod (MySQL)
   - Added MIGRATION to add Subject column to gmail_transactions table
3. GAS webhook already returns camelCase; mmr-admin normalizer converts to PascalCase ✅

**Status:**
- api_sheets_sync.py: import test passes ✅
- GAS sheets.ts: rowToFetchGmailRow already includes subject, messageId, transactionDate, originalMemo ✅
- mysql-mmr ready for MIGRATION_ADD_SUBJECT_TO_GMAIL_TRANSACTIONS.sql

**Next:**
- Run migration on Azure MySQL to add Subject column
- Update Fetch-Gmail sheet header from "TimeStamp" to "Timestamp"
- Trigger /api/sync/import-transactions to backfill gmail_transactions table
