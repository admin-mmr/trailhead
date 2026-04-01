# Deploy MMR Prototype HTML to Azure — Get a Live URL in 5 Minutes

This gets your `mmr_website_prototype.html` live on the internet under a free Azure URL.
You do NOT need to move mmrunners.org — the Azure URL is temporary for testing.

---

## What you'll use
- **Azure Blob Storage static website** (free tier, ~$0.01/month storage)
- No domain, no SSL cert needed — Azure provides `https://mmrstorage.z13.web.core.windows.net` automatically

---

## Step 1 — Open Azure Portal
Go to https://portal.azure.com and sign in with your Microsoft nonprofit account.

---

## Step 2 — Open your Storage Account
In the search bar at the top, type **"Storage accounts"** and click the result.
You should see **mmrstorage** (the one created earlier). Click it.

If you don't have one yet, click **+ Create** and use these settings:
- Resource group: mmr-resources
- Storage account name: mmrstorage (must be globally unique, all lowercase)
- Region: East US
- Performance: Standard
- Redundancy: LRS (cheapest)
Then click **Review + Create → Create**.

---

## Step 3 — Enable Static Website Hosting
Inside the mmrstorage account, look at the left sidebar.
Scroll down to **Data management** → click **Static website**.

Set these fields:
- Static website: **Enabled**
- Index document name: `index.html`
- Error document path: `index.html`

Click **Save**.

After saving, Azure shows you two URLs:
- **Primary endpoint** — this is your live URL, e.g.:
  `https://mmrstorage.z13.web.core.windows.net`
  Copy this URL — you'll use it to test the site.

---

## Step 4 — Upload the HTML File
Still in mmrstorage, look at the left sidebar → **Data storage** → **Containers**.
You'll see a container named **$web** — click it.

Click **Upload** at the top.
- Browse and select `mmr_website_prototype.html` from your computer.
- Before uploading, change the filename to `index.html` (click the pencil icon next to the filename in the upload dialog, or rename the file on your Mac first with Cmd+I).
- Click **Upload**.

---

## Step 5 — Open Your Live URL
Paste the Primary endpoint URL from Step 3 into any browser:

```
https://mmrstorage.z13.web.core.windows.net
```

Your prototype is now live! Share this URL with anyone for testing.

---

## Tips
- **To update the site**: just upload a new `index.html` to the $web container (it replaces the old one instantly).
- **Images / assets**: upload them to the same $web container and reference them with relative paths.
- **CORS for the webapp**: when you're ready to connect the Next.js app to Azure Blob Storage, add a CORS rule in the storage account under **Resource sharing (CORS)**.
- **Moving the domain later**: when mmrunners.org is ready to point here, add a custom domain under **Networking → Custom domain** in the storage account settings.

---

## Quick Alternative — Azure CLI (fastest, terminal only)

If you have the Azure CLI installed (`az --version`), you can do all of the above in two commands:

```bash
# Enable static website
az storage blob service-properties update \
  --account-name mmrstorage \
  --static-website \
  --index-document index.html \
  --404-document index.html

# Upload the file as index.html
az storage blob upload \
  --account-name mmrstorage \
  --container-name '$web' \
  --file ./mmr_website_prototype.html \
  --name index.html \
  --content-type 'text/html' \
  --overwrite

# Print the live URL
az storage account show \
  --name mmrstorage \
  --query "primaryEndpoints.web" \
  --output tsv
```

The last command prints your live URL directly in the terminal.
