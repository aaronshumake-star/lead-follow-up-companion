-- ============================================================================
-- Phase 3 — screenshot intake, the reminder engine and WhatsApp commands.
--
-- Additive only. No Phase 1 or Phase 2 table, policy, grant or constraint is
-- altered or dropped, and the new functions are security *invoker* or, where
-- they must run from the scheduler, explicitly restricted to the service role.
--
-- The correction called out in the brief drives the shape of this migration:
-- the one-open-follow-up index stops duplicate follow-up *records*, but it does
-- nothing about duplicate *sends*. Notification idempotency is therefore its own
-- mechanism — a unique key plus an atomic claim, so two concurrent scheduler
-- runs cannot both decide they are the one sending.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

-- What the decision engine concluded about a screenshot. Stored so an automatic
-- import can be explained afterwards rather than being a silent change.
create type public.screenshot_decision as enum (
  'auto_create',
  'auto_update',
  'save_with_unverified_fields',
  'needs_match_review',
  'needs_conflict_review',
  'extraction_failed',
  'duplicate_ignored'
);

-- Which reminder a notification represents. Part of the idempotency key, so a
-- due-now reminder and an overdue reminder for the same follow-up are distinct
-- messages rather than one suppressing the other.
create type public.reminder_stage as enum (
  'due_now',
  'overdue',
  'waiting_deadline',
  'appointment',
  'morning_digest',
  'end_of_day_digest'
);

create type public.usage_event_kind as enum (
  'ocr_job',
  'screenshot_retained',
  'message_sent',
  'message_received',
  'message_failed',
  'message_retry',
  'reminder_generated'
);

-- ---------------------------------------------------------------------------
-- screenshots — intake metadata and the decision that was taken
-- ---------------------------------------------------------------------------
alter table public.screenshots
  add column decision public.screenshot_decision,
  -- Short, non-identifying explanation suitable for a log line or a list row.
  add column decision_reason text,
  add column overall_confidence numeric(4, 3),
  add column warnings jsonb not null default '[]'::jsonb,
  add column contains_multiple_customers boolean not null default false,
  add column image_width integer,
  add column image_height integer,
  -- Sanitised on the way in; never used to build a filesystem path.
  add column original_filename text,
  add column retained boolean not null default false,
  add column review_resolved_at timestamptz,
  add column review_action text;

alter table public.screenshots
  add constraint screenshots_overall_confidence_range
    check (overall_confidence is null or (overall_confidence >= 0 and overall_confidence <= 1)),
  add constraint screenshots_warnings_is_array check (jsonb_typeof(warnings) = 'array'),
  add constraint screenshots_dimensions_range check (
    (image_width is null or image_width between 1 and 20000)
    and (image_height is null or image_height between 1 and 20000)
  ),
  add constraint screenshots_filename_shape
    check (original_filename is null or original_filename ~ '^[A-Za-z0-9 ._-]{1,120}$'),
  add constraint screenshots_decision_reason_length
    check (decision_reason is null or length(decision_reason) <= 300),
  -- Retention is opt-in; without it there is nothing stored to point at.
  add constraint screenshots_retained_requires_path
    check (retained = false or storage_path is not null);

create index screenshots_review_queue_idx
  on public.screenshots (user_id, created_at desc)
  where status = 'needs_review';

create index screenshots_decision_idx on public.screenshots (user_id, decision, created_at desc);

comment on column public.screenshots.warnings is
  'Array of short warning codes from extraction. Untrusted in origin, but written by our own parser.';

-- ---------------------------------------------------------------------------
-- screenshot_extraction_fields — verified vs unverified
--
-- A field extracted with low confidence can still be worth keeping, as long as
-- it is marked unverified and can never be the thing that merges two people.
-- ---------------------------------------------------------------------------
alter table public.screenshot_extraction_fields
  add column verified boolean not null default false,
  add column applied_as_unverified boolean not null default false;

