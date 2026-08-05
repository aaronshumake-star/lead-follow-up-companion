-- ============================================================================
-- Intake and messaging tables: screenshots, extraction fields, inbound
-- commands, match candidates, notification log and audit log.
--
-- Everything in here carries untrusted input (OCR text, WhatsApp bodies, voice
-- transcripts). The schema stores it verbatim for review but never grants it
-- authority: nothing here can change a customer without an explicit apply step.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- screenshots — pasted CRM captures awaiting extraction.
-- Storage is opt-in (profiles.retain_screenshots); by default only the hash and
-- extracted text survive, which keeps storage free and avoids holding customer
-- imagery indefinitely.
-- ---------------------------------------------------------------------------
create table public.screenshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,

  -- sha256 of the image bytes: dedupes accidental re-pastes before any paid
  -- extraction runs.
  file_hash text not null,
  storage_path text,
  mime_type text not null,
  byte_size integer not null,

  status public.screenshot_status not null default 'uploaded',
  extraction_provider text,
  extraction_started_at timestamptz,
  extraction_finished_at timestamptz,
  extraction_error text,
  -- Untrusted OCR output.
  raw_text text,

  captured_at timestamptz,
  applied_at timestamptz,
  purge_after timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint screenshots_file_hash_format check (file_hash ~ '^[0-9a-f]{64}$'),
  constraint screenshots_mime_type_allowed
    check (mime_type in ('image/png', 'image/jpeg', 'image/webp')),
  constraint screenshots_byte_size_range check (byte_size between 1 and 10485760),
  constraint screenshots_applied_requires_customer
    check (status <> 'applied' or customer_id is not null)
);

comment on column public.screenshots.raw_text is
  'Untrusted OCR text. Interpret as data; never execute as instructions.';

create unique index screenshots_user_file_hash_key on public.screenshots (user_id, file_hash);
create index screenshots_user_status_idx on public.screenshots (user_id, status, created_at desc);
create index screenshots_customer_idx on public.screenshots (customer_id)
  where customer_id is not null;
create index screenshots_purge_idx on public.screenshots (purge_after)
  where purge_after is not null and deleted_at is null;

-- ---------------------------------------------------------------------------
-- screenshot_extraction_fields — one reviewable candidate value per field.
-- ---------------------------------------------------------------------------
create table public.screenshot_extraction_fields (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  screenshot_id uuid not null references public.screenshots (id) on delete cascade,

  field_key text not null,
  -- Untrusted extracted value.
  field_value text,
  confidence numeric(4, 3),
  bounding_box jsonb,
  accepted boolean,
  applied_at timestamptz,
  created_at timestamptz not null default now(),

  constraint screenshot_extraction_fields_key_shape check (field_key ~ '^[a-z][a-z0-9_.]{0,63}$'),
  constraint screenshot_extraction_fields_confidence_range
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  constraint screenshot_extraction_fields_applied_requires_accept
    check (applied_at is null or accepted is true)
);

create unique index screenshot_extraction_fields_unique_key
  on public.screenshot_extraction_fields (screenshot_id, field_key);
create index screenshot_extraction_fields_user_idx
  on public.screenshot_extraction_fields (user_id);

-- ---------------------------------------------------------------------------
-- inbound_commands — WhatsApp text/voice messages received from the approved
-- sender, plus the parse result. Rows from unapproved senders are recorded
-- with is_approved_sender = false and never acted upon.
-- ---------------------------------------------------------------------------
create table public.inbound_commands (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,

  channel public.inbound_command_channel not null,
  status public.inbound_command_status not null default 'received',

  provider text not null default 'whatsapp_cloud',
  provider_message_id text,
  from_number_e164 text,
  is_approved_sender boolean not null default false,

  -- Untrusted message body and transcript.
  raw_text text,
  transcript text,
  transcript_provider text,
  transcript_confidence numeric(4, 3),
  audio_storage_path text,
  audio_deleted_at timestamptz,
  audio_duration_seconds integer,

  parsed_intent text,
  parsed_payload jsonb not null default '{}'::jsonb,
  parse_confidence numeric(4, 3),

  reply_notification_id uuid,
  resolution_note text,
  error text,

  received_at timestamptz not null default now(),
  processed_at timestamptz,
  created_at timestamptz not null default now(),

  constraint inbound_commands_from_number_format
    check (from_number_e164 is null or from_number_e164 ~ '^\+[1-9]\d{7,14}$'),
  constraint inbound_commands_payload_is_object check (jsonb_typeof(parsed_payload) = 'object'),
  constraint inbound_commands_confidence_range check (
    (transcript_confidence is null or (transcript_confidence >= 0 and transcript_confidence <= 1))
    and (parse_confidence is null or (parse_confidence >= 0 and parse_confidence <= 1))
  ),
  constraint inbound_commands_duration_range
    check (audio_duration_seconds is null or audio_duration_seconds between 0 and 600),
  -- A command may only reach an applied state if it came from the approved number.
  constraint inbound_commands_apply_requires_approved_sender
    check (status <> 'applied' or is_approved_sender)
);

