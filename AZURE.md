# Azure Resources — Trailhead

All resources live in the **`mmr-resources`** resource group under **Azure subscription 1**.

| Resource name | Type | Location |
|---|---|---|
| `mmr-webapp` | Static Web App | East US 2 |
| `mmr-mysql-v4` | Azure Database for MySQL | Sweden Central |
| `mmr-resources` | Resource group | — |
| `mmr` | Email Communication Service | — |
| `mmr-comm` | Communication Service | Global |
| `mmrunnersstorage` | Storage account | — |

**Key notes:**
- Database: `mmr-mysql-v4` in Sweden Central — use `mysql-mmr` alias for local CLI access
- Static web app: `mmr-webapp` deployed to East US 2 via GitHub Actions
- Blob/file storage: `mmrunnersstorage` — used for photo pipeline output and assets
- Email: `mmr` (Email Communication Service) + `mmr-comm` (Communication Service) handle transactional email
- **Always retrieve connection strings or keys from macOS Keychain — never hardcode**