-- ---------------------------------------------------------------------------
-- customer_contact_methods — record where a channel came from
--
-- A channel seen in a screenshot exists, but nobody has confirmed it. Keeping
-- that distinct from a verified number matters when deciding what to trust.
-- ---------------------------------------------------------------------------
alter table public.customer_contact_methods
  add column discovered_from_screenshot_id uuid references public.screenshots (id) on delete set null;

-- ---------------------------------------------------------------------------
-- notification_log — reminder staging and the atomic claim
-- ---------------------------------------------------------------------------
alter table public.notification_log
  add column reminder_stage public.reminder_stage,
  -- Set the moment a run takes ownership of a send. A second run finding a
  -- claimed row leaves it alone.
  add column claimed_at timestamptz,
  add column claimed_by text,
  add column next_attempt_at timestamptz,
  -- Distinguishes "give up" from "try again later" without re-reading the error.
  add column permanent_failure boolean not null default false;

create index notification_log_pending_idx
  on public.notification_log (user_id, next_attempt_at)
  where status in ('queued', 'failed') and permanent_failure = false;

create index notification_log_failures_idx
  on public.notification_log (user_id, created_at desc)
  where permanent_failure;

-- ---------------------------------------------------------------------------
-- clarification_sessions — the pending question a WhatsApp reply answers
--
-- "I found two customers named Jesus" only works if the next message can be
-- resolved against the question that produced it.
-- ---------------------------------------------------------------------------
create table public.clarification_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  inbound_command_id uuid references public.inbound_commands (id) on delete set null,

  kind text not null,
  -- The question asked, and the options offered, so a numbered reply resolves.
  prompt text not null,
  options jsonb not null default '[]'::jsonb,
  -- The parsed command awaiting an answer, replayed once the answer arrives.
  pending_payload jsonb not null default '{}'::jsonb,

  expires_at timestamptz not null,
  resolved_at timestamptz,
  resolution text,
  created_at timestamptz not null default now(),

  constraint clarification_sessions_kind_shape check (kind ~ '^[a-z][a-z0-9_]{0,63}$'),
  constraint clarification_sessions_prompt_length check (length(prompt) between 1 and 1000),
  constraint clarification_sessions_options_is_array check (jsonb_typeof(options) = 'array'),
  constraint clarification_sessions_payload_is_object
    check (jsonb_typeof(pending_payload) = 'object'),
  -- A session that never expires would silently capture unrelated replies.
  constraint clarification_sessions_expiry_after_creation check (expires_at > created_at)
);

-- At most one unresolved question per user: a second would make a bare "1"
-- ambiguous all over again.
create unique index clarification_sessions_one_open_per_user
  on public.clarification_sessions (user_id)
  where resolved_at is null;

create index clarification_sessions_expiry_idx
  on public.clarification_sessions (expires_at)
  where resolved_at is null;

comment on table public.clarification_sessions is
  'The outstanding question a WhatsApp reply is answering. One open per user, always with an expiry.';

-- ---------------------------------------------------------------------------
-- usage_events — the cost meter
--
-- Append-only counters for anything that could eventually cost money, so the
-- yearly projection is measured rather than guessed.
-- ---------------------------------------------------------------------------
create table public.usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,

  kind public.usage_event_kind not null,
  quantity integer not null default 1,
  -- Zero for anything free, e.g. in-browser OCR. Stored per event so a pricing
  -- change does not rewrite history.
  estimated_cost_usd numeric(10, 5) not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),

  constraint usage_events_quantity_positive check (quantity between 1 and 100000),
  constraint usage_events_cost_range check (estimated_cost_usd >= 0 and estimated_cost_usd <= 100),
  constraint usage_events_metadata_is_object check (jsonb_typeof(metadata) = 'object')
);

create index usage_events_user_month_idx on public.usage_events (user_id, occurred_at desc);
create index usage_events_kind_idx on public.usage_events (user_id, kind, occurred_at desc);

