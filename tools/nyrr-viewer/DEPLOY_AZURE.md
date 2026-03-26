# Deploying NYRR Data Viewer to Azure App Service

This guide covers deploying the NYRR Data Viewer Flask application to Azure App Service (Web App) with a MySQL Flexible Server backend.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Create Azure App Service](#create-azure-app-service)
3. [Configure Environment Variables](#configure-environment-variables)
4. [Set Up Google OAuth Credentials](#set-up-google-oauth-credentials)
5. [Configure Startup Command](#configure-startup-command)
6. [Deploy the Code](#deploy-the-code)
7. [Configure MySQL Firewall](#configure-mysql-firewall)
8. [Seed Admin Users](#seed-admin-users)
9. [Verify Deployment](#verify-deployment)
10. [Custom Domain (Optional)](#custom-domain-optional)
11. [Keep It Up to Date](#keep-it-up-to-date)

---

## Prerequisites

Before deploying, ensure you have:

1. **Azure CLI** installed and configured
   ```bash
   # Check if installed
   az --version

   # Log in if not already authenticated
   az login
   ```

2. **Python 3.11+** (for local testing, if desired)

3. **GitHub repository** with the full project structure (the app imports `nyrr_api.py` from `../../basecamp/python/`)

4. **Azure MySQL Flexible Server** already created
   - Server name: `mmr-mysql-v4.mysql.database.azure.com`
   - Database: `mmrdb` (or your custom name)
   - Admin credentials and root password ready

5. **Google OAuth credentials** (client ID and secret) from Google Cloud Console

---

## Create Azure App Service

### Step 1: Create a Resource Group

```bash
az group create \
  --name mmr-rg \
  --location eastus
```

Replace `mmr-rg` and `eastus` as needed for your region.

### Step 2: Create an App Service Plan

```bash
az appservice plan create \
  --name mmr-plan \
  --resource-group mmr-rg \
  --sku B2 \
  --is-linux
```

- Use `B1` for development (lower cost)
- Use `B2` or higher for production (more resources)
- `--is-linux` ensures Linux runtime (required for Python 3.11)

### Step 3: Create the Web App

```bash
az webapp create \
  --resource-group mmr-rg \
  --plan mmr-plan \
  --name mmr-nyrr-viewer \
  --runtime "PYTHON|3.11"
```

The app will be accessible at `https://mmr-nyrr-viewer.azurewebsites.net` once deployed.

---

## Configure Environment Variables

Set all required environment variables via the Azure CLI. These will be injected into the app at runtime.

### Update requirements.txt

First, add `gunicorn` to your `requirements.txt` (it's the production WSGI server):

```bash
# File: tools/nyrr-viewer/requirements.txt
flask>=3.0
mysql-connector-python>=8.0
requests>=2.31
authlib>=1.3
itsdangerous>=2.1
gunicorn>=21.0
```

### Set Environment Variables

```bash
az webapp config appsettings set \
  --resource-group mmr-rg \
  --name mmr-nyrr-viewer \
  --settings \
    "DATABASE_URL=mysql://mmradmin:YOUR_DB_PASSWORD@mmr-mysql-v4.mysql.database.azure.com:3306/mmrdb?ssl=true" \
    "SECRET_KEY=your-flask-session-secret-key-here" \
    "GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com" \
    "GOOGLE_CLIENT_SECRET=your-client-secret" \
    "OAUTH_REDIRECT_URI=https://mmr-nyrr-viewer.azurewebsites.net/auth/callback" \
    "DEV_BYPASS_AUTH=false" \
    "SCM_DO_BUILD_DURING_DEPLOYMENT=true" \
    "WEBSITES_PORT=8000"
```

**Important notes:**

- Replace `YOUR_DB_PASSWORD` with your actual MySQL admin password
- `SECRET_KEY` should be a cryptographically secure random string (use `python -c "import secrets; print(secrets.token_hex(32))"`)
- `OAUTH_REDIRECT_URI` must match exactly what's registered in Google Cloud Console (see next section)
- `DEV_BYPASS_AUTH=false` ensures authentication is enforced in production
- `SCM_DO_BUILD_DURING_DEPLOYMENT=true` runs `pip install` during deployment
- `WEBSITES_PORT=8000` tells Azure to expect the app on port 8000

---

## Set Up Google OAuth Credentials

### Step 1: Go to Google Cloud Console

1. Visit [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the **Google+ API**

### Step 2: Create OAuth 2.0 Credentials

1. Go to **APIs & Services > Credentials**
2. Click **Create Credentials > OAuth Client ID**
3. Select **Web application**
4. Add authorized redirect URIs:
   - `https://mmr-nyrr-viewer.azurewebsites.net/auth/callback` (production)
   - `http://localhost:5050/auth/callback` (for local testing)
5. Copy the **Client ID** and **Client Secret**

### Step 3: Update Azure Environment Variables

```bash
az webapp config appsettings set \
  --resource-group mmr-rg \
  --name mmr-nyrr-viewer \
  --settings \
    "GOOGLE_CLIENT_ID=YOUR_ACTUAL_CLIENT_ID.apps.googleusercontent.com" \
    "GOOGLE_CLIENT_SECRET=YOUR_ACTUAL_CLIENT_SECRET"
```

---

## Configure Startup Command

The Flask app is located in `tools/nyrr-viewer/`, not at the repository root. Azure App Service must `cd` into that directory before starting the app.

```bash
az webapp config set \
  --resource-group mmr-resources \
  --name mmr-nyrr-viewer \
  --startup-file "cd tools/nyrr-viewer && gunicorn --bind 0.0.0.0:8000 --workers 2 --timeout 120 app:app"
```

**Explanation:**

- `cd tools/nyrr-viewer` — Navigate to the app directory
- `gunicorn --bind 0.0.0.0:8000` — Bind the WSGI server to all interfaces on port 8000
- `--workers 2` — Use 2 worker processes (adjust based on plan size)
- `--timeout 120` — Allow 120 seconds for long-running requests (NYRR API calls)
- `app:app` — Load the `Flask` object named `app` from `app.py`

---

## Deploy the Code

Choose one of the following deployment methods:

### Option A: GitHub Actions (Recommended)

If your repository is connected to GitHub, use the Azure Deployment Center:

```bash
# View current deployment settings
az webapp deployment show-repo \
  --resource-group mmr-resources \
  --name mmr-nyrr-viewer
```

Then in the Azure Portal:
1. Go to **Deployment Center**
2. Select **GitHub** as the source
3. Authorize and select your repository
4. Set the branch to `main`
5. A GitHub Actions workflow will be created and triggered automatically

### Option B: Deploy from Local Machine (Quick Test)

Use `az webapp up` to deploy directly:

```bash
# From the repository root
az webapp up \
  --resource-group mmr-rrecourses \
  --name mmr-nyrr-viewer \
  --runtime PYTHON:3.11
```

### Option C: ZIP Deployment

Deploy a ZIP file of your code:

```bash
# From the repository root, create a ZIP file
zip -r ../nyrr-viewer.zip . -x "\.git/*" "\.env*" "venv/*"

# Deploy the ZIP
az webapp deployment source config-zip \
  --resource-group mmr-rg \
  --name mmr-nyrr-viewer \
  --src-path ../nyrr-viewer.zip
```

---

## Configure MySQL Firewall

The Azure MySQL server must allow outbound connections from the App Service. Azure App Services have dynamic outbound IP addresses, so you need to add firewall rules.

### Step 1: Get App Service Outbound IPs

```bash
az webapp show \
  --resource-group mmr-rg \
  --name mmr-nyrr-viewer \
  --query outboundIpAddresses \
  --output tsv
```

This returns a comma-separated list of IP addresses (typically 4–5 IPs).

### Step 2: Add Firewall Rules to MySQL Server

For each IP address from the previous step, add a firewall rule:

```bash
# Example: add the first IP
az mysql flexible-server firewall-rule create \
  --resource-group mmr-rg \
  --name mmr-mysql-v4 \
  --rule-name "AllowAppService-IP1" \
  --start-ip-address "203.0.113.1" \
  --end-ip-address "203.0.113.1"
```

Replace `203.0.113.1` with each actual IP address. You may also allow a broader range if your IPs are in a contiguous block:

```bash
az mysql flexible-server firewall-rule create \
  --resource-group mmr-rg \
  --name mmr-mysql-v4 \
  --rule-name "AllowAppServiceRange" \
  --start-ip-address "203.0.113.0" \
  --end-ip-address "203.0.113.255"
```

---

## Seed Admin Users

The app auto-creates the `viewer_admins` table and seeds the first admin. You may need to add your own admin account.

### Option 1: Auto-Seed (Built-in)

The Flask app checks for the `viewer_admins` table on startup and seeds `admin@mmrunners.org` if it doesn't exist (see `app.py`). Once you log in with Google OAuth using that email, you'll be marked as `super_admin`.

### Option 2: Manual Insert

If you need to add admins manually, connect to your MySQL database:

```bash
# Connect to Azure MySQL (from your local machine or a VM)
mysql -h mmr-mysql-v4.mysql.database.azure.com \
       -u mmradmin \
       -p \
       mmrdb

# Inside MySQL:
INSERT INTO viewer_admins (email, role)
VALUES ('you@mmrunners.org', 'super_admin');
```

---

## Verify Deployment

### Step 1: Check App Status

```bash
az webapp show \
  --resource-group mmr-rg \
  --name mmr-nyrr-viewer \
  --query "state"
```

Expected output: `"Running"`

### Step 2: Health Check

Visit the health endpoint in your browser or curl:

```bash
curl https://mmr-nyrr-viewer.azurewebsites.net/api/health
```

Expected response:
```json
{"ok": true}
```

### Step 3: View Logs

Stream live logs from the app:

```bash
az webapp log tail \
  --resource-group mmr-rg \
  --name mmr-nyrr-viewer
```

Look for startup messages and any errors during initialization.

### Step 4: Test the UI

Visit `https://mmr-nyrr-viewer.azurewebsites.net` in your browser. You should see the NYRR Data Viewer interface. If you get a connection error, check:

1. **Database firewall rules** — Ensure App Service IPs are allowed
2. **Environment variables** — Verify `DATABASE_URL` and credentials
3. **Logs** — Check `az webapp log tail` for error messages

---

## Custom Domain (Optional)

If you want to serve the app from a custom subdomain like `nyrr.mmrunners.org`:

### Step 1: Add DNS Record

In your domain registrar (e.g., Route53, GoDaddy), add a CNAME record:

```
Name: nyrr
Type: CNAME
Value: mmr-nyrr-viewer.azurewebsites.net
```

### Step 2: Add Custom Domain to App Service

```bash
az webapp config hostname add \
  --resource-group mmr-rg \
  --webapp-name mmr-nyrr-viewer \
  --hostname nyrr.mmrunners.org
```

### Step 3: Enable HTTPS

Azure will automatically validate DNS and provision an SSL certificate. Wait ~5–10 minutes, then verify:

```bash
az webapp config hostname list \
  --resource-group mmr-rg \
  --webapp-name mmr-nyrr-viewer
```

### Step 4: Enforce HTTPS

```bash
az webapp update \
  --resource-group mmr-rg \
  --name mmr-nyrr-viewer \
  --set httpsOnly=true
```

---

## Keep It Up to Date

### GitHub Actions Workflow

Create a workflow file at `.github/workflows/deploy.yml`:

```yaml
name: Deploy to Azure App Service

on:
  push:
    branches:
      - main

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v3

      - name: Deploy to Azure Web App
        uses: azure/webapps-deploy@v2
        with:
          app-name: mmr-nyrr-viewer
          publish-profile: ${{ secrets.AZURE_WEBAPP_PUBLISH_PROFILE }}
          package: .
```

### Set the Publish Profile Secret

1. In the Azure Portal, go to the App Service
2. Download the **Publish Profile** (top-right menu)
3. In your GitHub repository, go to **Settings > Secrets and variables > Actions**
4. Add a new secret named `AZURE_WEBAPP_PUBLISH_PROFILE` and paste the profile contents

Now every push to `main` will automatically deploy the app.

### Manual Redeployment

If you need to redeploy without pushing code:

```bash
az webapp up \
  --resource-group mmr-rg \
  --name mmr-nyrr-viewer
```

---

## Troubleshooting

### App Fails to Start

Check the logs:
```bash
az webapp log tail --resource-group mmr-rg --name mmr-nyrr-viewer
```

Common issues:
- **Import error on `nyrr_api.py`** — Ensure the full repo is deployed, not just `tools/nyrr-viewer/`
- **Database connection error** — Check firewall rules and `DATABASE_URL` format
- **Missing dependencies** — Verify all packages are in `requirements.txt`, including `gunicorn`

### Database Firewall Issues

If the app cannot connect to MySQL:

```bash
# List current firewall rules
az mysql flexible-server firewall-rule list \
  --resource-group mmr-rg \
  --name mmr-mysql-v4

# Add a broader rule if needed (less secure, for testing)
az mysql flexible-server firewall-rule create \
  --resource-group mmr-rg \
  --name mmr-mysql-v4 \
  --rule-name "AllowAllAzureIps" \
  --start-ip-address "0.0.0.0" \
  --end-ip-address "255.255.255.255"
```

### Slow NYRR API Calls

If requests to `/api/load/<event_id>` time out:

1. Increase the App Service timeout in Gunicorn:
   ```bash
   az webapp config set \
     --resource-group mmr-rg \
     --name mmr-nyrr-viewer \
     --startup-file "cd tools/nyrr-viewer && gunicorn --bind 0.0.0.0:8000 --workers 2 --timeout 300 app:app"
   ```

2. Consider upgrading the App Service Plan to `B2` or higher for more CPU/memory

---

## Summary

Your NYRR Data Viewer is now deployed to Azure App Service and ready to use. Key takeaways:

- All configuration is via environment variables (no hardcoded secrets)
- The app automatically imports `nyrr_api.py` from the shared basecamp folder
- MySQL firewall must be updated for the App Service outbound IPs
- Use GitHub Actions for automated deployments on every push
- Monitor logs with `az webapp log tail` for debugging

For questions or updates, refer to the [Azure App Service documentation](https://learn.microsoft.com/en-us/azure/app-service/).
