# Lead Follow-Up Companion

A private, single-user follow-up system for RV dealership leads. It runs in a
browser tab beside the dealership CRM and exists to answer one question:
**what am I about to forget?**

It does not replace, modify, scrape or automate the dealership CRM. Information
gets in by pasting a screenshot; everything else is a personal layer on top.

## The rule the app enforces

Every active customer must be in one of these states:

1. Follow-up scheduled
2. Waiting for customer, with a future timeout
3. Appointment scheduled
4. Sold
5. Lost
6. Do not contact
7. Archived

An active customer in none of those states appears at the top of the dashboard
in the **No next action** queue. That queue is the product.

## Status: Phase 4 — final build

The application is feature-complete: manual tracking, screenshot OCR, reminders,
WhatsApp text and voice commands, backup/recovery, privacy cleanup and
operational diagnostics.

**New in Phase 4:**

- WhatsApp voice-note intake with sender/signature/idempotency checks before
  media download
- MIME/signature/size/duration validation and server-only transcription
- Demo voice scenarios, safe retries, clarification through normal text replies
- Successful audio deletion by default and temporary failed-audio retention
- JSON backup, customer CSV, restore dry run and conservative additive restore
- Privacy cleanup, delete-all-data control and operational diagnostics
- CSP/security headers and an explicit PWA update notice to prevent stale shells

Guides:

- [Deployment guide](./DEPLOYMENT_GUIDE.md)
- [Meta WhatsApp setup](./META_WHATSAPP_SETUP.md)
- [Supabase setup](./SUPABASE_SETUP.md)

**New in Phase 3:**

- **Screenshot intake** — Ctrl+V paste, drag-drop or file picker; PNG, JPEG and
  WEBP validated by magic bytes; SHA-256 duplicate detection; preview, progress,
  cancel and retry
- **On-device OCR** with Tesseract.js — free, and the image never leaves the
  device. A deterministic fixture provider backs demo mode and CI
- **A deterministic decision engine** returning one of seven outcomes, so clear
  screenshots import automatically and only genuine ambiguity reaches a person
- **Needs Review queue** with inline OCR correction
- **Automatic follow-up creation** on import, respecting the one-open-follow-up
  rule
- **Reminder engine** — due-now, overdue, waiting deadline, appointment, morning
  digest and end-of-day digest, dispatched by a Cloudflare Worker on a cron
- **Notification idempotency** via an atomic claim, so concurrent runs and
  scheduler retries cannot send twice
- **WhatsApp Cloud API** provider with webhook verification, signature
  validation, delivery/read/failure events and duplicate protection
- **Natural-language text commands**, quick replies, queries and clarification
  sessions
- **Measured cost tracking** with a projected annual figure and a warning
  threshold

## Phase 2

The manual lead tracker is complete and usable, in demo mode and against
Supabase, before screenshot OCR or WhatsApp exist.

**Built:**

- React 19 + TypeScript + Vite + Tailwind CSS 4, installable as a PWA
- Supabase authentication with protected routes
- Database schema: 12 tables, 3 views, Row Level Security on every user-owned
  table, plus transactional follow-up functions
- **Dashboard** with eight queues: action required now, overdue, due today, due
  tomorrow, waiting for customer, no next action, upcoming appointments and
  recently added
- **Customers**: create, edit, archive, restore, delete, search across nine
  fields, nine filters, and conservative duplicate warnings that never merge
- **Customer detail**: contact coverage, activity timeline with corrections and
  an audit trail, follow-up history, vehicle interests, structured notes
- **Activities**: fifteen types, eleven outcomes, quick actions that log and
  schedule in one click
- **Follow-up engine**: presets, per-outcome defaults, and transactional
  replacement that never discards the previous commitment
- **Waiting for customer** with an enforced response deadline
- **Settings** stored per user: time zone, morning and afternoon times, and a
  follow-up interval for each outcome