-- ---------------------------------------------------------------------------
-- profiles — intake, reminder and cost settings
-- ---------------------------------------------------------------------------
alter table public.profiles
  -- Screenshot intake
  add column auto_import_enabled boolean not null default true,
  add column auto_follow_up_on_import boolean not null default true,
  -- A lead arriving before this hour gets a same-day follow-up; after it, the
  -- next morning. Configurable because dealership hours differ.
  add column new_lead_same_day_cutoff_hour integer not null default 16,
  add column same_day_follow_up_delay_hours integer not null default 3,

  -- Reminders
  add column reminders_enabled boolean not null default true,
  add column individual_reminders_enabled boolean not null default true,
  add column digest_only boolean not null default false,
  add column morning_digest_enabled boolean not null default true,
  add column end_of_day_digest_enabled boolean not null default true,
  add column end_of_day_digest_at time not null default '17:30',
  add column appointment_reminder_lead_hours integer not null default 24,
  add column overdue_reminder_interval_hours integer not null default 24,
  add column reminder_max_attempts integer not null default 3,

  -- Cost
  add column annual_cost_threshold_usd numeric(8, 2) not null default 50.00;

alter table public.profiles
  add constraint profiles_cutoff_hour_range check (new_lead_same_day_cutoff_hour between 0 and 23),
  add constraint profiles_same_day_delay_range
    check (same_day_follow_up_delay_hours between 1 and 12),
  add constraint profiles_appointment_lead_range
    check (appointment_reminder_lead_hours between 1 and 168),
  add constraint profiles_overdue_interval_range
    check (overdue_reminder_interval_hours between 1 and 720),
  -- Capped at three so a provider outage cannot bill in a loop; the same cap the
  -- notification_log attempt_count constraint enforces.
  add constraint profiles_reminder_attempts_range check (reminder_max_attempts between 1 and 3),
  add constraint profiles_cost_threshold_range
    check (annual_cost_threshold_usd between 0 and 10000);

-- ---------------------------------------------------------------------------
-- Row Level Security for the new tables
-- ---------------------------------------------------------------------------
alter table public.clarification_sessions enable row level security;
alter table public.usage_events enable row level security;

revoke all on public.clarification_sessions from anon, public;
revoke all on public.usage_events from anon, public;

-- Both are written by the server: a clarification session is created by the
-- webhook, and a usage event by whatever incurred the cost. The browser reads
-- its own rows and nothing more.
grant select on public.clarification_sessions to authenticated;
grant select, insert on public.usage_events to authenticated;

create policy "clarification sessions: owner can read"
  on public.clarification_sessions for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "usage events: owner can read"
  on public.usage_events for select to authenticated
  using ((select auth.uid()) = user_id);

