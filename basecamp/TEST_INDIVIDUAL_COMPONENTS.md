# Testing Individual Components

When something breaks, it helps to test each piece separately to isolate the problem.

## Test 1: Environment Variables Load Correctly

```bash
cd basecamp

# Start fresh
unset SPREADSHEET_ID AZURE_STORAGE_CONNECTION_STRING DATABASE_URL

# Load and check
source load-env.sh

echo "=== Test 1: Environment Variables ==="
echo "SPREADSHEET_ID exists: $([ -z "$SPREADSHEET_ID" ] && echo "NO ✗" || echo "YES ✓")"
echo "DATABASE_URL exists: $([ -z "$DATABASE_URL" ] && echo "NO ✗" || echo "YES ✓")"
echo "AZURE_STORAGE_CONNECTION_STRING length: ${#AZURE_STORAGE_CONNECTION_STRING}"
[ ${#AZURE_STORAGE_CONNECTION_STRING} -gt 100 ] && echo "Azure string length OK ✓" || echo "Azure string too short ✗"
```

**Expected output:**
- All should show YES ✓
- Azure string length should be 150+

**If this fails:** Check `.env.local` file is in the right place and has correct values.

---

## Test 2: Google Credentials Load

```bash
cd basecamp

source load-env.sh

python3 << 'EOF'
import json
import os

creds_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
print(f"Credentials path: {creds_path}")
print(f"File exists: {os.path.exists(creds_path)}")

if os.path.exists(creds_path):
    try:
        with open(creds_path) as f:
            creds = json.load(f)
        print(f"✓ Credentials loaded successfully")
        print(f"  Service account: {creds.get('client_email')}")
        print(f"  Type: {creds.get('type')}")
    except json.JSONDecodeError:
        print("✗ Credentials file is not valid JSON")
    except Exception as e:
        print(f"✗ Error: {e}")
else:
    print("✗ Credentials file not found")
EOF
```

**Expected output:**
- Should show service account email
- Type should be "service_account"

**If this fails:** Check that GOOGLE_APPLICATION_CREDENTIALS path is correct and file contains valid JSON.

---

## Test 3: Google Sheets API Can Connect

```bash
cd basecamp

source load-env.sh

python3 << 'EOF'
import os
import sys
from google.oauth2 import service_account
from googleapiclient.discovery import build

try:
    creds_path = os.environ['GOOGLE_APPLICATION_CREDENTIALS']
    creds = service_account.Credentials.from_service_account_file(
        creds_path,
        scopes=['https://www.googleapis.com/auth/spreadsheets.readonly']
    )

    service = build('sheets', 'v4', credentials=creds)
    spreadsheet_id = os.environ['SPREADSHEET_ID']

    # Try to read one cell
    result = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range="Main!A1:B1"
    ).execute()

    values = result.get('values', [])
    print(f"✓ Successfully connected to Google Sheets")
    print(f"  Spreadsheet ID: {spreadsheet_id}")
    print(f"  First row data: {values}")

except Exception as e:
    print(f"✗ Google Sheets API error: {e}")
    import traceback
    traceback.print_exc()
EOF
```

**Expected output:**
- Should show the first row from Main sheet
- If Main sheet is empty, should show empty array or first few headers

**If this fails:**
- Check SPREADSHEET_ID is correct
- Check Google service account has access to the sheet (share it with the service account email)
- Check network connectivity

---

## Test 4: MySQL Connection Works

```bash
cd basecamp

source load-env.sh

python3 << 'EOF'
import os
import mysql.connector

try:
    db_url = os.environ['DATABASE_URL']
    # Parse MySQL URL format: mysql://user:password@host:port/database
    parts = db_url.replace('mysql://', '').split('@')
    user_pass = parts[0].split(':')
    host_db = parts[1].split('/')

    user = user_pass[0]
    password = user_pass[1]
    host = host_db[0].split(':')[0]
    port = int(host_db[0].split(':')[1]) if ':' in host_db[0] else 3306
    database = host_db[1]

    print(f"Connecting to: {user}@{host}:{port}/{database}")

    conn = mysql.connector.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database
    )

    cursor = conn.cursor()
    cursor.execute("SELECT 1")
    result = cursor.fetchone()
    cursor.close()
    conn.close()

    print(f"✓ Successfully connected to MySQL")
    print(f"  Host: {host}:{port}")
    print(f"  Database: {database}")

except Exception as e:
    print(f"✗ MySQL connection error: {e}")
    import traceback
    traceback.print_exc()
EOF
```

**Expected output:**
- Should show successful connection message

**If this fails:**
- Check DATABASE_URL is correct
- Check MySQL server is running and accessible
- Check database firewall allows your IP
- Check username/password is correct

---

