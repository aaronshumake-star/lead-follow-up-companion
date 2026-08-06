# Cost limits

Target: **no more than $50 per year** in total operating cost under normal light
personal use — roughly 20–40 lead updates a day, one person, one device.

The realistic expectation is **$0.00–$12.00 per year**, because every service in
the stack has a free tier that comfortably covers this workload. The paths that
could actually produce a bill are listed below, along with how to shut each one
off.

## Cost priority

When something has to give, it gives in this order — WhatsApp is protected:

1. **WhatsApp reminders and replies** — the thing that makes the app work
2. **Core lead tracker** — customers, follow-ups, activities
3. **Screenshot extraction**
4. **Voice-note updates**
5. **Optional convenience features**

Features that get reduced or removed *before* WhatsApp does:

- Permanent screenshot storage
- Advanced offline sync
- Browser push notifications
- Large analytics pages
- Multi-user support
- Paid monitoring
- Complex PWA features
- Long-term voice storage

---

## Service-by-service

### Cloudflare Workers — scheduler and webhook

| | |
| --- | --- |
| Free-tier limit | 100,000 requests/day, 10 ms CPU per invocation |
| Estimated usage | ~2,900 cron invocations/month plus a handful of webhook calls |
| Estimated yearly cost | **$0.00** |

The cron fires every fifteen minutes. Each run is a few queries and, usually,
zero sends — digests only fire inside their configured window, and individual
reminders only when something is actually due.

**What could create charges:** a much shorter cron interval, or a paid Workers
plan. Neither is needed.

**How to monitor:** Cloudflare dashboard → Workers → your Worker → Metrics.

---

### Cloudflare Pages — hosting

| | |
| --- | --- |
| Free-tier limit | Unlimited static requests and bandwidth; 500 builds/month |
| Estimated usage | ~10 builds/month, one user browsing |
| Estimated yearly cost | **$0.00** |

**What could create charges:** nothing on the free plan. Pages does not bill for
overage; it stops building. Cloudflare Workers (if added later for cron) is free
to 100,000 requests/day, which a personal scheduler will not approach.

**How to disable paid usage:** never add a paid Workers plan, Durable Objects, or
R2. None are needed.

**How to monitor:** Cloudflare dashboard → Workers & Pages → your project →
Metrics. Check monthly.

---

### Supabase Free — database, auth, storage

| | |
| --- | --- |
| Free-tier limit | 500 MB database, 5 GB egress, 50,000 monthly active users, 1 GB file storage, 500,000 Edge Function invocations/month |
| Estimated usage | <50 MB database, 1 user, ~5,000 function invocations/month |
| Estimated yearly cost | **$0.00** |

A few thousand customers with full activity history is single-digit megabytes.
The database limit is not a realistic constraint for one salesperson.

**What could create charges:**

- Retaining screenshot images. A 200 KB capture ten times a day is ~700 MB/year,
  which would eventually cross the 1 GB storage limit. **This is why
  `profiles.retain_screenshots` defaults to false** — only the SHA-256 hash and
  the extracted text are kept, and both are tiny.
- Retaining voice audio, for the same reason
  (`profiles.retain_voice_audio` defaults to false).
- Upgrading to Pro ($25/month) for point-in-time recovery or to avoid project
  pausing.

**Project pausing is the one real gotcha.** Free projects pause after 7 days with
no activity. This app is used daily, so it stays warm; if you take a long
holiday, open the app or the Supabase dashboard once to wake it.

**How to disable paid usage:** stay on the Free plan and leave both retention
switches off in Settings. Do not enable add-ons.

**How to monitor:** Supabase dashboard → Reports → Database size and Egress.
Settings → Usage shows every quota on one page.

---

### WhatsApp Business Platform Cloud API — messaging

**This is the only line item with a plausible non-zero cost, and it is the one
feature that must not be cut.**

Meta's pricing is per 24-hour *conversation*, not per message. Since every
message goes to a single approved number — mine — a day's reminders, digests and
replies generally fall inside one or two conversations.

| | |
| --- | --- |
| Free-tier limit | 1,000 free service conversations per month (US pricing; varies by region) |
| Estimated usage | ~60 business-initiated conversations/month (2/day: morning summary + one reminder digest) |
| Estimated yearly cost | **$0.00–$12.00** |

Utility-category conversations to a US number run roughly $0.01–$0.04 each. Even
at the top of that range with zero free allowance, 60/month is about $29/year;
with the free service-conversation allowance applied it is usually $0.

**What could create charges:**

- Sending one reminder per follow-up instead of a digest. Twenty separate
  messages a day would multiply the conversation count.
- Retry loops against a failing provider.
- Duplicate sends after a timeout, where the app is unsure whether the first one
  landed.

**How the app prevents each:**

