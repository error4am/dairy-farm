# AGENTS.md — Dairy Farm Management System

Local-first dairy farm management app for a real single farm. **Feature freeze applies to
existing modules**: only bug fixes, data integrity, validation, UX corrections, security,
tests, performance, backup/restore and deployment work — except when a new module/phase is
explicitly approved (Feed & Inventory is the current approved phase).

## Repository layout

- `server/` — Express 4 + better-sqlite3 (Node 22), port 4000 by default
- `client/` — React 18 + Vite 6 + TypeScript (custom CSS design system, no UI library)
- `electron/` — Electron main process + minimal preload (packaging only)
- `electron-builder.yml` — NSIS packaging config
- Root npm workspaces: `server`, `client`. The parent folder contains unrelated WebGL demos — never touch them.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite (5173) + API (4000) with proxy — browser development |
| `npm test` | Full suite: 180 server + 5 client = 185 tests (SQLite mode) |
| `npm run build` | Production client build (`client/dist`) |
| `npm start` | Plain server (serves built client) |
| `npm run db:reset` | Deletes and re-seeds the DB at `DB_PATH` (stop the server first) |
| `npm run db:seed` | Apply migrations + seed farm/owner if missing |
| `npm run db:restore -w server -- <backup.db>` | Offline restore CLI (stop the app first) |
| `npm run electron:dev` | Build client + run Electron (needs `electron:rebuild` first) |
| `npm run electron:rebuild` | Rebuild native deps for Electron ABI |
| `npm run electron:dist` | Build NSIS installer into `release/` |

## Databases & backups

- Dev DB: `dairy/data/dairy.db`; manual-test DB: `dairy/data/dairy-manual-test.db`
- Select a DB with env vars (read at startup): `DB_PATH`, `BACKUP_DIR`, `PORT`, `HOST`
- **PostgreSQL mode**: set `DATABASE_URL` (e.g. `postgresql://user:pass@host:5432/db`) to run the
  online edition; leave it unset for SQLite. In `NODE_ENV=production` the app fails clearly at
  startup without `DATABASE_URL` or `DB_PATH`. `HOST` defaults to `127.0.0.1` locally and
  `0.0.0.0` in production. `FRONTEND_ORIGIN` (comma-separated) enables CORS for a separately
  hosted frontend; wildcard is never allowed. See `docs/DEPLOYMENT.md`.
