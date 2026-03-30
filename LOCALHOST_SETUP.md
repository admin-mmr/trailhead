# localhost:5050 Setup Guide

## Problem
The `nyrr` alias fails with: `ModuleNotFoundError: No module named 'azure.communication'`

The import chain is:
- `app.py` → imports `api_payments.py`
- `api_payments.py` → imports `payment_actions.py`
- `payment_actions.py` → imports `email_client.py`
- `email_client.py` → needs `azure.communication.email`

This module **is not in `requirements.txt`** and `requirements.txt` is incomplete.

---

## Step-by-Step Fix

### Step 1: Check Python version
```bash
python3 --version
# Should be 3.9+
```

### Step 2: Install/upgrade required packages
```bash
cd ~/github/mmr/trailhead/mmr-admin
pip3 install --upgrade pip
pip3 install -r requirements.txt
```

### Step 3: Install missing Azure module
```bash
pip3 install azure-communication-email --break-system-packages
```

### Step 4: Verify imports
```bash
python3 -c "from azure.communication.email import EmailClient; print('✓ azure.communication imported')"
```

### Step 5: Test database connection
```bash
source load-env.sh
echo "DB_URL: $DATABASE_URL"
mysql-mmr -e "SELECT 1;" 2>&1 | head -5
```

**Expected:** Either `1` (connection OK) or `Can't connect...` (firewall/VPN issue — that's the next step).

### Step 6: Resolve database connectivity (if needed)
If you get `Can't connect to MySQL server`:

**Option A: VPN (Azure-connected network)**
- Ensure you're on the company VPN that allows Azure MySQL access
- Test: `ping mmr-mysql-v4.mysql.database.azure.com`

**Option B: Firewall rule (lasting solution)**
- Ask DevOps to add your home IP to Azure MySQL firewall
- Find your IP: `curl -s ifconfig.me`
- Firewall rule: add IP → `mmr-mysql-v4` → Allow port 3306

**Option C: SSH tunnel (temporary workaround)**
```bash
ssh -L 3306:mmr-mysql-v4.mysql.database.azure.com:3306 jumphost.example.com
# Then connect to localhost:3306 instead
```

### Step 7: Bypass OAuth for local dev (optional)
If Google/Microsoft OAuth isn't configured, set:
```bash
export DEV_BYPASS_AUTH=true
```

### Step 8: Start the app
```bash
nyrr
# Or manually:
cd ~/github/mmr/trailhead/mmr-admin
source load-env.sh
python3 app.py
```

**Expected output:**
```
 * Running on http://127.0.0.1:5050
 * Press CTRL+C to quit
```

Then open http://localhost:5050 in your browser.

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| `ModuleNotFoundError: azure.communication` | Package not installed | `pip3 install azure-communication-email --break-system-packages` |
| `Can't connect to MySQL server (60)` | Firewall or VPN | Check VPN/firewall, or use SSH tunnel |
| `GOOGLE_SHEETS_MEMBERSHIP_ID not set` | Keychain missing entry | Normal warning — Sheets sync won't work, but app loads |
| `Address already in use` | Port 5050 taken | `lsof -i :5050` then `kill -9 <PID>` |
| `ModuleNotFoundError: <other>` | Missing dependency | Add to `requirements.txt`, then `pip3 install` |

---

## What to do after setup

1. **Verify all endpoints load:**
   - http://localhost:5050 — main dashboard
   - http://localhost:5050/admin — admin panel (if auth bypassed)

2. **Check console for warnings** — some are expected (Sheets sync, SSL version, etc.).

3. **If you edit Python files**, the Flask dev server auto-reloads.

4. **To stop:** Press `CTRL+C` in the terminal.

---

## Requirements.txt is incomplete
Add these to `mmr-admin/requirements.txt`:
```
azure-communication-email>=1.0
```

Then run:
```bash
pip3 install -r requirements.txt --break-system-packages
```