| Control | Mechanism |
| --- | --- |
| One recipient only | The provider itself checks the destination against the approved number before every request; a bug elsewhere cannot message a customer |
| Digests, not per-item messages | `profiles.digest_only` collapses everything into one or two messages a day |
| No duplicates | Every send **claims** a unique idempotency key before it is sent. `claim_notification` returns null on a collision, so concurrent scheduler runs and retries cannot both send |
| Overdue chased on an interval | `profiles.overdue_reminder_interval_hours` — a lead overdue for a week produces one message a day, not one per cron tick |
| Retries capped, and only when safe | Three attempts maximum, and only for error codes the provider marks transient. A re-engagement rejection or an undeliverable number is permanent and never retried |
| Monthly meter | `monthly_usage_summary` totals measured cost per kind |
| Projected annual cost | The WhatsApp page projects from measured usage and warns at 80% of `profiles.annual_cost_threshold_usd` |
| Hard budget | `profiles.monthly_message_budget` (default 300) |
| Kill switch | `profiles.whatsapp_enabled` and `profiles.reminders_enabled` |
| Fallback | The dashboard shows the same queue, so the app is fully usable with WhatsApp off. Waiting deadlines still expire on load |

**How to disable paid usage:** Settings → turn off WhatsApp notifications. The
database constraint also prevents enabling it without an approved number.

**How to monitor:** Settings shows billable messages this month against the
budget. Meta's side: business.facebook.com → WhatsApp Manager → Insights.

---

### Screenshot OCR — Tesseract.js

| | |
| --- | --- |
| Free-tier limit | Not applicable; runs in the browser |
| Estimated usage | ~10 screenshots/day |
| Estimated yearly cost | **$0.00** |

Tesseract.js is open source and runs entirely on-device, so images never reach a
server and no per-image charge exists. It costs CPU and a one-time ~10 MB
language-data download, cached thereafter.

**What could create charges:** enabling paid AI extraction
(`profiles.ai_extraction_enabled`, default **false**). A vision model call costs
roughly $0.001–$0.01 per image; ten a day would be $4–$36/year.

**How to disable paid usage:** leave AI extraction off. It is off by default and
requires both the profile switch and a server-side API key.

**How to monitor:** if you ever enable it, watch the provider's usage dashboard
and set a hard spend cap there.

---

### Voice transcription

| | |
| --- | --- |
| Free-tier limit | Varies by provider; typically none |
| Estimated usage | 0 by default; ~30 minutes/month if enabled |
| Estimated yearly cost | **$0.00 disabled**, ~$2.20/year at 30 min/month |

Priced per second of audio. A 15-second voice note at $0.006/minute is about
$0.0015 — negligible individually, which is exactly why it needs a cap.

**What could create charges:** enabling transcription and then sending long
notes, or a retry loop re-transcribing the same audio.

**How the app prevents it:**

- `profiles.voice_transcription_enabled` defaults to **false**
- `profiles.monthly_voice_minute_budget` defaults to 30 minutes
- `TranscriptionInput.maxDurationSeconds` is enforced before upload, so an
  over-long note is rejected without being sent
- `inbound_commands.audio_duration_seconds` has a `check (… between 0 and 600)`
  constraint
- Audio is deleted once a transcript exists unless `retain_voice_audio` is on

**How to disable paid usage:** Settings → turn off voice transcription. It is off
by default.

**How to monitor:** the transcription provider's usage dashboard, plus
`inbound_commands.audio_duration_seconds` summed per month.

Phase 4 additionally records `voice_message_received`,
`audio_minute_processed`, `transcription_request`, `transcription_failed`,
`transcription_retry`, and `audio_retained` usage events. Settings can cap voice
messages per day, duration per note, failed-audio retention, and the annual
warning threshold. Successful audio is deleted immediately. OpenAI transcription
is disabled until `TRANSCRIPTION_ENABLED=true` and a server-only API key are
both configured; the app never upgrades a plan or enables billing itself.

---

### GitHub — source and CI

| | |
| --- | --- |
| Free-tier limit | Unlimited public repos; 2,000 Actions minutes/month on private repos |
| Estimated usage | ~50 minutes/month |
| Estimated yearly cost | **$0.00** |

**What could create charges:** exceeding Actions minutes on a private repo. The
test suite runs in seconds, so this is not close.

**How to monitor:** GitHub → Settings → Billing.

---

## Yearly total

| Service | Expected | Worst realistic case |
| --- | --- | --- |
| Cloudflare Pages | $0.00 | $0.00 |
| Supabase Free | $0.00 | $0.00 |
| WhatsApp Cloud API | $0.00 | $12.00 |
| Tesseract.js OCR | $0.00 | $0.00 |
| Voice transcription | $0.00 (off) | $2.20 (if enabled) |
| GitHub | $0.00 | $0.00 |
| **Total** | **$0.00** | **$14.20** |

Comfortably inside the $50/year target, with headroom for WhatsApp volume to
grow several times over before anything needs reconsidering.

---

## Things deliberately not used

Each of these was considered and rejected on cost:

- **Paid hosting** — Cloudflare Pages free tier is sufficient
- **Paid monitoring (Sentry, Datadog)** — browser devtools and Supabase logs
  cover a single-user app
- **Permanent screenshot storage** — the hash and extracted text are enough
- **Advanced analytics** — the dashboard counts are computed from a view
- **Multi-user support** — one user, though RLS is written as if there were many
  so it is correct rather than merely absent
- **A paid AI extraction model by default** — free on-device OCR first

## Monthly check, in about two minutes

1. Settings → billable messages this month against the budget
2. Supabase → Reports → Database size (expect well under 500 MB)
3. Cloudflare → Pages → build count (expect well under 500)
4. If voice or AI extraction is enabled, check that provider's usage page
