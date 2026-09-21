# Dairy Farm Manager — Online Staging Deployment Guide

This guide covers the online (PostgreSQL + Render) staging deployment. The local
SQLite/Electron edition is unchanged and keeps working when `DATABASE_URL` is not set.

## Architecture

```
React (Vite build)  ->  Express API  ->  PostgreSQL
```

- One Express server serves both `/api/*` and the built React app (`client/dist`) by default.
- `DATABASE_URL` selects PostgreSQL mode. Without it the server runs the local SQLite edition.
- The SQLite database file is never used for online data. Render's ephemeral disk is only
  used for temporary files.

## 1. Create the PostgreSQL database

Recommended for staging: a Render PostgreSQL instance (same region as the web service).

1. Render dashboard -> **New +** -> **PostgreSQL**.
2. Choose a name (e.g. `dairy-farm-db`), region, and the free/starter plan.
3. Create it and wait until status is **Available**.

Neon/Supabase also work: create a project/database and copy its connection string.

## 2. Obtain `DATABASE_URL`

- Render: open the database -> **Connections** -> copy the **External Database URL**
  (for local testing) or the **Internal Database URL** (for a Render web service in the
  same region).
- It looks like `postgresql://user:password@host:5432/dbname`.
- If the provider requires SSL (Neon, Supabase, Render external URLs), append
  `?sslmode=require` to the URL.
- Never commit this value. Store it only in the Render dashboard / local environment.

## 3. Configure the Render backend

Either apply `render.yaml` (Render dashboard -> **New +** -> **Blueprint**) or create the
service manually:

| Setting | Value |
|---|---|
| Type | Web Service |
| Runtime | Node |
| Build command | `npm install && npm run build` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Environment | `NODE_ENV=production`, `DATABASE_URL=<from step 2>` |

`PORT` is provided by Render and read automatically. `HOST` defaults to `0.0.0.0` when
`NODE_ENV=production`, so no `HOST` variable is needed on Render.

On startup the server automatically applies the PostgreSQL migrations
(`server/db/pg/migrations/`) and seeds the default farm/owner if the database is empty.
Migrations are tracked in `schema_migrations` and are safe to re-run.

## 4. Build command

```
npm install && npm run build
```

`npm run build` runs `tsc --noEmit && vite build` and outputs `client/dist`, which the
Express server serves.

## 5. Start command

```
npm start
```

This runs `node index.js` in `server/` (workspace script). The server:
- connects to PostgreSQL (`DATABASE_URL`),
- applies migrations + seed,
- listens on `0.0.0.0:$PORT`,
- serves the API and the built frontend,
- skips SQLite backups (they are desktop-edition only).

## 6. Required environment variables

| Variable | Required | Notes |
|---|---|---|
| `DATABASE_URL` | Yes (online) | PostgreSQL connection string |
| `NODE_ENV` | Recommended | `production` on Render |
| `PORT` | Render provides | Do not hardcode |
| `HOST` | Optional | Defaults to `0.0.0.0` in production |
| `FRONTEND_ORIGIN` | Only for split hosting | Comma-separated allowed origins |
| `DB_PATH` / `BACKUP_DIR` | Local edition only | Ignored in PostgreSQL mode |

In `production` mode the app fails clearly at startup if neither `DATABASE_URL` nor
`DB_PATH` is set.

## 7. Health check URL

```
https://<your-service>.onrender.com/api/health
```

Healthy response (HTTP 200):

```json
{ "status": "ok", "database": "ok" }
```

If the database is unreachable the endpoint returns HTTP 503 with
`{ "status": "error", "database": "error" }` and no internal details.

## 8. Frontend deployment

**Recommended (single service):** keep the default. The Express server serves the built
React app, the frontend uses relative `/api/...` calls, and no CORS configuration is needed.

**Separate static site (optional):** create a Render Static Site:

| Setting | Value |
|---|---|
| Build command | `npm install && npm run build -w client` |
| Publish directory | `client/dist` |
| Env var | `VITE_API_BASE_URL=https://<your-api>.onrender.com` |

`VITE_API_BASE_URL` is baked in at build time. If it is unset the frontend keeps using
same-origin relative `/api` calls (no hardcoded localhost anywhere).

## 9. Configure `FRONTEND_ORIGIN`

Only needed when the frontend runs on a different origin than the API:

```
FRONTEND_ORIGIN=https://dairy-farm-frontend.onrender.com
```

- Comma-separated list is supported for multiple origins.
- Wildcards are never used. Requests from unlisted origins receive no CORS headers.
- Credentials are enabled so secure-cookie authentication can be added later.
- In development, `http://localhost:5173` and `http://127.0.0.1:5173` are allowed
  automatically.

## 10. Verify the deployed application

1. `GET /api/health` returns `{"status":"ok","database":"ok"}`.
2. Open the frontend URL: the dashboard loads with the seeded farm.
3. Create an animal, then a milk record.
4. Add a health record with a cost and confirm exactly one Medicine expense appears in Finances.
5. Add an employee and a payment, then confirm exactly one Labor expense.
6. Create an inventory item with opening stock, record a purchase with a total cost, and confirm:
   - the linked Feed expense appears exactly once in Finances,
   - editing the purchase updates the expense instead of duplicating it,
   - stock is derived from the movement ledger,
   - consumption cannot drive stock negative.
7. Confirm Settings shows no "Download Backup" card in online mode (backups are desktop-only).
8. Restart the service (Render -> Manual Deploy) and confirm data persists.
9. Redeploy/restart twice and confirm migrations are not re-applied (`schema_migrations`).

## 11. Local PostgreSQL verification (optional but recommended)

Until this has been run against a real PostgreSQL server, treat the PostgreSQL path as
staging-untested:

```powershell
$env:DATABASE_URL = "postgresql://user:password@localhost:5432/dairy_staging"
$env:NODE_ENV = "production"
npm start
```

Then run the verification checklist from step 10. A disposable database is best.

## Remaining blockers / risks

1. **Real PostgreSQL has not been executed in automated tests.** The automated suite runs
   the full application on SQLite and the data-access layer + schema against an in-memory
   PostgreSQL emulator (`pg-mem`). `pg-mem` does not implement window functions or
   transaction rollback, so `breedingService.summary()`/dashboard breeding metrics and real
   rollback behaviour must be verified against a real PostgreSQL database (step 11).
2. **No authentication yet.** The staging API is open to anyone with the URL. Do not put
   real farm data online until authentication is implemented (planned next phases).
3. **Single farm only.** `FARM_ID` is fixed to 1; there is no multi-farm support yet.
4. **Backups are desktop-only.** PostgreSQL backups must be handled by the managed provider
   (Render/Neon snapshots) until an online backup feature is built.
5. **Better-sqlite3 native module** is still installed for the desktop edition. Online mode
   does not load it at startup, but `npm install` must succeed on the host.
6. **Staging secrets** must be set in the Render dashboard, never committed. `.env` files
   are gitignored; `.env.example` documents the variables only.
