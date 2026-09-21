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
| `npm test` | Full suite: 112 server + 5 client = 117 tests |
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

- Layering: `routes → services → db`. Business logic in services; routes are thin.
- Validation: `server/middleware/validate.js` is authoritative (strict Y-M-D calendar dates,
  enums, positive numbers, lengths, letters-only units). Frontend validation is UX only.
  Errors: `HttpError(status, message, details)`.
- All SQL parameterized; sort columns use whitelists. Multi-step writes use `db.transaction`.
- Migrations: `server/db/migrations/NNN_name.sql`, applied in order, tracked in `schema_migrations`.
  Current: 001_init, 002_health, 003_breeding, 004_employees, 005_transaction_link_indexes, 006_inventory.
- Linked records (single source of truth):
  - `health_records.transaction_id` → one Medicine expense; edit/clear/delete propagate.
  - `employee_payments.transaction_id` → one Labor expense; edit/delete propagate.
  - `inventory_movements.transaction_id` → one Feed expense (purchases only); edit/clear/delete propagate.
  - Finance **cannot** edit or delete linked transactions (409) — edit from the source module.
    The Finance UI shows a pencil link to the source instead of edit/delete.
- Withdrawal enforcement is server-side: milk create/edit blocked while `withdrawal_until >= milk date`.
  Never weaken.
- Deletion guards: animals blocked with milk/health/breeding/finance links (mark Sold/Deceased);
  employees blocked with payment history (mark Inactive); inventory items blocked with movements
  (mark inactive). Movement deletion is blocked if it would make stock negative.
- Frontend: `features/<module>/` pages + forms; shared `components/`; data via `useApi` +
  `DataContext.refresh()`; `EmptyState`, `ConfirmDialog`; pluralization via `lib/plural.js`.

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

## Tests

- Server (`node --test`, temp DBs via `DB_PATH` set before requires): `api-consistency`,
  `calculations`, `health`, `breeding`, `employees`, `linked-transactions`, `input-hardening`,
  `inventory`, `backup-restore`, `backup-failures`, `server-bind`.
- Client: `client/tests/plural.test.js`.
- Never weaken/delete tests. Fix genuine defects and add a regression test.
- Expected: **117/117 passing, 0 failed, 0 skipped**.

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

## Git state

- `master` = validated baseline **96abcdc**, pushed.
- `feature/electron-packaging` = Electron packaging **449663b** + AGENTS.md **49a0806**, pushed.
  Electron is a preserved milestone/offline edition — do not delete it.
- `feature/feed-inventory` = **current branch**, Phase 3 Feed & Inventory (migration 006 + module).
  Work is **uncommitted** pending owner approval; do not commit/push without approval.
- An online/PostgreSQL migration plan was analysed but is **deferred**; the SQLite + Electron
  architecture remains active for functional phases.
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

## Future requirements (do NOT implement without approval)

Alerts (in-app, derived from existing data — next planned phase), PostgreSQL/online web migration
(plan exists, deferred), Feed consumption prediction, Reports/exports, Notifications (email/SMS/
WhatsApp/push), Authentication & multi-user, Multi-farm SaaS, Mobile app/PWA, AI features,
Milk Collection/Sales tracking, cloud sync, auto-updates.

## Environment gotchas (Windows PowerShell)

- Inline `node -e "..."` with quotes gets mangled by PowerShell — write a temp `.js` file and run it.
- `Start-Process` needs absolute paths for executables.
- Screenshots: headless Chrome with literal `--window-size=W,H` (variables don't pass through),
  `--user-data-dir=C:\Users\HP\AppData\Local\Temp\opencode\chrome-profile`.
- Temp helper scripts live in `C:\Users\HP\AppData\Local\Temp\opencode\`.
- To run the server against a specific DB, set `$env:DB_PATH`/`$env:BACKUP_DIR` in the same
  PowerShell session before `Start-Process node ...` (children inherit the session env).
