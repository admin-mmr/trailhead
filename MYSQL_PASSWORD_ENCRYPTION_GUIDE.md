# MySQL Password Encryption & Secure Storage

**Date**: March 21, 2026
**Goal**: Store MySQL credentials securely (not plain text in `.env.local`)

---

## Options Overview

| Option | Best For | Setup | Security | CI/CD |
|--------|----------|-------|----------|-------|
| **macOS Keychain** | Local development | ✅ Easy | ⭐⭐⭐⭐⭐ Excellent | ❌ No |
| **Azure Key Vault** | Production + Linux | 🟡 Moderate | ⭐⭐⭐⭐⭐ Excellent | ✅ Yes |
| **GitHub Secrets** | CI/CD pipelines | ✅ Easy | ⭐⭐⭐⭐ Good | ✅ Yes |
| **Encrypted .env** | Local development | 🟡 Moderate | ⭐⭐⭐ Fair | ❌ No |
| **.env.local (current)** | Testing only | ✅ Easy | ⭐ Poor | ❌ No |

---

## Recommended Architecture

```
┌─ macOS (local development) ─────────────────────┐
│                                                 │
│  load-env.sh                                    │
│  ├─ Reads .env.local (non-secrets)              │
│  └─ Reads macOS Keychain                        │
│      ├─ GOOGLE_APPLICATION_CREDENTIALS          │
│      └─ DATABASE_URL ← PASSWORD HERE ⭐         │
│                                                 │
└─────────────────────────────────────────────────┘

┌─ Linux VM / GitHub Actions ─────────────────────┐
│                                                 │
│  sync-sheets-to-mysql.py                        │
│  ├─ Read .env.local (non-secrets)               │
│  └─ Read Azure Key Vault OR GitHub Secrets      │
│      ├─ GOOGLE_APPLICATION_CREDENTIALS          │
│      └─ DATABASE_URL ← PASSWORD FROM VAULT ⭐   │
│                                                 │
└─────────────────────────────────────────────────┘

┌─ Azure MySQL ──────────────────────────────────┐
│                                                 │
│  ✅ Only accessible with correct password      │
│  ✅ SSL/TLS encryption in transit              │
│  ✅ No plaintext passwords stored anywhere     │
│                                                 │
└─────────────────────────────────────────────────┘
```

---

## Solution 1: Use macOS Keychain + Azure Key Vault

**This is the recommended approach** ✅

### Part A: macOS Local Development (Already Working)

Your `load-env.sh` already does this:

```bash
# .env.local contains non-secrets (sheet IDs, storage connection)
SPREADSHEET_ID=11SFv...
GMAIL_TRANSACTION_SHEET_ID=1ABC...

# Keychain contains secrets
DATABASE_URL=$(security find-generic-password -a "$USER" -s "MMR_DATABASE_URL" -w)
GOOGLE_APPLICATION_CREDENTIALS=$(security find-generic-password -a "$USER" -s "MMR_GOOGLE_CREDS_PATH" -w)
```

**To verify it's working**:
```bash
security find-generic-password -a "$USER" -s "MMR_DATABASE_URL"
```

### Part B: Azure Key Vault for Linux/CI-CD

**Step 1: Create a secret in Azure Key Vault**

```bash
# Install Azure CLI
# brew install azure-cli

# Login to Azure
az login

# Create secret in Key Vault
az keyvault secret set \
  --vault-name "mmr-keyvault" \
  --name "mysql-database-url" \
  --value "mysql://mmradmin:YOUR_PASSWORD@mmr-mysql.mysql.database.azure.com:3306/mmrdb?ssl=true"
```

**Step 2: Update `load-env.sh` to read from Key Vault on Linux**

