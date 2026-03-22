#!/usr/bin/env bash
# ============================================================
# start-dev.sh — Start Next.js dev server
#                DATABASE_URL is read from macOS Keychain —
#                the password never lives in a file.
#
# HOW TO USE:
#   chmod +x web-apps/mmr-webapp/start-dev.sh   # first time only
#   ./web-apps/mmr-webapp/start-dev.sh           # from repo root
#   cd web-apps/mmr-webapp && ./start-dev.sh     # or from here
#
# KEYCHAIN ENTRIES USED (both already exist — no setup needed):
#   1. "MMR_DATABASE_URL"                           — full mysql:// URL (primary)
#   2. "Mysql@mmr-mysql-v4....:3306" / "mmradmin"  — password only (mysql-mmr alias, fallback)
#
# The script tries #1 first. If the value starts with mysql:// it parses out
# user + password, re-encodes the password safely, and exports DATABASE_URL.
# If only #2 is found it builds the URL from the password + hard-coded host/db.
# ============================================================

set -euo pipefail

# ── Config — fallback values if password-only entry is used ─
DB_HOST="mmr-mysql-v4.mysql.database.azure.com"
DB_USER="mmradmin"
DB_NAME="mmrdb"
DB_PORT="3306"

# ── 1. Try Keychain entries in order ────────────────────────
#
#   Priority 1: MMR_DATABASE_URL  — stores the full mysql:// URL
#   Priority 2: Mysql@host:port   — stores just the password
#                                   (same entry the mysql-mmr alias uses)
#
STORED=""
FOUND_SERVICE=""

# Priority 1: full URL entry (no account needed)
VAL=$(security find-generic-password -s "MMR_DATABASE_URL" -w 2>/dev/null || true)
if [[ -n "$VAL" ]]; then
  STORED="$VAL"
  FOUND_SERVICE="MMR_DATABASE_URL"
fi

# Priority 2: password-only entry used by mysql-mmr alias
if [[ -z "$STORED" ]]; then
  VAL=$(security find-generic-password \
    -s "Mysql@${DB_HOST}:${DB_PORT}" -a "$DB_USER" -w 2>/dev/null || true)
  if [[ -n "$VAL" ]]; then
    STORED="$VAL"
    FOUND_SERVICE="Mysql@${DB_HOST}:${DB_PORT}"
  fi
fi

if [[ -z "$STORED" ]]; then
  echo ""
  echo "❌  No Keychain entry found."
  echo "    Tried: 'MMR_DATABASE_URL'  and  'Mysql@${DB_HOST}:${DB_PORT}' (acct: $DB_USER)"
  echo ""
  echo "    To see what's available:"
  echo "    security dump-keychain 2>/dev/null | grep -B2 'mmr\\|mysql\\|DATABASE'"
  echo ""
  exit 1
fi

# ── 2. Parse — stored value may be a full URL or just a password ─
if [[ "$STORED" == mysql://* ]]; then
  # Full URL stored — parse user, password, host, db out of it
  # so we can URL-encode the password and reassemble cleanly.
  PARSED=$(python3 - "$STORED" <<'PYEOF'
import sys
from urllib.parse import urlparse, quote

url = urlparse(sys.argv[1])
user     = url.username or ""
password = url.password or ""
host     = url.hostname or ""
port     = url.port or 3306
db       = url.path.lstrip("/")

# Re-encode password to be safe (it may contain special chars)
encoded_pass = quote(password, safe="")
print(f"mysql://{user}:{encoded_pass}@{host}:{port}/{db}")
PYEOF
  )
  export DATABASE_URL="$PARSED"
  echo "✓  DATABASE_URL parsed from Keychain entry '$FOUND_SERVICE'"

else
  # Plain password stored — URL-encode it and build the URL
  ENCODED_PASS=$(python3 -c \
    "import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=''))" \
    "$STORED")
  export DATABASE_URL="mysql://${DB_USER}:${ENCODED_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}"
  echo "✓  DATABASE_URL built from Keychain entry '$FOUND_SERVICE' (password not shown)"
fi

# ── 3. Start dev server ──────────────────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

exec npm run dev
