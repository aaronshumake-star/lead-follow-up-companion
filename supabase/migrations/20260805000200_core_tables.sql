-- ============================================================================
-- Core lead-tracking tables: profiles, customers, contact methods, vehicle
-- interests, activities and follow-ups.
-- ============================================================================

create type public.vehicle_condition as enum ('new', 'used', 'unknown');

-- ---------------------------------------------------------------------------
-- profiles — one row per authenticated user, holds personal preferences and
-- the single approved WhatsApp number.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  time_zone text not null default 'America/Chicago',

  -- WhatsApp: only this number may command the app, and only this number is
  -- ever messaged. Stored E.164 so comparisons are exact.
  whatsapp_number_e164 text,
  whatsapp_enabled boolean not null default false,
  whatsapp_verified_at timestamptz,
  morning_summary_at time not null default '08:00',
  overdue_summary_at time not null default '16:00',
  quiet_hours_start time not null default '21:00',
  quiet_hours_end time not null default '07:00',

  -- Cost controls. Every optional paid capability is off until switched on.
  monthly_message_budget integer not null default 300,
  ai_extraction_enabled boolean not null default false,
  voice_transcription_enabled boolean not null default false,
  monthly_voice_minute_budget integer not null default 30,
  retain_screenshots boolean not null default false,
  retain_voice_audio boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint profiles_whatsapp_e164_format
    check (whatsapp_number_e164 is null or whatsapp_number_e164 ~ '^\+[1-9]\d{7,14}$'),
  -- WhatsApp cannot be switched on until an approved number exists.
  constraint profiles_whatsapp_requires_number
    check (whatsapp_enabled = false or whatsapp_number_e164 is not null),
  constraint profiles_message_budget_range check (monthly_message_budget between 0 and 5000),
  constraint profiles_voice_budget_range check (monthly_voice_minute_budget between 0 and 600)
);

comment on table public.profiles is
  'Per-user settings. Single-user deployment, but still user-scoped so RLS applies.';
comment on column public.profiles.whatsapp_number_e164 is
  'The only number allowed to send commands to, or receive notifications from, this app.';

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  full_name text not null,
  first_name text,
  last_name text,
  -- Generated so dedupe keys can never drift from the display value.
  normalized_name text generated always as (public.normalize_name(full_name)) stored,

  primary_phone text,
  normalized_phone text generated always as (public.normalize_phone(primary_phone)) stored,
  primary_email text,
  normalized_email text generated always as (public.normalize_email(primary_email)) stored,

  dealership_customer_id text,
  city text,
  state text,
  preferred_language public.preferred_language not null default 'unknown',
  salesperson text,
  lead_source text,
  lead_priority public.lead_priority not null default 'normal',
  lead_temperature public.lead_temperature not null default 'unknown',
  lead_status public.lead_status not null default 'new',
  notes text,

  source public.record_source not null default 'manual',
  last_activity_at timestamptz,
  archived_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customers_full_name_not_blank check (btrim(full_name) <> ''),
  constraint customers_state_format check (state is null or state ~ '^[A-Za-z]{2}$'),
  constraint customers_email_shape check (primary_email is null or primary_email like '%_@_%'),
  -- Archived is a state and a timestamp; keep them in agreement.
  constraint customers_archived_consistency
    check ((lead_status = 'archived') = (archived_at is not null))
);

comment on column public.customers.notes is
  'Free text. May originate from a screenshot or WhatsApp message: treat as untrusted data.';

create unique index customers_user_dealership_id_key
  on public.customers (user_id, dealership_customer_id)
  where dealership_customer_id is not null;

create index customers_user_id_idx on public.customers (user_id);
create index customers_normalized_name_idx on public.customers (user_id, normalized_name);
create index customers_normalized_phone_idx on public.customers (user_id, normalized_phone)
  where normalized_phone is not null;
create index customers_normalized_email_idx on public.customers (user_id, normalized_email)
  where normalized_email is not null;
create index customers_lead_status_idx on public.customers (user_id, lead_status);
create index customers_active_idx on public.customers (user_id, updated_at desc)
  where archived_at is null;

-- ---------------------------------------------------------------------------
-- customer_contact_methods — the channels that *exist* for a customer.
-- Whether I ever used one is recorded in activities, never inferred here.
-- ---------------------------------------------------------------------------
create table public.customer_contact_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,

  method public.contact_method not null,
  value text not null,
  normalized_value text generated always as (
    case
      when method in ('phone_call', 'sms', 'whatsapp', 'voicemail') then public.normalize_phone(value)
      when method = 'email' then public.normalize_email(value)
      else public.normalize_name(value)
    end
  ) stored,

  label text,
  is_primary boolean not null default false,
  is_verified boolean not null default false,
  opted_out boolean not null default false,
  source public.record_source not null default 'manual',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint customer_contact_methods_value_not_blank check (btrim(value) <> '')
);

comment on table public.customer_contact_methods is
  'Availability of a channel only. Attempts live in public.activities.';

create unique index customer_contact_methods_unique_value
  on public.customer_contact_methods (customer_id, method, normalized_value);
create unique index customer_contact_methods_one_primary_per_method
  on public.customer_contact_methods (customer_id, method)
  where is_primary;
create index customer_contact_methods_customer_idx
  on public.customer_contact_methods (customer_id);
create index customer_contact_methods_user_idx
  on public.customer_contact_methods (user_id);

