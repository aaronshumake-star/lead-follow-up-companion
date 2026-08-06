# Deploying the app — plain-English checklist

This uses free Cloudflare-provided domains. A custom domain is not required.

## Before you start

Create free accounts at:

1. **GitHub** — stores the private source code.
2. **Supabase** — stores the customer data.
3. **Cloudflare** — hosts the website and the reminder/webhook Worker.
4. **Meta for Developers** — provides WhatsApp.
5. **OpenAI** — optional paid voice transcription. Leave disabled until wanted.

## Website: Cloudflare Pages

1. Open Cloudflare Dashboard → **Workers & Pages** → **Create** → **Pages**.
2. Choose **Connect to Git**, select this repository, then press **Begin setup**.
3. Framework preset: **Vite**.
4. Build command: `npm run build`.
5. Build output directory: `dist`.
6. Add browser-safe variables only:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `VITE_DEFAULT_TIME_ZONE=America/Chicago`
7. Press **Save and Deploy**. It worked when the supplied `*.pages.dev` URL
   shows the sign-in page.
8. To undo: Workers & Pages → project → Settings → Delete project.

Never add a service-role key, Meta token, app secret, or transcription key to
Pages. Every `VITE_` value is public.

## Worker: scheduler and WhatsApp webhook

In Cursor's terminal:

```bash
npx wrangler login
npx wrangler deploy
```

Copy the `*.workers.dev` URL. Health check:

```bash
curl https://YOUR-WORKER.workers.dev/healthz
```

It worked when that prints `ok`.

Set secrets one at a time:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
npx wrangler secret put WHATSAPP_BUSINESS_ACCOUNT_ID
npx wrangler secret put WHATSAPP_APPROVED_NUMBER
npx wrangler secret put WHATSAPP_WEBHOOK_VERIFY_TOKEN
npx wrangler secret put WHATSAPP_APP_SECRET
```

Voice remains off until all of these are deliberately set:

```bash
npx wrangler secret put TRANSCRIPTION_ENABLED       # enter true
npx wrangler secret put TRANSCRIPTION_API_KEY
npx wrangler secret put TRANSCRIPTION_PROVIDER      # enter openai
npx wrangler secret put TRANSCRIPTION_MODEL         # enter whisper-1
npx wrangler secret put TRANSCRIPTION_MAX_SECONDS   # enter 120
npx wrangler secret put TRANSCRIPTION_MAX_FILE_BYTES # enter 10485760
```

To disable voice without deleting anything:

```bash
npx wrangler secret put TRANSCRIPTION_ENABLED
# enter false
```

To disable all production WhatsApp immediately, turn WhatsApp off in the web
app's Settings. The dashboard remains available.

The cron in `wrangler.toml` runs every 15 minutes. Cloudflare Dashboard →
Worker → **Triggers** should show `*/15 * * * *`.

## Environments

- Local/demo: no real Meta or transcription call; simulated providers only.
- Preview: use a separate Supabase project if testing real data.
- Production: production Supabase and Worker secrets.

Do not point a preview deployment at the production database.

## Updates and stale caches

The service worker deletes old caches. A deployed update shows **A new version
is ready**; press **Reload and update** once. It never reloads automatically,
which avoids an update loop and protects an unsaved form.