## Test 5: Azure Storage Connection Works

```bash
cd basecamp

source load-env.sh

python3 << 'EOF'
import os
from azure.storage.blob import BlobServiceClient

try:
    conn_str = os.environ['AZURE_STORAGE_CONNECTION_STRING']
    print(f"Connection string length: {len(conn_str)}")

    if len(conn_str) < 50:
        print("✗ Connection string seems too short")
        exit(1)

    client = BlobServiceClient.from_connection_string(conn_str)

    # Try to list containers
    containers = list(client.list_containers())
    print(f"✓ Successfully connected to Azure Storage")
    print(f"  Containers: {[c['name'] for c in containers]}")

except Exception as e:
    print(f"✗ Azure Storage error: {e}")
    import traceback
    traceback.print_exc()
EOF
```

**Expected output:**
- Should show list of containers (may be empty)

**If this fails:**
- Check AZURE_STORAGE_CONNECTION_STRING is complete
- Check Azure Storage account exists and is accessible
- Check connection string includes AccountKey

---

## Test 6: Full Sync Process (Dry Run)

```bash
cd basecamp

source load-env.sh

python3 ops/sync_sheets_to_mysql.py \
  --sheet-name "Main" \
  --table-name "members" \
  --dry-run
```

**Expected output:**
- Should show number of rows read from Google Sheets
- Should show "Would sync X rows"
- Should NOT make any database changes

**If this fails:**
- Check all of Tests 1-5 above first
- Check column names in Google Sheets don't have spaces
- Check data exists in the Google Sheet

---

## Test 7: Individual Component Imports

If you want to test just importing the modules (no actual operations):

```bash
cd basecamp

python3 << 'EOF'
print("Testing imports...")

try:
    from utils.google_sheets import GoogleSheetsClient
    print("✓ GoogleSheetsClient imported")
except Exception as e:
    print(f"✗ GoogleSheetsClient error: {e}")

try:
    from utils.mysql_client import MySQLClient
    print("✓ MySQLClient imported")
except Exception as e:
    print(f"✗ MySQLClient error: {e}")

try:
    from utils.azure_storage import AzureBlobClient
    print("✓ AzureBlobClient imported")
except Exception as e:
    print(f"✗ AzureBlobClient error: {e}")

try:
    from utils.email_notifications import EmailNotifier
    print("✓ EmailNotifier imported")
except Exception as e:
    print(f"✗ EmailNotifier error: {e}")
EOF
```

**Expected output:**
- All should show ✓

**If this fails:**
- Check requirements are installed: `pip install -r requirements.txt --break-system-packages`

---

## Test 8: GitHub Actions Secrets (Manual Check)

You can't test this directly from the command line, but you can check secrets are set:

```bash
# List what secrets you've created (names only, not values)
gh secret list

# Check a specific secret exists
gh secret list | grep GOOGLE_SHEETS_MEMBERSHIP_ID
```

**Expected output:**
- Should show all 11+ required secrets

---

## Test Flow When Something Breaks

1. **Does it fail locally or in GitHub Actions?**
   - Try Test 6 (Dry Run) locally
   - If that fails, run Tests 1-5 to find which component breaks
   - If local works but GitHub Actions fails, it's a secrets problem

2. **If Test 1 fails:**
   - `.env.local` path issue or variable parsing problem
   - Check load-env.sh script

3. **If Test 2 fails:**
   - Google credentials file problem
   - Check GOOGLE_APPLICATION_CREDENTIALS path

4. **If Test 3 fails:**
   - Google Sheets API problem
   - Check service account has access to sheet
   - Check column names in sheet (no spaces!)

5. **If Test 4 fails:**
   - MySQL connection problem
   - Check database is running
   - Check firewall rules
   - Check credentials in DATABASE_URL

6. **If Test 5 fails:**
   - Azure Storage problem
   - Check AZURE_STORAGE_CONNECTION_STRING is complete
   - Check Azure account exists

7. **If Test 6 fails:**
   - Sync logic problem
   - Check all Tests 1-5 pass first
   - Check Google Sheets have data
   - Check column names match exactly (no spaces)

---

## Quick Diagnostic Command

Run this to test everything at once:

```bash
cd basecamp && source load-env.sh && echo "✓ Env loaded" && \
python3 -c "from utils.google_sheets import GoogleSheetsClient; print('✓ GS Client')" && \
python3 -c "from utils.mysql_client import MySQLClient; print('✓ MySQL Client')" && \
python3 -c "from utils.azure_storage import AzureBlobClient; print('✓ Azure Client')" && \
python3 ops/sync_sheets_to_mysql.py --sheet-name "Main" --table-name "members" --dry-run
```

If this completes with all ✓ marks, your setup is ready.
