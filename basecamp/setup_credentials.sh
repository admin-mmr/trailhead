#!/bin/bash
# Interactive setup for .env.local credentials

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env.local"

echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                 MMR Credentials Setup                          ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# Check if .env.local exists
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ .env.local not found at $ENV_FILE"
    exit 1
fi

echo "📝 Current .env.local:"
echo "────────────────────────────────────────────────────────────────"
cat "$ENV_FILE"
echo "────────────────────────────────────────────────────────────────"
echo ""

# Update DATABASE_URL
echo "🔐 MySQL Database Credentials"
echo "────────────────────────────────────────────────────────────────"
echo ""
echo "Enter your MySQL password for mmradmin user:"
echo "(This will be saved to .env.local - keep this file secure!)"
echo ""
read -sp "MySQL password: " MYSQL_PASSWORD
echo ""

# Build DATABASE_URL
MYSQL_HOST="mmr-mysql.mysql.database.azure.com"
MYSQL_USER="mmradmin"
MYSQL_DB="mmrdb"
DATABASE_URL="mysql://${MYSQL_USER}:${MYSQL_PASSWORD}@${MYSQL_HOST}:3306/${MYSQL_DB}?ssl=true"

# Update .env.local
sed -i.bak "s|DATABASE_URL=.*|DATABASE_URL=${DATABASE_URL}|" "$ENV_FILE"

echo "✅ DATABASE_URL updated in .env.local"
echo ""

# Test connection
echo "🧪 Testing MySQL connection..."
python3 << 'PYTHON'
import os
import mysql.connector
from urllib.parse import urlparse

try:
    db_url = os.environ.get('DATABASE_URL')
    if not db_url:
        db_url = open('.env.local').read()
        for line in db_url.split('\n'):
            if line.startswith('DATABASE_URL='):
                db_url = line.split('=', 1)[1]
                break

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
    cursor.execute("SELECT COUNT(*) FROM members;")
    count = cursor.fetchone()[0]
    cursor.close()
    conn.close()

    print(f"✅ Connection successful!")
    print(f"   Members in database: {count}")

except Exception as e:
    print(f"❌ Connection failed: {e}")
    print(f"   Check your password and try again")
    exit(1)
PYTHON

if [ $? -eq 0 ]; then
    echo ""
    echo "✨ Setup complete! You can now use:"
    echo "   source load-env.sh"
    echo "   python3 basecamp/ops/schema_inspector.py"
else
    echo ""
    echo "⚠️  Connection test failed. Please check:"
    echo "   1. MySQL password is correct"
    echo "   2. MySQL server is running"
    echo "   3. Network access is allowed"
fi
