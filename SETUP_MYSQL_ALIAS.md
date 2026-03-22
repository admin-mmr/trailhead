# MySQL Setup: Create mysql-mmr Alias

This guide helps you (and any team member) set up the `mysql-mmr` alias for quick access to the MMR database.

## What is mysql-mmr?

A convenient alias that connects to the MMR MySQL database without entering credentials:

```bash
mysql-mmr -e "SELECT COUNT(*) FROM members;"
```

Instead of:

```bash
mysql --login-path=mmr -D mmrdb -e "SELECT COUNT(*) FROM members;"
```

---

## Setup Instructions

### Step 1: Configure MySQL Login Path (One-Time Setup)

Store your Azure MySQL credentials securely using MySQL's built-in `mysql_config_editor`:

```bash
mysql_config_editor set --login-path=mmr \
    --host=mmr-mysql-v4.mysql.database.azure.com \
    --user=mmradmin \
    --password
```

When prompted, enter your MySQL password. It will be stored encrypted in `~/.mylogin.cnf`.

**Verify it worked:**

```bash
mysql --login-path=mmr -D mmrdb -e "SELECT 1 as connected;"
```

You should see `connected | 1` without being asked for a password.

---

### Step 2: Create the Shell Alias

Add this to your shell configuration file:

**For macOS/Linux with zsh** (`~/.zshrc`):

```bash
alias mysql-mmr='mysql --login-path=mmr -D mmrdb'
```

**For bash** (`~/.bash_profile` or `~/.bashrc`):

```bash
alias mysql-mmr='mysql --login-path=mmr -D mmrdb'
```

---

### Step 3: Reload Your Shell

```bash
source ~/.zshrc  # for zsh
# OR
source ~/.bash_profile  # for bash
```

---

### Step 4: Verify the Alias Works

```bash
mysql-mmr -e "SELECT COUNT(*) as member_count FROM members;"
```

You should see the member count without entering a password. ✅

---

## Usage Examples

**Check member count:**
```bash
mysql-mmr -e "SELECT COUNT(*) FROM members;"
```

**View sample records:**
```bash
mysql-mmr -e "SELECT member_id, email, first_name FROM members LIMIT 5;"
```

**Describe table schema:**
```bash
mysql-mmr -e "DESCRIBE members;"
```

**Run a query from a file:**
```bash
mysql-mmr < /path/to/query.sql
```

---

## Troubleshooting

**"Unknown MySQL server host"**
- Check the host name: `mmr-mysql-v4.mysql.database.azure.com`
- Verify your network can reach Azure MySQL (firewall rules)

**"Access denied for user 'mmradmin'"**
- Re-run: `mysql_config_editor set --login-path=mmr --password` with correct password
- Verify in Azure Portal that your password hasn't changed

**"Connection refused"**
- Make sure Azure MySQL server is running
- Check your local network connection

---

## Team Member Setup Checklist

If a new team member needs to use the MMR database:

- [ ] 1. Ask DevOps for Azure MySQL password
- [ ] 2. Run: `mysql_config_editor set --login-path=mmr --host=mmr-mysql-v4.mysql.database.azure.com --user=mmradmin --password`
- [ ] 3. Add alias to `~/.zshrc` or `~/.bash_profile`
- [ ] 4. Run: `source ~/.zshrc` (or `~/.bash_profile`)
- [ ] 5. Test: `mysql-mmr -e "SELECT 1;"`
- [ ] ✅ Done!

---

## Security Notes

✅ **Safe**: Credentials stored in `~/.mylogin.cnf` (encrypted, file-only readable by you)
✅ **Safe**: Alias is just a shortcut, no credentials in plain text
❌ **Not Safe**: Putting password in alias or environment variables

---

## Related Documentation

- `load-env.sh` — For syncing data (uses SPREADSHEET_ID and DATABASE_URL from Keychain + .env.local)
- `WORK_COMPLETED.md` — Phase 1 sync completion details
- `NEXT_SESSION.md` — Instructions for ongoing syncs