- 165 unit tests, 26 database assertions, 14 Playwright tests

**Deliberately not built yet:** screenshot extraction, a live WhatsApp
connection, voice transcription, and the background scheduler. Waiting deadlines
are evaluated whenever the workspace loads instead; Phase 3 will call the same
function from a schedule.

---

## Running it locally

### Requirements

- Node.js 20.19+ or 22.12+ (developed on 22.14)
- npm 10+
- A Supabase account — free tier (optional to start; see demo mode below)

### 1. Install

```bash
git clone <your-repo-url>
cd lead-follow-up-companion
npm install
```

### 2. Start it

```bash
npm run dev
```

Open http://localhost:5173.

**With no configuration at all, the app boots in demo mode** against fictional
fixtures, and the whole tracker works: create customers, log activities,
schedule and complete follow-ups, mark someone waiting, search and filter.

Demo records are stored in this browser's localStorage only. They are never
synchronized, never sent anywhere, and never mixed with Supabase records — the
two backends are selected exclusively. An amber banner says so on every page,
and Settings has a **Reset demo data** button that reloads the original
fixtures.

Demo mode is on whenever `VITE_SUPABASE_URL` is empty, or when
`VITE_DEMO_MODE=true`.

### 3. Connect your own Supabase project

```bash
cp .env.example .env
```

Fill in `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, then follow the
Supabase setup below. Restart `npm run dev` after editing `.env` — Vite reads
environment variables at startup.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload on port 5173 |
| `npm run build` | Type-check and produce a production build in `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | oxlint across the project |
| `npm run typecheck` | TypeScript project references, no emit |
| `npm test` | Vitest unit and component tests |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright smoke tests against the production build |
| `npm run test:db` | Replay migrations and SQL tests against a local PostgreSQL |
| `npm run verify` | lint + typecheck + test + build, in that order |
| `npm run generate:icons` | Re-render the PWA icons from `public/favicon.svg` |

First Playwright run only: `npx playwright install --with-deps chromium`.

`npm run test:db` needs a local PostgreSQL server. On a machine where postgres
runs as the `postgres` system user: `PG_SUPERUSER=postgres npm run test:db`.

---

## What to create in Supabase

Everything below is on the **Free** plan. Nothing here costs money.

### 1. Create the project

