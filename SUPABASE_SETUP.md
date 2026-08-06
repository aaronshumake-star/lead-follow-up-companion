# Supabase setup — plain-English guide

## Create the free project

1. Open [supabase.com/dashboard](https://supabase.com/dashboard).
2. **New project**, choose the free plan and the nearest region.
3. Save the database password in a password manager.

## Apply all migrations automatically

In Cursor's terminal:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase db push
```

The project ref is the first part of the project URL. `db push` applies every
file in `supabase/migrations/` in filename order, through
`20260808000100_phase4_voice_backup_hardening.sql`. You do not need to paste
SQL manually.

## Create the one user and close public signup

1. Supabase Dashboard → Authentication → Users → Add user.
2. Enter your email/password and tick **Auto Confirm User**.
3. Authentication → Providers → Email → turn **Enable sign-ups** off.

## Production authentication URLs

In Supabase Dashboard → **Authentication** → **URL Configuration**:

1. Set **Site URL** to `https://lead-follow-up-companion.pages.dev`.
2. Under **Redirect URLs**, add these two exact entries:
   - `https://lead-follow-up-companion.pages.dev/reset-password`
   - `https://lead-follow-up-companion.pages.dev/auth/callback`
3. Remove the old production `/sign-in` redirect if it is listed. Keep local or
   preview redirects only when they are still actively used.

When sending from Authentication → Users, choose the matching redirect URL:
use `/reset-password` for **Send password recovery** and `/auth/callback` for
**Send magic link**. Redirect URLs must match exactly; do not substitute the
site root or `/sign-in`.

## Browser-safe values

Project Settings → API:

- Project URL → `VITE_SUPABASE_URL`
- anon/public key → `VITE_SUPABASE_ANON_KEY`

These are expected in browser code; Row Level Security is the protection.

## Server-only value

The service-role key bypasses all Row Level Security. Set it only as the
Cloudflare Worker secret `SUPABASE_SERVICE_ROLE_KEY`. Never put it in a `VITE_`
variable, Pages settings, a screenshot, source code, or chat.

## Confirm RLS

Run locally:

```bash
PG_SUPERUSER=postgres npm run test:db
```

The suite verifies cross-user reads/writes are blocked, forged child references
are blocked, service functions are unavailable to browser users, and anon can
read nothing.

For a hosted check, sign in as your user and create a fictional customer. It
should appear after refresh. Do not create a second production user; the app is
single-user, but the automated tests prove a different user cannot read it.

## Backups

Web app → Settings → Export and Backup → **Download JSON backup**. Keep it in
encrypted storage. The export excludes provider secrets, raw audio, and deleted
screenshots.

**Validate backup for restore** performs a dry run and shows counts/duplicate
risks. Additive restore imports only customers without duplicate warnings; it
does not overwrite verified phones/emails or import duplicate open follow-ups.

## Free-plan limitations

Free projects can pause after inactivity. Open Supabase Dashboard and click
**Restore project**, then wait until the status is Healthy. No data is lost by
an ordinary pause. Storage is limited, which is why screenshots and successful
voice audio are deleted by default.