```bash
#!/bin/bash
# Enhanced load-env.sh for macOS + Linux

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/basecamp/.env.local"

# Load non-secret variables from .env.local
if [ -f "$ENV_FILE" ]; then
    export $(grep -v '^#' "$ENV_FILE" | xargs)
    echo "✓ Loaded from .env.local"
fi

# Load secrets based on OS
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS: Use Keychain
    echo "✓ Loading from macOS Keychain..."
    GOOGLE_CREDS_PATH=$(security find-generic-password -a "$USER" -s "MMR_GOOGLE_CREDS_PATH" -w 2>/dev/null)
    export GOOGLE_APPLICATION_CREDENTIALS="$GOOGLE_CREDS_PATH"
    echo "  ✓ GOOGLE_APPLICATION_CREDENTIALS set"

    DATABASE_URL=$(security find-generic-password -a "$USER" -s "MMR_DATABASE_URL" -w 2>/dev/null)
    export DATABASE_URL
    echo "  ✓ DATABASE_URL set"

else
    # Linux: Use Azure Key Vault
    echo "✓ Loading from Azure Key Vault..."

    # Check if az CLI is available
    if ! command -v az &> /dev/null; then
        echo "  ⚠️  Azure CLI not found. Install with: pip install azure-cli"
    fi

    # Retrieve secrets from Key Vault
    GOOGLE_CREDS_JSON=$(az keyvault secret show \
        --vault-name "mmr-keyvault" \
        --name "google-credentials-json" \
        --query value -o tsv 2>/dev/null)

    if [ -n "$GOOGLE_CREDS_JSON" ]; then
        # Save to temp file and set path
        TEMP_CREDS=$(mktemp)
        echo "$GOOGLE_CREDS_JSON" > "$TEMP_CREDS"
        export GOOGLE_APPLICATION_CREDENTIALS="$TEMP_CREDS"
        echo "  ✓ GOOGLE_APPLICATION_CREDENTIALS set"
    fi

    DATABASE_URL=$(az keyvault secret show \
        --vault-name "mmr-keyvault" \
        --name "mysql-database-url" \
        --query value -o tsv 2>/dev/null)
    export DATABASE_URL
    echo "  ✓ DATABASE_URL set"
fi

echo "✅ All environment variables loaded!"
```

**Step 3: Test it works**

```bash
source load-env.sh
python3 basecamp/ops/test_mysql_connection.py
```

---

## Solution 2: GitHub Secrets for CI/CD Pipelines

**For GitHub Actions workflows**:

### Step 1: Add Secrets to GitHub

Go to: **Settings → Secrets and variables → Actions**

Add these secrets:
```
MYSQL_DATABASE_URL = mysql://mmradmin:PASSWORD@mmr-mysql.mysql.database.azure.com:3306/mmrdb?ssl=true
GOOGLE_CREDENTIALS_JSON = <contents of service account JSON>
SPREADSHEET_ID = 11SFv...
GMAIL_TRANSACTION_SHEET_ID = 1ABC...
AZURE_STORAGE_CONNECTION_STRING = ...
```

### Step 2: Use in GitHub Actions Workflow

Create `.github/workflows/sync-sheets-to-mysql.yml`:

```yaml
name: Sync Google Sheets to MySQL

on:
  schedule:
    - cron: '0 2 * * *'  # Daily at 2 AM UTC
  workflow_dispatch:

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.9'

      - name: Install dependencies
        run: |
          python -m pip install --upgrade pip
          pip install -r basecamp/requirements.txt

      - name: Load secrets from GitHub
        run: |
          # Create .env.local from GitHub Secrets
          cat > basecamp/.env.local << EOF
          SPREADSHEET_ID=${{ secrets.SPREADSHEET_ID }}
          GMAIL_TRANSACTION_SHEET_ID=${{ secrets.GMAIL_TRANSACTION_SHEET_ID }}
          AZURE_STORAGE_CONNECTION_STRING=${{ secrets.AZURE_STORAGE_CONNECTION_STRING }}
          DATABASE_URL=${{ secrets.MYSQL_DATABASE_URL }}
          EOF

          # Create Google credentials file
          echo '${{ secrets.GOOGLE_CREDENTIALS_JSON }}' > /tmp/google-creds.json
          echo "GOOGLE_APPLICATION_CREDENTIALS=/tmp/google-creds.json" >> basecamp/.env.local

      - name: Run sync
        run: |
          cd basecamp
          source load-env.sh
          python3 ops/sync_sheets_to_mysql.py

      - name: Notify on failure
        if: failure()
        run: echo "Sync failed - check logs"
```

---

## Solution 3: Encrypted .env Files (Local Only)

**If you want to keep everything local but encrypted**:

### Step 1: Install dotenv-vault

```bash
pip install python-dotenv-vault
```

### Step 2: Create encrypted .env

```bash
# Create plaintext file first
cat > basecamp/.env.local.plain << 'EOF'
SPREADSHEET_ID=11SFv...
DATABASE_URL=mysql://mmradmin:PASSWORD@...
GOOGLE_APPLICATION_CREDENTIALS=/path/to/creds.json
EOF

# Encrypt it
python3 << 'PYTHON'
from dotenv import load_dotenv
import json

# Load plain file
with open('basecamp/.env.local.plain') as f:
    content = f.read()

# Encrypt with AES
# (This is a simplified example; use proper library)
encrypted = encrypt_aes(content, key='YOUR_SECRET_KEY')

# Save encrypted version
with open('basecamp/.env.local.encrypted', 'w') as f:
    f.write(encrypted)

# Delete plaintext
import os
os.remove('basecamp/.env.local.plain')
PYTHON
```

