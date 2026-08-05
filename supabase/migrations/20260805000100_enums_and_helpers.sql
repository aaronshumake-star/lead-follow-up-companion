-- ============================================================================
-- Lead Follow-Up Companion — enums, extensions and shared helper functions.
--
-- Every domain vocabulary the application relies on lives here so that the
-- database rejects impossible states instead of trusting application code.
-- ============================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- ---------------------------------------------------------------------------
-- Lead / customer vocabulary
-- ---------------------------------------------------------------------------

-- The seven states in the product spec. Any active customer that is not in one
-- of the terminal states must have a next action, otherwise it surfaces in the
-- "no next action" queue.
create type public.lead_status as enum (
  'new',
  'working',
  'follow_up_scheduled',
  'waiting_on_customer',
  'appointment_scheduled',
  'sold',
  'lost',
  'do_not_contact',
  'archived'
);

create type public.lead_temperature as enum ('hot', 'warm', 'cold', 'unknown');

create type public.lead_priority as enum ('urgent', 'high', 'normal', 'low');

create type public.preferred_language as enum ('en', 'es', 'other', 'unknown');

-- ---------------------------------------------------------------------------
-- Communication vocabulary
--
-- Three separate concepts, deliberately kept apart:
--   1. contact_method            — a channel that exists for the customer
--   2. activity_type / direction — communication seen anywhere, incl. imports
--   3. activities.performed_by_user — communication *I* personally attempted
-- ---------------------------------------------------------------------------

create type public.contact_method as enum (
  'phone_call',
  'sms',
  'email',
  'whatsapp',
  'voicemail',
  'in_person',
  'other'
);

create type public.activity_type as enum (
  'outbound_call',
  'inbound_call',
  'outbound_text',
  'inbound_text',
  'outbound_email',
  'inbound_email',
  'voicemail_left',
  'voicemail_received',
  'whatsapp_message',
  'in_person',
  'appointment',
  'note',
  'status_change',
  'follow_up_completed',
  'screenshot_import'
);

create type public.activity_direction as enum ('outbound', 'inbound', 'internal');

create type public.activity_outcome as enum (
  'connected',
  'no_answer',
  'left_voicemail',
  'busy',
  'bad_number',
  'wrong_number',
  'replied',
  'no_reply',
  'appointment_set',
  'appointment_kept',
  'appointment_missed',
  'not_interested',
  'sold',
  'other'
);

-- Where a row came from. Screenshot / WhatsApp / voice sourced rows carry
-- untrusted text and must be treated as data, never as instructions.
create type public.record_source as enum (
  'manual',
  'screenshot',
  'whatsapp',
  'voice_note',
  'seed',
  'system'
);

-- ---------------------------------------------------------------------------
-- Follow-up vocabulary
-- ---------------------------------------------------------------------------

create type public.follow_up_status as enum (
  'pending',
  'snoozed',
  'completed',
  'canceled',
  'overdue',
  'waiting_on_customer'
);

create type public.reminder_status as enum (
  'not_scheduled',
  'scheduled',
  'sent',
  'failed',
  'suppressed',
  'acknowledged'
);

-- ---------------------------------------------------------------------------
-- Intake / messaging vocabulary
-- ---------------------------------------------------------------------------

create type public.screenshot_status as enum (
  'uploaded',
  'extracting',
  'needs_review',
  'applied',
  'discarded',
  'failed'
);

create type public.inbound_command_channel as enum ('whatsapp_text', 'whatsapp_voice', 'web');

create type public.inbound_command_status as enum (
  'received',
  'transcribing',
  'parsed',
  'needs_clarification',
  'applied',
  'rejected',
  'failed'
);

create type public.notification_channel as enum ('whatsapp', 'web');

create type public.notification_kind as enum (
  'follow_up_reminder',
  'morning_summary',
  'overdue_summary',
  'command_confirmation',
  'command_error',
  'system_alert'
);

create type public.notification_status as enum (
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
  'suppressed'
);

create type public.audit_action as enum ('insert', 'update', 'delete', 'access_denied', 'auth');

-- ---------------------------------------------------------------------------
-- Shared helper functions
-- ---------------------------------------------------------------------------

-- Keeps updated_at honest without trusting the client to send it.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at is
  'Trigger function that stamps updated_at server-side on every UPDATE.';

-- Deliberately dependency-free: the unaccent extension is not guaranteed to be
-- available on every Supabase plan, and the accent set we care about is small.
create or replace function public.unaccent_lite(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select translate(
    coalesce(value, ''),
    'áàâãäåÁÀÂÃÄÅéèêëÉÈÊËíìîïÍÌÎÏóòôõöÓÒÔÕÖúùûüÚÙÛÜñÑçÇ',
    'aaaaaaAAAAAAeeeeEEEEiiiiIIIIoooooOOOOOuuuuUUUUnNcC'
  )
$$;

-- Normalization mirrors src/lib/normalize so that generated columns and the
-- client agree on what "the same customer" means.
create or replace function public.normalize_name(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(
    btrim(
      regexp_replace(
        lower(public.unaccent_lite(coalesce(value, ''))),
        '[^a-z0-9]+',
        ' ',
        'g'
      )
    ),
    ''
  )
$$;

-- North-American friendly: keep digits, drop a leading country code so that
-- "+1 (555) 010-2233" and "555-010-2233" collide on purpose.
create or replace function public.normalize_phone(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select case
    when digits is null or length(digits) = 0 then null
    when length(digits) = 11 and left(digits, 1) = '1' then right(digits, 10)
    else digits
  end
  from (select regexp_replace(coalesce(value, ''), '\D', '', 'g') as digits) as s
$$;

create or replace function public.normalize_email(value text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select nullif(lower(btrim(coalesce(value, ''))), '')
$$;