-- In-browser OCR happens on the client, so the client has to be able to record
-- that it ran. The row is still constrained to its owner.
create policy "usage events: owner can append"
  on public.usage_events for insert to authenticated
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Notification idempotency.
--
-- claim_notification inserts the row that represents "I am sending this".
-- The unique index on (user_id, idempotency_key) does the real work: a second
-- caller with the same key collides and gets null back instead of a claim, so
-- concurrent scheduler runs cannot both send.
--
-- security definer, because the scheduler runs as the service role and there is
-- no auth.uid() to invoke as. The user_id is a required argument rather than
-- being derived, and the function only ever writes notification_log.
-- ---------------------------------------------------------------------------
create or replace function public.claim_notification(
  p_user_id uuid,
  p_idempotency_key text,
  p_kind public.notification_kind,
  p_reminder_stage public.reminder_stage default null,
  p_follow_up_id uuid default null,
  p_customer_id uuid default null,
  p_to_number_e164 text default null,
  p_payload_summary text default null,
  p_claimed_by text default 'scheduler'
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed_id uuid;
begin
  insert into public.notification_log (
    user_id, customer_id, follow_up_id, channel, kind, status, reminder_stage,
    idempotency_key, provider, to_number_e164, payload_summary,
    attempt_count, claimed_at, claimed_by
  )
  values (
    p_user_id, p_customer_id, p_follow_up_id, 'whatsapp', p_kind, 'queued', p_reminder_stage,
    p_idempotency_key, 'whatsapp_cloud', p_to_number_e164, left(p_payload_summary, 500),
    0, now(), p_claimed_by
  )
  -- Losing the race is the normal outcome, not an error: it means someone else
  -- already owns this send.
  on conflict (user_id, idempotency_key) do nothing
  returning id into claimed_id;

  return claimed_id;
end;
$$;

comment on function public.claim_notification is
  'Atomically claims the right to send one notification. Returns null when another run already holds it.';

-- ---------------------------------------------------------------------------
-- Recording the outcome of a claimed send.
-- ---------------------------------------------------------------------------
create or replace function public.record_notification_result(
  p_notification_id uuid,
  p_status public.notification_status,
  p_provider_message_id text default null,
  p_billable boolean default true,
  p_error text default null,
  p_permanent boolean default false,
  p_next_attempt_at timestamptz default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.notification_log n
     set status = p_status,
         provider_message_id = coalesce(p_provider_message_id, n.provider_message_id),
         billable = p_billable,
         error = left(p_error, 500),
         permanent_failure = p_permanent,
         next_attempt_at = p_next_attempt_at,
         attempt_count = least(n.attempt_count + 1, 3),
         sent_at = case when p_status in ('sent', 'delivered', 'read') then now() else n.sent_at end
   where n.id = p_notification_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Only the scheduler and webhook may claim or resolve sends. The browser has no
-- execute privilege at all, which is what stops a client forging a "sent" row.
-- ---------------------------------------------------------------------------
revoke execute on function public.claim_notification(
  uuid, text, public.notification_kind, public.reminder_stage, uuid, uuid, text, text, text
) from public, anon, authenticated;
revoke execute on function public.record_notification_result(
  uuid, public.notification_status, text, boolean, text, boolean, timestamptz
) from public, anon, authenticated;

grant execute on function public.claim_notification(
  uuid, text, public.notification_kind, public.reminder_stage, uuid, uuid, text, text, text
) to service_role;
grant execute on function public.record_notification_result(
  uuid, public.notification_status, text, boolean, text, boolean, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- Cost reporting
-- ---------------------------------------------------------------------------
create view public.monthly_usage_summary
with (security_invoker = on) as
select
  u.user_id,
  date_trunc('month', u.occurred_at) as month,
  u.kind,
  sum(u.quantity)::bigint as total_quantity,
  sum(u.estimated_cost_usd) as total_cost_usd
from public.usage_events u
group by u.user_id, date_trunc('month', u.occurred_at), u.kind;

comment on view public.monthly_usage_summary is
  'Measured usage per month per kind. Feeds the projected annual cost shown in Settings.';

grant select on public.monthly_usage_summary to authenticated;

-- ---------------------------------------------------------------------------
-- Screenshot review queue, exposed as a view so the client does not have to
-- re-derive which screenshots are waiting on a person.
-- ---------------------------------------------------------------------------
create view public.screenshot_review_queue
with (security_invoker = on) as
select
  s.id as screenshot_id,
  s.user_id,
  s.file_hash,
  s.status,
  s.decision,
  s.decision_reason,
  s.overall_confidence,
  s.warnings,
  s.contains_multiple_customers,
  s.customer_id,
  s.created_at,
  (
    select count(*)
    from public.customer_match_candidates m
    where m.screenshot_id = s.id
  ) as candidate_count
from public.screenshots s
where s.status = 'needs_review'
  and s.deleted_at is null;

grant select on public.screenshot_review_queue to authenticated;
