# Quick Setup Guide: Database Connection

## Current Status

✅ Environment loaded
✅ Google Sheets IDs configured
✅ Gmail transaction sheet ID added: `1rVOvhXzSxCRpWdAw3jYq5tWrYdCYtXmfqblTHP_wPqA`
❌ MySQL password: Still has placeholder `your_password_here`

## Step 1: Add MySQL Password to .env.local

Your `basecamp/.env.local` currently has:
```
DATABASE_URL=mysql://mmradmin:your_password_here@mmr-mysql.mysql.database.azure.com:3306/mmrdb?ssl=true
```

**Replace `your_password_here` with your actual MySQL password:**

```bash
# Option A: Edit manually
nano basecamp/.env.local

# Option B: Use sed to replace (replace ACTUAL_PASSWORD with your password)
sed -i 's/your_password_here/ACTUAL_PASSWORD/g' basecamp/.env.local
```

## Step 2: Verify the Connection

Once you've updated the password, test the connection:

```bash
cd /sessions/jolly-inspiring-pascal/mnt/mmr--trailhead

# Load environment
source load-env.sh

# Test MySQL connection
python3 << 'EOF'
import mysql.connector
import os
from urllib.parse import urlparse

# Read DATABASE_URL from environment or file
db_url = os.environ.get('DATABASE_URL')

if not db_url:
    with open('basecamp/.env.local') as f:
        for line in f:
            if line.startswith('DATABASE_URL='):
                db_url = line.split('=', 1)[1].strip()
                break

print("Testing MySQL connection...")
print(f"URL: {db_url[:50]}...")

try:
    parsed = urlparse(db_url)
    config = {
        'host': parsed.hostname,
        'user': parsed.username,
        'password': parsed.password,
        'database': parsed.path.lstrip('/').split('?')[0],
        'ssl_disabled': False
    }

    conn = mysql.connector.connect(**config)
    cursor = conn.cursor()

    # Get summary
    cursor.execute("SHOW TABLES;")
    tables = cursor.fetchall()

    cursor.execute("SELECT COUNT(*) FROM members;")
    members = cursor.fetchone()[0]

    print(f"\n✅ Connection successful!")
    print(f"   Tables: {len(tables)}")
    print(f"   Members: {members}")

    cursor.close()
    conn.close()

except Exception as e:
    print(f"\n❌ Connection failed: {e}")
    import sys
    sys.exit(1)
EOF
```

## Step 3: Run Schema Inspector

Once connected, you can inspect your database:

```bash
# Show table summary and validation
python3 basecamp/ops/schema_inspector.py

# Show detailed schema for all tables
python3 basecamp/ops/schema_inspector.py --all

# Show specific table
python3 basecamp/ops/schema_inspector.py --table members

# Export schema as JSON
python3 basecamp/ops/schema_inspector.py --json > schema.json
```

## Available Commands

```bash
python3 basecamp/ops/schema_inspector.py --summary       # Show table row counts
python3 basecamp/ops/schema_inspector.py --all           # Show all table schemas
python3 basecamp/ops/schema_inspector.py --table <name>  # Show specific table
python3 basecamp/ops/schema_inspector.py --validate      # Validate schema
python3 basecamp/ops/schema_inspector.py --json          # Export as JSON
```

## Troubleshooting

### "DATABASE_URL not set"
- Make sure `basecamp/.env.local` has the correct DATABASE_URL
- Verify the password was replaced (search for "your_password_here" - should not exist)
- Run: `source load-env.sh` before running the Python script

### "Can't connect to MySQL server"
- Check MySQL password is correct
- Verify MySQL host is accessible: `ping mmr-mysql.mysql.database.azure.com`
- Check firewall/network access to Azure MySQL
- Verify database name is `mmrdb` (should be)

### "Access denied for user 'mmradmin'"
- Password is wrong
- User doesn't exist in MySQL
- Check Azure MySQL allows your IP address

## What's Ready to Use

**Schema Inspector Tool** (`basecamp/ops/schema_inspector.py`):
- ✅ Inspect all tables and columns
- ✅ View row counts
- ✅ Check primary keys and foreign keys
- ✅ Validate data integrity
- ✅ Export schema as JSON
- ✅ Compare against expected schema

**Example Output:**
```
===============================================================================
TABLE SUMMARY
===============================================================================
Table Name                         Rows     Status

activity_log                          0     ⭕ Empty
config                               12     📊 Has data
families                              0     ⭕ Empty
gmail_transactions                    0     ⭕ Empty
member_log                          616     📊 Has data
members                             616     📊 Has data
otp_tokens                            0     ⭕ Empty
password_reset_tokens                 0     ⭕ Empty
payment_events                        0     ⭕ Empty
payments                              0     ⭕ Empty
schema_migrations                     4     📊 Has data

TOTAL                              1248
===============================================================================
```

## Next Steps

Once MySQL is connected:

1. **Reconcile Schema** → Run `schema_inspector.py --all`
2. **Check Data Integrity** → Review foreign key relationships
3. **Identify Missing Data** → See which tables need syncing
4. **Start Syncing** → Use `sync_sheets_to_mysql.py` for families, payments, etc.

---

**Question?** Need help with anything in this guide?
