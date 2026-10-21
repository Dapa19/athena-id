# Athena.id

Athena.id is a local-first growth analytics workspace for beauty clinics. It connects manually recorded campaigns, leads, branches, follow-ups, and transactions. It does not replace clinic software, POS, or medical records.

## Requirements

- Node.js 20.19+ (Node 22 LTS or newer is recommended)
- npm 10+

## Run locally

```sh
npm install
cp .env.example .env
npm run dev
```

Open <http://127.0.0.1:5173>. Vite proxies `/api` requests to the Express service at <http://127.0.0.1:4000>. The first development startup initializes `server/data/athena.sqlite` and adds a repeatable synthetic workspace. No external service credentials are required.

Development sign-in:

- Email: `owner@athena.id`
- Password: `athena-demo-2026`

These demo credentials and records are created only when `NODE_ENV` is not `production` and `SEED_DEMO_DATA` is not `false`. Change `DEMO_EMAIL` or `DEMO_PASSWORD` in `.env` before seeding if needed. The seed is idempotent. `npm run seed` runs it explicitly in development.

## Environment

Copy `.env.example` to `.env` and set values for your environment.

| Variable | Purpose |
| --- | --- |
| `NODE_ENV` | Set to `production` to disable development seed data and enable secure cookies. |
| `PORT` | Express API port. Defaults to `4000`. |
| `DATABASE_PATH` | SQLite file, relative to the repository root unless absolute. Defaults to `server/data/athena.sqlite`. |
| `DEMO_EMAIL` | Development seed account email. |
| `DEMO_PASSWORD` | Development seed account password. |
| `SEED_DEMO_DATA` | Set to `false` to disable the development seed. |
| `BOOTSTRAP_*` | One-time production organization/Owner/Admin fields used by the explicit bootstrap command. |

The app uses same-origin JSON requests and does not enable cross-origin API access. In production, terminate HTTPS at a trusted reverse proxy, serve the built client and API on one origin, keep the SQLite file outside public directories, and set `NODE_ENV=production`. The session cookie is HttpOnly, SameSite=Lax, and Secure in production.

For an empty production database, first set `DATABASE_PATH` and `NODE_ENV=production`, provide `BOOTSTRAP_ORG_NAME`, `BOOTSTRAP_OWNER_NAME`, `BOOTSTRAP_OWNER_EMAIL`, and a `BOOTSTRAP_OWNER_PASSWORD` of at least 12 characters through a secure temporary environment, then run `npm run bootstrap` once. The command refuses to run outside production or against a database that already contains an organization. Remove the bootstrap password from the environment after setup. Production startup does not seed demo records or demo credentials.

## Commands

```sh
npm run dev       # Run Vite and Express together
npm run build     # Build the React client into client/dist
npm test          # Backend formula and API tests
npm run seed      # Repeat the development-only demo seed
npm run bootstrap # Create the first production owner in an empty database
```

For two-terminal development, use `npm run dev --workspace=server` and `npm run dev --workspace=client`.

## Product behavior and metric definitions

- **Campaign budget** is the sum of planned budgets for campaigns whose date ranges overlap the selected dashboard dates.
- **Recorded spend** sums the actual spend entered on those overlapping campaigns. Spend is stored as a campaign total and is not apportioned by day, so a shorter dashboard range does not imply period-level spend.
- **Attributed revenue** sums Paid transactions directly linked to a campaign and dated within the selected period. Refunded and Cancelled transactions are excluded. A transaction is not attributed solely because its lead has a campaign.
- **Leads** are distinct active leads created within the selected date range and branch filter.
- **Lead-to-purchase conversion** is distinct leads in that creation cohort with at least one linked Paid transaction divided by distinct leads in the cohort. The purchase may occur after the cohort dates.
- The dashboard pipeline shows each cohort lead’s current status. Show rate counts status-history transitions into Booked during the selected range and whether their next recorded booking outcome is Attended; it stays unavailable without booking history.
- A paid transaction linked to a lead moves the lead to Purchased and writes a lead activity record. Refunding a transaction does not erase that historical purchase status.
- Partial refunds are not supported. Set a transaction to Refunded to exclude its full amount from attributed revenue.
- WhatsApp links open a prefilled message only when the team has recorded both a phone number and authorization. Athena.id never sends a message.

## CSV import and export

Owner/Admin and Manager users can import leads or transactions from UTF-8 CSV files up to 1 MB and 2,000 data rows. The guided flow uploads text for preview, lets users map columns, validates rows and likely duplicates, and inserts only after confirmation. Invalid rows are skipped when valid rows are imported. Duplicate candidates require an explicit confirmation. The uploaded file is not persisted.

Leads and transactions can be exported with their active list filters. Campaign performance export is available to Owner/Admin and Manager users. CSV exports contain contact details for leads; store and share exports with the same care as the workspace data.

## Roles

- **Owner/Admin:** manage organization settings and team; full campaign, branch, lead, and transaction access.
- **Manager:** manage campaigns and branches; create, update, archive leads; record transactions; import and export.
- **Staff:** view campaigns and branches; create and update leads; work follow-ups; record and edit transactions.

All API queries scope tenant-owned records by the organization attached to the authenticated server-side session. The browser never supplies an organization ID for authorization.

## Database backup, restore, and deletion

The SQLite database is ignored by Git and stored under `server/data` by default. Stop the server before making a simple file copy:

```sh
cp server/data/athena.sqlite /path/to/secure-backups/athena-$(date +%F).sqlite
```

Restore by stopping the app, copying the chosen backup to the configured `DATABASE_PATH`, and restarting. Keep backups access-controlled and set a retention period. For local deletion, stop the app, remove the configured database file and its SQLite `-wal` / `-shm` sidecars if present, and securely remove any backups according to the clinic’s retention policy. This MVP has no in-app organization-wide deletion control.

## Security and limitations

- Passwords use bcrypt hashing. Sessions are opaque random tokens whose hashes are stored in SQLite, expire after eight hours, and are cleared on logout. Login attempts are rate-limited.
- Express Helmet security headers are enabled. Request validation, parameterized SQL, tenant scoping, and role checks are enforced in the API.
- Lead records intentionally exclude health information, diagnoses, prescriptions, treatment notes, and clinical photos. Do not put clinical details in operational notes.
- This MVP has no email invitations, SMS/WhatsApp API, ad-platform connections, payment processing, billing, or clinic/POS integration. Admin-created users receive a password chosen at account creation; share it through a secure channel.
- The application does not claim legal compliance. Before production use, review applicable Indonesian personal-data, electronic-system, and healthcare obligations with qualified counsel, and set up HTTPS, secret/backup management, monitoring, retention, and an operational deletion process.
