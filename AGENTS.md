# AGENTS.md — Dairy Farm Management System

Local-first dairy farm management app for a real single farm. **Feature freeze is active**:
only bug fixes, data integrity, validation, UX corrections, security, tests, performance,
backup/restore and deployment work. No new modules or features without explicit approval.

## Repository layout

- `server/` — Express 4 + better-sqlite3 (Node 22), port 4000 by default
- `client/` — React 18 + Vite 6 + TypeScript (custom CSS design system, no UI library)
- `electron/` — Electron main process + minimal preload (packaging only)
- `electron-builder.yml` — NSIS packaging config
- Root npm workspaces: `server`, `client`. Parent folder contains unrelated WebGL demos — never touch them.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite (5173) + API (4000) with proxy — browser development |
| `npm test` | Full suite: 90 server + 5 client = 95 tests |
| `npm run build` | Production client build (`client/dist`) |
| `npm start` | Plain server (serves built client) |
| `npm run db:reset` | Deletes and re-seeds the DB at `DB_PATH` (stop the server first) |
| `npm run db:seed` | Apply migrations + seed farm/owner if missing |
| `npm run db:restore -w server -- <backup.db>` | Offline restore CLI (stop the app first) |
| `npm run electron:dev` | Build client + run Electron (needs `electron:rebuild` first) |
| `npm run electron:rebuild` | Rebuild native deps for Electron ABI |
| `npm run electron:dist` | Build NSIS installer into `release/` |

## Databases & backups

- Dev DB: `dairy/data/dairy.db`; isolated manual-test DB: `dairy/data/dairy-manual-test.db`
- Select a DB with env vars (read at startup): `DB_PATH`, `BACKUP_DIR`, `PORT`, `HOST`
- Clean manual-test session:
  ```powershell
  $env:DB_PATH = "$PWD\data\dairy-manual-test.db"
  $env:BACKUP_DIR = "$PWD\data\backups\manual-test"
  npm start
  ```
- Production (Electron): `%APPDATA%\DairyFarmManager\data\dairy.db`, backups in `%APPDATA%\DairyFarmManager\backups\`, startup log `%APPDATA%\DairyFarmManager\startup.log`
- Automatic backup runs at startup, at most once per calendar day, keeps latest 30 (`dairy-YYYY-MM-DD.db`); rotation never touches manual/safety backups. Manual download: Settings → Download Backup.
- Never commit databases, backups or `release/` — all gitignored. Never run restore tests against real data.

## Architecture conventions

- Layering: `routes → services → db`. Business logic lives in services; routes are thin.
- Validation: `server/middleware/validate.js` is authoritative (strict Y-M-D calendar dates, enums,
  positive numbers, lengths). Frontend validation is UX only. Errors: `HttpError(status, message, details)`.
- All SQL is parameterized; sort columns use whitelists. Multi-step writes use `db.transaction`.
- Migrations: `server/db/migrations/NNN_name.sql`, applied in order, tracked in `schema_migrations`.
  Current: 001_init, 002_health, 003_breeding, 004_employees, 005_transaction_link_indexes.
- Linked records (single source of truth):
  - `health_records.transaction_id` → one Medicine expense; edit/clear/delete propagate.
  - `employee_payments.transaction_id` → one Labor expense; edit/delete propagate.
  - Finance **cannot** edit or delete linked transactions (409) — edit from the source module.
- Withdrawal enforcement is server-side: milk create/edit blocked while `withdrawal_until >= milk date`;
  UI disables the animal. Never weaken.
- Deletion guards: animals blocked when milk/health/breeding/finance links exist (mark Sold/Deceased);
  employees blocked with payment history (mark Inactive).
- Frontend: `features/<module>/` pages + forms; shared `components/`; data via `useApi` + `DataContext.refresh()`;
  empty states via `EmptyState`, destructive actions via `ConfirmDialog`; pluralization via `lib/plural.js`.

## Tests

- Server: `node --test` with temp DBs — each file sets `process.env.DB_PATH` before requiring modules.
  Files: `api-consistency`, `calculations`, `health`, `breeding`, `employees`, `linked-transactions`,
  `input-hardening`, `backup-restore`, `backup-failures`, `server-bind`.
- Client: `client/tests/plural.test.js` (`pluralize`, `formatCount`).
- Never weaken/delete tests. Fix genuine defects and add a regression test.

## Electron / packaging notes

- Electron **42.11.3** is pinned deliberately: better-sqlite3 12.11.1 has a win32-x64 prebuild only up to
  ABI 146 (Electron 42). Electron 44 needs ABI 149 (no prebuild) and this machine has no VS C++ toolchain.
- Native module ABI: repo `node_modules/better-sqlite3` is Node-ABI after `npm rebuild better-sqlite3`
  (needed for tests) and Electron-ABI after `npm run electron:rebuild` (needed for `electron:dev`).
  Rebuild accordingly; stop any running server first (it locks the .node file).
- Run DB scripts under Electron's runtime when the repo is Electron-ABI:
  `$env:ELECTRON_RUN_AS_NODE='1'; & node_modules\electron\dist\electron.exe script.js`
- Electron starts Express on a dynamic `127.0.0.1` port and serves the built React app; DB/backups come
  from `%APPDATA%\DairyFarmManager`; single-instance lock; graceful shutdown closes HTTP + SQLite.
- No auto-update, no code signing (SmartScreen warning is expected).

## Git state

- `master` = validated pre-Electron baseline (`96abcdc`), pushed.
- `feature/electron-packaging` = Electron packaging (`449663b`), pushed. Not merged to master yet.
- Commit messages: `fix:`, `ui:`, `feat:`, `chore:` + concise body bullets. Don't commit unless asked.

## Known documented items (low severity, not defects to fix casually)

1. Milk page Today/This Week/This Month cards are farm-wide and ignore animal/session filters by design.
2. No upper bounds on quantity/amount/salary (Infinity rejected).
3. Non-numeric numeric filters (e.g. `?animal_id=abc`) are silently ignored (200, empty).
4. Future-dated milk is accepted by the API (UI date picker prevents it); period totals exclude future dates.
5. Milk totals sum across units if a record uses a unit different from the farm default.
6. Dashboard says "Total Revenue" while Finances says "Income" (intentional per original spec).

## Future requirements (do NOT implement)

Feed inventory, Reports/exports, Notifications, Authentication, Multi-farm, Mobile app, AI features,
Milk Collection/Sales tracking, cloud sync, auto-updates.

## Environment gotchas (Windows PowerShell)

- Inline `node -e "..."` with quotes gets mangled by PowerShell — write a temp `.js` file and run it.
- `Start-Process` needs absolute paths for executables.
- Screenshots: headless Chrome with literal `--window-size=W,H` (variables don't pass through),
  `--user-data-dir=C:\Users\HP\AppData\Local\Temp\opencode\chrome-profile`.
- Temp helper scripts live in `C:\Users\HP\AppData\Local\Temp\opencode\`.