**Downside**: You still need the encryption key stored somewhere, so this just moves the problem.

---

## What NOT to Do

❌ **Don't do this**:
```bash
# ❌ Plain text in .env.local
DATABASE_URL=mysql://mmradmin:YourActualPassword123@...

# ❌ Commit to GitHub
git add basecamp/.env.local
git commit -m "Add credentials"
git push

# ❌ Hardcode in Python
DATABASE_URL = "mysql://mmradmin:password@..."

# ❌ Commit to GitHub (already in .gitignore, but be careful!)
git add -f basecamp/.env.local
```

---

## Recommended Implementation for Your Project

### For macOS Development (Today)

✅ **Keep using Keychain** (what you already have):

```bash
# Your credentials are safe in Keychain
security find-generic-password -a "$USER" -s "MMR_DATABASE_URL"
```

### For GitHub Actions (CI/CD)

✅ **Use GitHub Secrets**:

1. Add secrets to GitHub repo
2. Update `.github/workflows/sync-sheets-to-mysql.yml` to use them
3. Never store credentials in .env.local in repo

### For Azure Linux VM (Manual Sync from VM)

✅ **Use Azure Key Vault**:

1. Create secrets in Key Vault
2. Update `load-env.sh` to fetch from Key Vault
3. Authenticate with `az login` (uses Azure credentials)

---

## Quick Setup: Keep Current Keychain Approach (Safest)

**Bottom line**: Your current setup is actually quite good:

```bash
# .env.local (in .gitignore - safe)
SPREADSHEET_ID=11SFv...
GMAIL_TRANSACTION_SHEET_ID=1ABC...
AZURE_STORAGE_CONNECTION_STRING=...

# Keychain (encrypted by macOS - very safe)
DATABASE_URL=mysql://...
GOOGLE_APPLICATION_CREDENTIALS=/path/to/creds.json
```

**To verify nothing sensitive is committed**:

```bash
# Check what's in .env.local (should be safe)
cat basecamp/.env.local

# Verify .env.local is in .gitignore
cat .gitignore | grep env

# Double-check it's not tracked
git status | grep env.local
```

---

## Security Checklist

- [ ] MySQL password is NOT in any text file
- [ ] .env.local is in .gitignore
- [ ] .env.local is never committed to GitHub
- [ ] Credentials use Keychain (macOS) or Key Vault (Azure)
- [ ] GitHub Actions use GitHub Secrets
- [ ] DATABASE_URL includes `?ssl=true` for encrypted connection
- [ ] Service account JSON is not committed to repo
- [ ] `.gitignore` includes: `*.env.local`, `*.json`, `credentials.json`, `service-account-*.json`

---

## Testing Your Setup

```bash
# 1. Verify Keychain has the credential
security find-generic-password -a "$USER" -s "MMR_DATABASE_URL"

# 2. Source the loader
source load-env.sh

# 3. Verify variable is set (output should be redacted)
echo $DATABASE_URL | head -c 50
# Expected: mysql://mmradmin:***REDACTED***@mmr-mysql...

# 4. Test connection
python3 basecamp/ops/test_mysql_connection.py
```

---

## If You Want Maximum Security

**Use Azure Key Vault + Managed Identity**:

```python
# basecamp/ops/load_secrets.py
from azure.identity import ManagedIdentityCredential
from azure.keyvault.secrets import SecretClient

credential = ManagedIdentityCredential()
client = SecretClient(vault_url="https://mmr-keyvault.vault.azure.net/", credential=credential)

DATABASE_URL = client.get_secret("mysql-database-url").value
GOOGLE_CREDS = client.get_secret("google-credentials-json").value
```

**Then in your sync script**:

```python
import sys
sys.path.insert(0, 'basecamp/ops')
from load_secrets import DATABASE_URL, GOOGLE_CREDS
```

This way:
- ✅ No credentials stored locally
- ✅ No GitHub Secrets needed
- ✅ Azure handles authentication automatically
- ✅ Audit trail of who accessed secrets
- ✅ Easy credential rotation

---

## My Recommendation

**For your current setup**:

1. **Keep using macOS Keychain for local development** ← You're already doing this ✅
2. **Add GitHub Secrets for CI/CD workflows** ← Easy to add
3. **Optional: Add Azure Key Vault for future production access** ← Can do later

**No changes needed today** — your Keychain approach is secure! Just verify:

```bash
security find-generic-password -a "$USER" -s "MMR_DATABASE_URL"
# Should return your encrypted password safely
```

Would you like me to help you:
1. Set up GitHub Secrets for CI/CD?
2. Configure Azure Key Vault?
3. Verify your current Keychain setup is working?
4. Something else?