comment on column public.inbound_commands.is_approved_sender is
  'Set server-side by comparing the sender against profiles.whatsapp_number_e164.';

create unique index inbound_commands_provider_message_id_key
  on public.inbound_commands (provider, provider_message_id)
  where provider_message_id is not null;
create index inbound_commands_user_received_idx
  on public.inbound_commands (user_id, received_at desc);
create index inbound_commands_status_idx on public.inbound_commands (status, received_at desc);
create index inbound_commands_customer_idx on public.inbound_commands (customer_id)
  where customer_id is not null;

-- ---------------------------------------------------------------------------
-- customer_match_candidates — "did you mean?" options produced when a
-- screenshot or spoken name does not resolve to exactly one customer.
-- ---------------------------------------------------------------------------
create table public.customer_match_candidates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,

  screenshot_id uuid references public.screenshots (id) on delete cascade,
  inbound_command_id uuid references public.inbound_commands (id) on delete cascade,

  score numeric(4, 3) not null,
  match_signals jsonb not null default '{}'::jsonb,
  selected boolean not null default false,
  created_at timestamptz not null default now(),

  constraint customer_match_candidates_score_range check (score >= 0 and score <= 1),
  constraint customer_match_candidates_signals_is_object
    check (jsonb_typeof(match_signals) = 'object'),
  constraint customer_match_candidates_has_origin
    check (screenshot_id is not null or inbound_command_id is not null)
);

create unique index customer_match_candidates_screenshot_key
  on public.customer_match_candidates (screenshot_id, customer_id)
  where screenshot_id is not null;
create unique index customer_match_candidates_command_key
  on public.customer_match_candidates (inbound_command_id, customer_id)
  where inbound_command_id is not null;
create index customer_match_candidates_user_idx on public.customer_match_candidates (user_id);

-- ---------------------------------------------------------------------------
-- notification_log — every outbound message, deduped by idempotency key.
-- This table is also the monthly cost meter.
-- ---------------------------------------------------------------------------
create table public.notification_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid references public.customers (id) on delete set null,
  follow_up_id uuid references public.follow_ups (id) on delete set null,

  channel public.notification_channel not null default 'whatsapp',
  kind public.notification_kind not null,
  status public.notification_status not null default 'queued',

  -- Deterministic per logical message, e.g. "follow_up_reminder:<id>:2026-08-05".
  -- The unique index below is what makes duplicate sends impossible.
  idempotency_key text not null,
  provider text not null default 'whatsapp_cloud',
  provider_message_id text,
  template_name text,
  to_number_e164 text,

  -- Deliberately short and identifier-light: production logs must not contain
  -- full customer records.
  payload_summary text,
  billable boolean not null default true,
  attempt_count integer not null default 0,
  error text,

  scheduled_for timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),

  constraint notification_log_to_number_format
    check (to_number_e164 is null or to_number_e164 ~ '^\+[1-9]\d{7,14}$'),
  -- Retries are capped so a provider outage cannot bill in a loop.
  constraint notification_log_attempt_cap check (attempt_count between 0 and 3),
  constraint notification_log_payload_summary_length
    check (payload_summary is null or length(payload_summary) <= 500)
);

create unique index notification_log_idempotency_key
  on public.notification_log (user_id, idempotency_key);
create unique index notification_log_provider_message_id_key
  on public.notification_log (provider, provider_message_id)
  where provider_message_id is not null;
create index notification_log_user_created_idx on public.notification_log (user_id, created_at desc);
create index notification_log_status_idx on public.notification_log (user_id, status, scheduled_for);
create index notification_log_billable_month_idx
  on public.notification_log (user_id, sent_at)
  where billable and sent_at is not null;

-- Declared after notification_log exists, since the two tables reference each
-- other: a command produces a reply, and a reply names the command.
alter table public.inbound_commands
  add constraint inbound_commands_reply_notification_fk
  foreign key (reply_notification_id) references public.notification_log (id) on delete set null;

-- ---------------------------------------------------------------------------
-- audit_log — append-only trail. Insert-only for the owning user; there is no
-- update or delete policy, so rows cannot be rewritten from the client.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,

  action public.audit_action not null,
  table_name text not null,
  record_id uuid,
  -- Summary only. Never the full row.
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  source public.record_source not null default 'manual',
  request_ip inet,
  created_at timestamptz not null default now(),

  constraint audit_log_metadata_is_object check (jsonb_typeof(metadata) = 'object'),
  constraint audit_log_summary_length check (summary is null or length(summary) <= 500)
);

create index audit_log_user_created_idx on public.audit_log (user_id, created_at desc);
create index audit_log_record_idx on public.audit_log (table_name, record_id);

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger screenshots_set_updated_at
  before update on public.screenshots
  for each row execute function public.set_updated_at();