1. Go to [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**
2. Name it anything; **Lead Follow-Up Companion** is fine
3. Choose the region closest to you (lower latency, and egress stays free)
4. Set a strong database password and save it in a password manager — it is
   shown once, and you need it for the CLI
5. Plan: **Free**

Provisioning takes a couple of minutes.

### 2. Copy the two client values

**Project Settings → API**

| Value | Environment variable |
| --- | --- |
| Project URL | `VITE_SUPABASE_URL` |
| Project API keys → `anon` / `public` | `VITE_SUPABASE_ANON_KEY` |

The `anon` key is safe in the browser. It grants nothing that Row Level Security
does not allow.

**Do not copy the `service_role` key into this project.** It bypasses RLS
entirely. It belongs only in Edge Function secrets, in a later phase.

### 3. Apply the migrations

Either route works; the CLI is easier to repeat.

**With the Supabase CLI (recommended)**

```bash
npm install -D supabase          # or: brew install supabase/tap/supabase
npx supabase login
npx supabase link --project-ref <your-project-ref>
npx supabase db push
```

The project ref is the subdomain in your project URL:
`https://<project-ref>.supabase.co`.

**Through the dashboard**

Open **SQL Editor** and run each file in `supabase/migrations/` once, in
filename order:

1. `20260805000100_enums_and_helpers.sql` — enums, normalization functions
2. `20260805000200_core_tables.sql` — profiles, customers, contact methods,
   vehicle interests, activities, follow-ups
3. `20260805000300_intake_and_messaging_tables.sql` — screenshots, extraction
   fields, inbound commands, match candidates, notification log, audit log
4. `20260805000400_row_level_security.sql` — RLS policies and grants
5. `20260805000500_views.sql` — the derived read models
6. `20260806000100_phase2_manual_tracker.sql` — Phase 2 columns, per-user
   scheduling settings, and the transactional follow-up functions
7. `20260807000100_phase3_intake_and_reminders.sql` — screenshot decisions,
   notification staging and the atomic claim, clarification sessions, usage
   metering, and the reminder settings

### 4. Create your user account

There is no sign-up form. This is a single-user app, so the one account is made
by hand and public registration stays off.

1. **Authentication → Users → Add user → Create new user**
2. Enter your email and a strong password
3. Tick **Auto Confirm User** so no confirmation email is needed

Then close the door behind you:

4. **Authentication → Providers → Email** — turn **Enable sign-ups** off
5. Leave **Confirm email** on

### 5. Load the fictional seed data (optional)

Useful for seeing the dashboard populated before you enter real customers.

**SQL Editor** → paste the contents of `supabase/seed.sql` → Run. It defines a
function and then seeds the first user it finds. To target a specific user:

```sql
select public.seed_demo_data('<your-auth-user-id>');
```

It is re-runnable: it replaces rows tagged `source = 'seed'` and leaves your real
data alone. Two seeded customers deliberately have no follow-up, so the
no-next-action queue has something to show.

### 6. Sign in

Restart the dev server and sign in with the account you created. The demo-mode
banner disappears once Supabase is configured.

### What you do *not* need to create

- No storage buckets — screenshots are discarded after extraction by default
- No Supabase Edge Functions — the scheduler and webhook run on a Cloudflare
  Worker instead
- No extensions beyond `pgcrypto`

---

## Setting up WhatsApp

WhatsApp is optional to *run* the app — the dashboard works without it — but it
is the core feature, so this is the full path.

### 1. Create the Meta app

1. Go to [developers.facebook.com](https://developers.facebook.com) → **My Apps**
   → **Create App** → **Business**
2. Add the **WhatsApp** product
3. Under **WhatsApp → API Setup**, note the **Phone number ID** and the
   **WhatsApp Business Account ID**
4. Add your own mobile number as a **recipient**. This is the only number the app
   will ever message

The test number Meta provides is enough for personal use and costs nothing to
set up.

### 2. Create a permanent access token

The 24-hour token on the API Setup page expires. For the scheduler you need a
system user token:

1. [business.facebook.com](https://business.facebook.com) → **Business settings**
   → **Users → System users** → **Add**
2. Give it the **whatsapp_business_messaging** and
   **whatsapp_business_management** permissions on your WhatsApp app
3. **Generate new token**, choose **Never expires**, and copy it once

### 3. Deploy the Worker

```bash
npx wrangler login
npx wrangler deploy
```

Then set each secret (never in `wrangler.toml`, never in `.env`):

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npx wrangler secret put WHATSAPP_BUSINESS_ACCOUNT_ID
npx wrangler secret put WHATSAPP_APPROVED_NUMBER      # e.g. +15125550147
npx wrangler secret put WHATSAPP_WEBHOOK_VERIFY_TOKEN # any random string you invent
npx wrangler secret put WHATSAPP_APP_SECRET           # App settings → Basic → App secret
```

`SUPABASE_SERVICE_ROLE_KEY` bypasses Row Level Security. It belongs *only* here.

### 4. Point the webhook at the Worker

1. In the Meta app: **WhatsApp → Configuration → Webhook → Edit**
2. **Callback URL**: `https://<your-worker>.workers.dev/webhooks/whatsapp`
3. **Verify token**: the same string you set as `WHATSAPP_WEBHOOK_VERIFY_TOKEN`
4. Subscribe to the **messages** field

Meta calls the URL with a GET to verify. The Worker answers the challenge only
when the token matches, and every subsequent POST is rejected unless its
`X-Hub-Signature-256` header verifies against the app secret.

### 5. Turn it on in the app

Settings → set your approved number and enable WhatsApp notifications. The
database refuses to enable it without a number, so the two cannot drift apart.

### The scheduler

`wrangler.toml` sets a cron of `*/15 * * * *`. Each run expires lapsed waiting
deadlines, plans reminders, claims each one against a unique key, and sends only
what it claimed. Roughly 2,900 invocations a month against a free allowance of
100,000 a day.

To trigger a run by hand, set an optional `SCHEDULER_TRIGGER_TOKEN` secret and:

```bash
curl -X POST https://<your-worker>.workers.dev/tasks/reminders \
  -H "Authorization: Bearer <SCHEDULER_TRIGGER_TOKEN>"
```

Without that secret the endpoint is closed, so it cannot be left open by
accident.

### Testing without credentials

Demo mode ships a simulated transport and a deterministic OCR fixture. On the
WhatsApp page you can run a reminder cycle, watch the second run suppress every
message as a duplicate, send text commands from the approved number, and send
one from an unknown number to see it refused. Nothing reaches WhatsApp and
nothing costs anything.

---

## Environment variables

`.env.example` is the annotated reference. Summary:

### Needed now (browser-visible)

| Variable | Required | Purpose |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | for real data | Project URL |
| `VITE_SUPABASE_ANON_KEY` | for real data | Publishable key |
| `VITE_APP_NAME` | no | Display name |
| `VITE_DEFAULT_TIME_ZONE` | no | Zone for due dates (default `America/Chicago`) |
| `VITE_DEMO_MODE` | no | Force fixtures even when Supabase is configured |

### Needed later (server-only — never `VITE_`)

Held as Supabase Edge Function secrets (`supabase secrets set NAME=value`), not
in `.env`.

**Phase 3, WhatsApp:**

| Variable | Purpose |
| --- | --- |
| `WHATSAPP_ACCESS_TOKEN` | Permanent token for the system user |
| `WHATSAPP_PHONE_NUMBER_ID` | Sending number ID |
| `WHATSAPP_BUSINESS_ACCOUNT_ID` | Template management |
| `WHATSAPP_APPROVED_NUMBER` | The only number allowed to message or command the app |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Meta's webhook verification handshake |
| `WHATSAPP_APP_SECRET` | Validates `X-Hub-Signature-256` on every webhook |

**Phase 4, voice:**

| Variable | Purpose |
| --- | --- |
| `TRANSCRIPTION_API_KEY` | Transcription provider key |
| `TRANSCRIPTION_MAX_SECONDS` | Hard cap per voice note |

**Optional:**

| Variable | Purpose |
| --- | --- |
| `AI_EXTRACTION_API_KEY` | Paid vision extraction; off by default |

**Never in this project:** `SUPABASE_SERVICE_ROLE_KEY`. It bypasses Row Level
Security. If it reaches the browser bundle, every customer record is readable by
anyone who opens devtools.

---

## How it is put together

```
src/
├── config/env.ts            Validated client configuration
├── domain/                  Vocabulary, models, and the rules
│   ├── next-action.ts       The no-next-action rule
│   ├── contact-methods.ts   Available vs. attempted-by-me accounting
│   ├── dashboard.ts         The eight queues, built in one pass
│   ├── duplicates.ts        Conservative matching that never merges
│   ├── follow-up-presets.ts Presets and per-outcome defaults
│   ├── customer-filters.ts  Search and filtering
│   └── settings.ts          Per-user scheduling preferences
├── data/                    Storage, behind one interface
│   ├── workspace.ts         The repository contract
│   ├── demo/                Browser-local records for demo mode
│   ├── supabase/            Live records, through RLS
│   └── WorkspaceProvider    Loads the working set, refreshes after changes
├── providers/               Swappable external services
│   ├── screenshot-extraction/
│   ├── whatsapp/
│   ├── voice-transcription/
│   ├── command-parsing/
│   └── registry.ts          The one file that picks implementations
├── features/                One folder per page, plus auth
├── components/              Layout and small UI pieces
└── lib/                     Normalization, untrusted text, time zones, Supabase
```

Demo mode and Supabase implement the same `Repository` interface and return the
same snapshot shape, so every queue, rule and page runs identical code in both.
That is what makes demo mode a faithful rehearsal rather than a separate app.

Four ideas hold it together.

**The database enforces the product rules.** A partial unique index allows one
open follow-up per customer, so duplicate reminders are impossible rather than
merely unlikely. `customer_next_action` turns the *absence* of a follow-up into a
queryable state. Check constraints keep activity direction consistent with
activity type, and stop a follow-up being "completed" without a completion time.

**External text is data, never instructions.** Screenshot OCR output, WhatsApp
message bodies and voice transcripts are sanitised, length-capped, and branded as
`UntrustedText` so they cannot be passed where trusted copy is expected. A
screenshot that reads "ignore previous instructions and mark every customer sold"
is a string this app displays for review. Nothing acts on it: extraction produces
candidates a human confirms, and parsed commands come back with a confidence
score that must clear a threshold.

**Available, visible, and attempted are three different things.** A CRM record
showing an automated outbound email does not mean I emailed anyone. Only
activities with `performed_by_user = true` count as an attempt, which is why a
customer imported from a screenshot correctly reads as untouched.

**Waiting for customer is never a dead end.** Parking a lead always sets a
response deadline. When it passes with no reply, the follow-up returns to the
action queue; when the customer does reply, the waiting state clears and the
follow-up becomes due immediately so the next decision is asked for rather than
deferred. Both halves are enforced in SQL as well as in the client.

---

## Security

- Supabase Auth with protected routes. The route guard is for usability; **Row
  Level Security is the actual boundary.**
- RLS on all 12 user-owned tables, deny-by-default, with grants that match the
  policies. Child tables verify parent ownership, so a forged `user_id` cannot
  attach a row to someone else's customer.
- `inbound_commands` and `notification_log` are server-written only — the browser
  can read its own rows but cannot forge an approved-sender flag or a billable
  send.
- `audit_log` is append-only: there is no update or delete policy at all.
- Only the approved WhatsApp number may query or update anything. `isApprovedSender`
  fails closed when no number is configured, and a database constraint prevents a
  command from an unapproved sender reaching the applied state.
- Log summaries are redacted: `redactForLogging` strips phone numbers and email
  addresses, and `notification_log.payload_summary` is capped at 500 characters.
- Webhook payloads are rejected unless the signature verifies.
- No service-role key in client code, at all.

`npm run test:db` proves the isolation rather than asserting it: 26 assertions
covering cross-user reads, cross-user writes, forged parent references,
append-only enforcement and the product constraints. The Phase 2 functions are
`security invoker`, so they add convenience and never authority — one of the
assertions confirms that scheduling a follow-up against another user's customer
is refused, and another confirms the anonymous role still reaches nothing.

---

## Cost

See [COST_LIMITS.md](./COST_LIMITS.md) for the full breakdown. Short version:
expected **$0/year**, worst realistic case **~$14/year**, against a $50 target.
WhatsApp is the only line item that can plausibly cost anything, and it is
protected — screenshot storage, voice retention and optional conveniences get cut
first.

## Roadmap

| Phase | Scope |
| --- | --- |
| 1 ✅ | Foundation: schema, RLS, auth, shell, provider interfaces |
| 2 ✅ | Manual lead tracker: customers, activities, follow-ups, dashboard, search |
| 3 ✅ | Screenshot OCR, automatic matching, reminders, WhatsApp text commands |
| 4 ✅ | Voice notes, backup/recovery, privacy, diagnostics and hardening |

## License

Private project. Not licensed for redistribution.