-- ---------------------------------------------------------------------------
-- vehicle_interests
-- ---------------------------------------------------------------------------
create table public.vehicle_interests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,

  model_year integer,
  make text,
  model text,
  floorplan text,
  stock_number text,
  condition public.vehicle_condition not null default 'unknown',
  is_primary boolean not null default false,
  notes text,
  source public.record_source not null default 'manual',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint vehicle_interests_year_range
    check (model_year is null or model_year between 1950 and 2100),
  -- An interest with nothing identifying it is noise.
  constraint vehicle_interests_has_identity check (
    coalesce(nullif(btrim(coalesce(make, '')), ''), nullif(btrim(coalesce(model, '')), ''),
             nullif(btrim(coalesce(floorplan, '')), ''), nullif(btrim(coalesce(stock_number, '')), ''),
             model_year::text) is not null
  )
);

create unique index vehicle_interests_one_primary_per_customer
  on public.vehicle_interests (customer_id)
  where is_primary;
create unique index vehicle_interests_stock_number_key
  on public.vehicle_interests (customer_id, stock_number)
  where stock_number is not null;
create index vehicle_interests_customer_idx on public.vehicle_interests (customer_id);
create index vehicle_interests_user_idx on public.vehicle_interests (user_id);

-- ---------------------------------------------------------------------------
-- activities — the communication ledger.
-- ---------------------------------------------------------------------------
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,

  type public.activity_type not null,
  direction public.activity_direction not null,
  method public.contact_method,
  outcome public.activity_outcome,

  summary text,
  -- Verbatim screenshot / message / transcript text. Untrusted input.
  raw_text text,

  occurred_at timestamptz not null default now(),
  source public.record_source not null default 'manual',

  -- The distinction the product depends on: an activity visible in a CRM
  -- screenshot is NOT something I attempted unless this is explicitly true.
  performed_by_user boolean not null default false,

  external_message_id text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),

  constraint activities_metadata_is_object check (jsonb_typeof(metadata) = 'object'),
  -- Direction must agree with the activity type.
  constraint activities_direction_matches_type check (
    case
      when type in ('outbound_call', 'outbound_text', 'outbound_email', 'voicemail_left')
        then direction = 'outbound'
      when type in ('inbound_call', 'inbound_text', 'inbound_email', 'voicemail_received')
        then direction = 'inbound'
      when type in ('note', 'status_change', 'follow_up_completed', 'screenshot_import')
        then direction = 'internal'
      else true
    end
  ),
  -- Only real communication can be "attempted by me".
  constraint activities_internal_not_user_attempt check (
    direction <> 'internal' or performed_by_user = false
  )
);

comment on column public.activities.performed_by_user is
  'True only when I personally attempted this contact. Screenshot imports default to false.';
comment on column public.activities.raw_text is
  'Untrusted verbatim text (screenshot OCR, WhatsApp body, voice transcript).';

create unique index activities_external_message_id_key
  on public.activities (user_id, external_message_id)
  where external_message_id is not null;
create index activities_customer_occurred_idx
  on public.activities (customer_id, occurred_at desc);
create index activities_user_occurred_idx on public.activities (user_id, occurred_at desc);
create index activities_user_attempts_idx
  on public.activities (customer_id, method, occurred_at desc)
  where performed_by_user;

-- ---------------------------------------------------------------------------
-- follow_ups — the mechanism that stops leads from being forgotten.
-- ---------------------------------------------------------------------------
create table public.follow_ups (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  customer_id uuid not null references public.customers (id) on delete cascade,

  due_at timestamptz not null,
  status public.follow_up_status not null default 'pending',
  priority public.lead_priority not null default 'normal',
  reason text,
  recommended_method public.contact_method,

  -- "Waiting for customer" is only a valid state while it has a deadline.
  waiting_until timestamptz,
  completed_at timestamptz,
  snoozed_until timestamptz,

  reminder_status public.reminder_status not null default 'not_scheduled',
  reminder_sent_at timestamptz,
  whatsapp_message_id text,

  source public.record_source not null default 'manual',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint follow_ups_completed_consistency
    check ((status = 'completed') = (completed_at is not null)),
  constraint follow_ups_snoozed_requires_time
    check (status <> 'snoozed' or snoozed_until is not null),
  constraint follow_ups_waiting_requires_deadline
    check (status <> 'waiting_on_customer' or waiting_until is not null)
);

comment on table public.follow_ups is
  'At most one open follow-up per customer; a customer with none surfaces in the no-next-action queue.';

-- The heart of the product: one open commitment per customer, no duplicates.
create unique index follow_ups_one_open_per_customer
  on public.follow_ups (customer_id)
  where status in ('pending', 'snoozed', 'overdue', 'waiting_on_customer');

create index follow_ups_due_idx on public.follow_ups (user_id, due_at)
  where status in ('pending', 'snoozed', 'overdue', 'waiting_on_customer');
create index follow_ups_status_idx on public.follow_ups (user_id, status);
create index follow_ups_customer_idx on public.follow_ups (customer_id, due_at desc);
create unique index follow_ups_whatsapp_message_id_key
  on public.follow_ups (user_id, whatsapp_message_id)
  where whatsapp_message_id is not null;

-- ---------------------------------------------------------------------------
-- updated_at triggers
-- ---------------------------------------------------------------------------
create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

create trigger customers_set_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

create trigger customer_contact_methods_set_updated_at
  before update on public.customer_contact_methods
  for each row execute function public.set_updated_at();

create trigger vehicle_interests_set_updated_at
  before update on public.vehicle_interests
  for each row execute function public.set_updated_at();

create trigger follow_ups_set_updated_at
  before update on public.follow_ups
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Provision a profile row automatically for every new auth user.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