- Manual-test session (the farm's working data right now):
  ```powershell
  $env:DB_PATH = "$PWD\data\dairy-manual-test.db"
  $env:BACKUP_DIR = "$PWD\data\backups\manual-test"
  npm start
  ```
- Production (Electron): `%APPDATA%\DairyFarmManager\data\dairy.db`, backups in
  `%APPDATA%\DairyFarmManager\backups\`, startup log `%APPDATA%\DairyFarmManager\startup.log`
- Automatic backup runs at startup, at most once per calendar day, keeps latest 30
  (`dairy-YYYY-MM-DD.db`); rotation never touches manual/safety backups. Manual download in Settings.
- Never commit databases, backups or `release/` — all gitignored. Never run restore tests against real data.

## Architecture conventions

- Layering: `routes → services → db adapter`. Business logic in services; routes are thin and
  wrapped in `asyncHandler`. Services are **async** (PostgreSQL is async); `server/db/index.js`
  is the data-access adapter (`all/get/run/exec/transaction/ping/now`), backed by
  `sqliteDriver` (better-sqlite3 behind an async facade + transaction mutex) or `pgDriver`
  (`pg` Pool, `?`→`$n` conversion, `RETURNING id`, AsyncLocalStorage transaction routing).
  `server/db/connection.js`, `backup.js`, `seed.js` and `migrate.js` remain SQLite-only and
  synchronous (Electron requires that contract).
- SQL must stay portable across SQLite and PostgreSQL: use `?` placeholders, `substr(...)`,
  `CAST(COUNT(*) AS INTEGER)`, `LOWER(...)`; never `COLLATE NOCASE`, `date(x)`,
  `datetime('now')` or `last_insert_rowid()`. Timestamps come from `db.now()`; unique/constraint
  errors are classified via `db.isUniqueViolation` / `db.isConstraintViolation`.
- Validation: `server/middleware/validate.js` is authoritative (strict Y-M-D calendar dates,
  enums, positive numbers, lengths, letters-only units). Frontend validation is UX only.
  Errors: `HttpError(status, message, details)`.
- All SQL parameterized; sort columns use whitelists. Multi-step writes use `db.transaction`.
- Migrations: `server/db/migrations/NNN_name.sql` (SQLite), applied in order, tracked in
  `schema_migrations`. Current: 001_init, 002_health, 003_breeding, 004_employees,
  005_transaction_link_indexes, 006_inventory, 007_auth, 008_milk_sales. PostgreSQL mirrors them 1:1 in
  `server/db/pg/migrations/` with the same names, applied automatically at startup by
  `server/db/pgInit.js` (run by `db.ready()`), followed by a farm/user seed when empty.
  PG keeps TEXT dates/timestamps, `INTEGER` 0/1 booleans and `SERIAL` ids (int4) so API
  output stays identical to SQLite. Never edit an applied migration; add a new one in both dirs.
- Linked records (single source of truth):
  - `health_records.transaction_id` → one Medicine expense; edit/clear/delete propagate.
  - `employee_payments.transaction_id` → one Labor expense; edit/delete propagate.
  - `inventory_movements.transaction_id` → one Feed expense (purchases only); edit/clear/delete propagate.
  - `milk_sales.transaction_id` → one Milk Sale income (category `milk_sale`); edit/delete propagate.
  - Finance **cannot** edit or delete linked transactions (409) — edit from the source module.
    The Finance UI shows a pencil link to the source instead of edit/delete.
- Withdrawal enforcement is server-side: milk create/edit blocked while `withdrawal_until >= milk date`.
  Never weaken.
- Deletion guards: animals blocked with milk/health/breeding/finance links (mark Sold/Deceased);
  employees blocked with payment history (mark Inactive); inventory items blocked with movements
  (mark inactive). Movement deletion is blocked if it would make stock negative.
- Frontend: `features/<module>/` pages + forms; shared `components/`; data via `useApi` +
  `DataContext.refresh()`; `EmptyState`, `ConfirmDialog`; pluralization via `lib/plural.js`.
- **Owner authentication** (one owner account, no registration/reset/OAuth/MFA):
  - `AUTH_ENABLED` defaults to **on when `DATABASE_URL` is set, off for SQLite/Electron**
    (override with `true`/`false`). Auth endpoints (`/api/auth/*`) exist in both modes;
    the protection gate does not. SQLite/desktop behaviour is unchanged by default.
  - Middleware order in `server/index.js`: json → cookie-parser → cors → `/api/health`
    (public) → PG readiness → CSRF (`/api`) → auth router (`/api/auth`) →
    `requireAuth` gate for all other `/api/*` when enabled → module routes.
  - Sessions are DB rows (`sessions` table): cookie `dairy_session` (HttpOnly, SameSite=Lax,
    Secure in production, TTL `SESSION_TTL_SECONDS`=7 days); the cookie holds a random
    base64url token, the row stores its SHA-256 — the raw token is never returned to JS.
  - CSRF: double-submit cookie `dairy_csrf` + `X-CSRF-Token` header (timing-safe compare,
    403); issued on auth GETs. Client sends it automatically from `client/src/lib/api.ts`
    and dispatches `dairy:unauthorized` on 401 (excluding `/auth/*`).
  - Passwords: **Argon2id** (`@node-rs/argon2`, memoryCost 19456 / timeCost 2 / p 1),
    dummy-hash verification equalizes unknown-email timing; generic 401 message for both
    wrong password and unknown email.
  - Login rate limit: in-memory per-IP (`LOGIN_MAX_ATTEMPTS`=10 per `LOGIN_WINDOW_MS`=15 min),
    429 before verification once the threshold is hit, counter resets on success/window.
    Per-process — resets on restart, per instance when scaled.
  - One-time setup (`POST /api/auth/setup`) adopts the seeded placeholder user (email NULL);
    duplicate setup → 409. Optional `SETUP_SECRET` gates setup (403 without it).
  - Frontend gate: `AuthProvider` (`client/src/lib/AuthContext.tsx`) wraps the app;
    `App.tsx` shows `SetupPage`/`LoginPage` (one-time / login) before `AppLayout` when
    enabled; `Topbar` shows the user name + Logout only when auth is enabled.

## Feed & Inventory module (Phase 3, current branch)

**Ledger is the source of truth.** There is no editable `current_stock` field anywhere;
`current_stock` is always `SUM(inventory_movements.quantity)`.

- **`inventory_items`**: farm_id, name (unique per farm), category (concentrate/silage/fodder/
  mineral/supply/other), unit, minimum_stock (nullable), active (0/1), notes, timestamps.
- **`inventory_movements`**: farm_id, item_id (RESTRICT), date, type, **signed quantity**
  (`<> 0`), unit, unit_cost, total_cost, supplier, notes, transaction_id, timestamps.
- **Sign convention (service-owned)**: opening/purchase `+`, consumption/waste `−`, adjustment
  `±` via an API `direction` field (`increase`/`decrease`); the client always sends a positive quantity.
- **Units**: each item defines its unit; every movement must use that unit (server rejects
  mismatches). Item form uses a unit dropdown (kg/bag/bale/L/ton/maund/quintal/Other…) and the
  server rejects units containing digits. No unit-conversion engine (by design).
- **Costs**: only purchase movements may carry `unit_cost`/`total_cost`; if total is omitted it is
  computed from unit cost × quantity. `total_cost > 0` creates exactly one linked expense
  (category `feed`, description `Purchase: <item> (<qty> <unit>) — <supplier>`).
- **Rules**: quantity > 0; adjustments require a note/reason; inactive items accept only
  adjustments; consumption/waste/negative adjustments cannot drive stock below zero (also on edit
  and delete); unknown/foreign items rejected; `farm_id` never trusted from the client.
- **Low stock**: `out` = current ≤ 0; `low` = 0 < current ≤ minimum_stock (active items only).
- **Opening stock UX**: the item form has an "Opening stock" field (shown for new items and for
  items with zero movements) which creates a real Opening Stock movement on save.
- **API**: `/api/inventory-items` (+ `/summary`, `/:id/profile`), `/api/inventory-movements`
  (filters: item_id/type/from/to/search/pagination). `/api/dashboard` exposes
  `metrics.inventory.{active_items, low_stock, out_of_stock}`.
- **UI**: sidebar **Inventory** (between Finances and Employees); list page (summary cards,
  filters, items table, recent movements) and item detail page (stat cards, stock breakdown,
  movement history with filters + pagination, Record Movement). Movement form has "Save & add another".

## Milk Sales & Price History module

Separate from Milk Production (no changes to `milk-records`). No `buyer` field (scope control).

- **`milk_prices`**: farm_id, price_per_litre (> 0), effective_date, created_at,
  `UNIQUE(farm_id, effective_date)`. History is listed latest-first; future dates are allowed
  (scheduled prices). Price resolution for a date: latest `effective_date <= date`, tie-break
  `id DESC`; none → `400 details.date = 'No milk price is set for this date. Add a price first.'`.
- **`milk_sales`**: farm_id, date, litres (> 0), price_per_litre (> 0), revenue (≥ 0), notes,
  `transaction_id → transactions ON DELETE SET NULL`, timestamps.
- **Server-authoritative pricing**: create always resolves the price from history for the sale
  date; a client-supplied `price_per_litre` in a sale body is validated (> 0) but **never used**
  as the effective price. `revenue = round2(litres × price)`; description
  `Milk sale: <litres> <unit> @ <price>/<unit>`.
- **Edit rule**: same date → keep the stored price (history edits/deletes never rewrite
  historical sales); date changed → resolve for the new date (400 if none). Update reuses the
  linked transaction (recreating it if it was manually deleted); delete removes sale + linked
  income in one transaction.
- Finance cannot edit/delete a linked sale income (409 `/milk sale/i`); the Finance UI pencil
  links to `/milk-sales` instead. Reuses the existing `milk_sale` income category.
- **API**: `/api/milk-sales` (`GET /`, `GET /summary`, POST, PUT, DELETE) and `/api/milk-prices`
  (`GET /`, `GET /applicable?date=`, POST, PUT, DELETE). `summary` returns `unit`, `currency`,
  `current_price`, `range {produced, sold, remaining, revenue, sales_count}` (produced from
  `milk_records`, sold from `milk_sales` — the two stay fully separate) and `today/week/month`.
  `/api/dashboard` exposes `metrics.milk_sales.{sold_today, revenue_today, sold_month, revenue_month}`.
- **UI**: sidebar **Milk Sales** → `/milk-sales` (cart icon): stat cards, period presets, sales
  table + pagination, price history card, `SaleForm`/`PriceForm` modals. The sale form shows the
  resolved price as read-only and disables save when no price applies to the date.
- Sale dates: server accepts any valid date (client caps at today); prices may be future-dated.

## Tests

- Server (`node --test`, temp DBs via `DB_PATH` set before requires): `api-consistency`,
  `calculations`, `health`, `breeding`, `employees`, `linked-transactions`, `input-hardening`,
  `inventory`, `milk-sales`, `backup-restore`, `backup-failures`, `server-bind`, `health-check`,
  `config`, `sql-dialect`, `pg-driver`, `pg-schema`, `pg-integration`, `pg-init`, `auth`.
  `auth.test.js` sets `AUTH_ENABLED=true` + `LOGIN_MAX_ATTEMPTS=5` before requires and
  covers setup/login/logout/me, generic 401s, Argon2id storage, session + CSRF cookies,
  401/403/429 paths, expired sessions, public health and protected farm workflows.
  `milk-sales.test.js` covers price history CRUD/resolution, server-authoritative revenue,
  exactly-one linked income, edit/delete propagation, production/sales separation, dashboard
  metrics, HTTP validation and orphan/duplicate integrity checks.
- Client: `client/tests/plural.test.js`.
- Never weaken/delete tests. Fix genuine defects and add a regression test.
- Expected: **180 server + 5 client = 185 passing, 0 failed, 0 skipped** (SQLite mode).
- PG coverage: `pg-schema` asserts table/column/FK/unique/index parity between the SQLite and
  PostgreSQL migrations; `pg-driver` verifies placeholder conversion, `RETURNING id`, error
  classification and transaction client pinning (mock pool); `pg-integration` runs real service
  flows on `pg-mem`. `pg-mem` lacks window functions and rollback semantics — `breeding.summary`
  and real rollback still need a live PostgreSQL check (docs/DEPLOYMENT.md step 12).

## Electron / packaging notes

- Electron **42.11.3** is pinned deliberately: better-sqlite3 12.11.1 has a win32-x64 prebuild only
  up to ABI 146 (Electron 42). Electron 44 needs ABI 149 (no prebuild) and this machine has no VS
  C++ toolchain.
- Native module ABI: repo `node_modules/better-sqlite3` is Node-ABI after `npm rebuild better-sqlite3`
  (needed for tests) and Electron-ABI after `npm run electron:rebuild` (needed for `electron:dev`).
  Stop any running server first (it locks the `.node` file).
- Run DB scripts under Electron's runtime when the repo is Electron-ABI:
  `$env:ELECTRON_RUN_AS_NODE='1'; & node_modules\electron\dist\electron.exe script.js`
- The installed app is on the older code (pre-Inventory) — rebuild/install to test new modules.
- No auto-update, no code signing (SmartScreen warning expected).
- **When the online-staging branch is merged into the Electron branch**, the Electron branch's
  root `package.json` dependencies must include `cors`, `cookie-parser` and
  `@node-rs/argon2` (the server now requires them) in addition to
  `better-sqlite3`/`express`. `pg` stays optional and is only loaded when `DATABASE_URL` is
  set. Auth stays disabled in SQLite/Electron mode by default (`AUTH_ENABLED` off without
  `DATABASE_URL`). The server contract Electron relies on is unchanged: synchronous
  `require('./index')`, `db/connection.js`, and `db/backup.js`.

## Git state

- `master` = validated baseline **96abcdc**, pushed.
- `feature/electron-packaging` = Electron packaging **449663b** + AGENTS.md **49a0806**, pushed.
  Electron is a preserved milestone/offline edition — do not delete it.
- `feature/feed-inventory` = **current branch**. Feed & Inventory is committed as **ed967ee**,
  the online staging work as **80c6e07** + **46d8c50**, owner authentication (Argon2id
  setup/login, sessions, CSRF, rate limit, 007_auth migrations, login/setup UI, tests, docs)
  as **34582f4**, and Milk Sales + Price History (008_milk_sales migrations, price/sale
  services + routes, UI, tests, docs) as the tip commit — all pushed. Do not commit/push
  further work without owner approval.
- SQLite + Electron remain the active local edition; the online/PostgreSQL path is now
  implemented for staging. Electron must keep working: `server/index.js` still exports the app
  synchronously, `db/connection.js` still exports a better-sqlite3 handle, and `db/backup.js`
  still runs synchronously.
- Commit style: `fix:`, `ui:`, `feat:`, `chore:` + concise body bullets.

## Known documented items (low severity, don't "fix" casually)

1. Milk page Today/This Week/This Month cards are farm-wide and ignore animal/session filters by design.
2. No upper bounds on quantity/amount/salary (Infinity rejected).
3. Non-numeric numeric filters (e.g. `?animal_id=abc`) are silently ignored (200, empty).
4. Future-dated milk is accepted by the API (UI date picker prevents it); period totals exclude future dates.
5. Milk totals sum across units if a record uses a unit different from the farm default.
6. Dashboard says "Total Revenue" while Finances says "Income" (intentional per original spec).
7. All inventory purchases post to the existing `feed` finance category; non-feed supplies
   (mineral/supply) may warrant a category split later.
8. PostgreSQL keeps dates/timestamps as TEXT and booleans as INTEGER 0/1 (intentional, to keep
   API responses byte-identical to SQLite); ids are `SERIAL` (int4) so `pg` returns numbers.
9. In PostgreSQL mode the Settings "Download Backup" card is hidden (`/api/meta` exposes
   `capabilities.backup`) and `/api/settings/backup` returns 501; SQLite backup/restore is
   desktop-edition only. No online backup feature yet.
10. Authentication is **online-only by default** (`AUTH_ENABLED` follows `DATABASE_URL`):
    SQLite/dev/Electron run with the gate off (endpoints still answer, e.g.
    `{auth_enabled:false}`), so tests and desktop behave as before. Set
    `AUTH_ENABLED=true` explicitly to protect a SQLite deployment.

## Future requirements (do NOT implement without approval)

Alerts (in-app, derived from existing data), Feed consumption prediction, Reports/exports,
Notifications (email/SMS/WhatsApp/push), Multi-farm SaaS, Mobile app/PWA, AI features,
online backup/restore, cloud sync, auto-updates.

## Environment gotchas (Windows PowerShell)

- Inline `node -e "..."` with quotes gets mangled by PowerShell — write a temp `.js` file and run it.
- `Start-Process` needs absolute paths for executables.
- Screenshots: headless Chrome with literal `--window-size=W,H` (variables don't pass through),
  `--user-data-dir=C:\Users\HP\AppData\Local\Temp\opencode\chrome-profile`.
- Temp helper scripts live in `C:\Users\HP\AppData\Local\Temp\opencode\`.
- To run the server against a specific DB, set `$env:DB_PATH`/`$env:BACKUP_DIR` in the same
  PowerShell session before `Start-Process node ...` (children inherit the session env).
