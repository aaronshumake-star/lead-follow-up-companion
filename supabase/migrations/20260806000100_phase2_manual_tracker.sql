-- ============================================================================
-- Phase 2 — the manual lead tracker.
--
-- Purely additive. No Phase 1 table, policy, grant or constraint is altered or
-- dropped; Row Level Security is untouched, and the functions below are
-- security *invoker* so the caller's policies still decide what they can see
-- and change.
--
-- Three things are added:
--   1. Customer and profile columns the manual workflow needs.
--   2. Follow-up history columns, so replacing a follow-up records what
--      happened to the previous one instead of discarding it.
--   3. Functions that swap an open follow-up inside one transaction, which the
--      one-open-follow-up-per-customer unique index otherwise makes impossible
--      to do safely from the client.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- customers — fields the detail page captures
-- ---------------------------------------------------------------------------
alter table public.customers
  add column preferred_contact_method public.contact_method,
  -- Kept apart from the general notes field so each survives editing the other,
  -- and so the pinned note can be shown without the rest.
  add column pinned_note text,
  add column objections text,
  add column trade_notes text,
  add column finance_status text;

comment on column public.customers.preferred_contact_method is
  'What the customer asked to be contacted by. A preference, not a record of what was tried.';
comment on column public.customers.pinned_note is
  'Single note surfaced on the card and detail header. Untrusted if it came from a screenshot.';

alter table public.customers
  add constraint customers_pinned_note_length check (pinned_note is null or length(pinned_note) <= 500);

-- ---------------------------------------------------------------------------
-- follow_ups — history and appointments
-- ---------------------------------------------------------------------------
alter table public.follow_ups
  -- Appointments are follow-ups with a stronger promise attached, so they share
  -- the one-open-per-customer rule rather than living in a parallel table.
  add column is_appointment boolean not null default false,
  add column canceled_at timestamptz,
  add column outcome_note text,
  -- Set when this follow-up replaced an earlier one, so the chain is walkable.
  add column rescheduled_from_id uuid references public.follow_ups (id) on delete set null;

-- Existing rows predate the column, so align them before the constraint lands.
update public.follow_ups
   set canceled_at = updated_at
 where status = 'canceled' and canceled_at is null;

alter table public.follow_ups
  add constraint follow_ups_canceled_consistency
    check ((status = 'canceled') = (canceled_at is not null)),
  add constraint follow_ups_outcome_note_length
    check (outcome_note is null or length(outcome_note) <= 500),
  -- A follow-up cannot be its own predecessor.
  add constraint follow_ups_reschedule_not_self
    check (rescheduled_from_id is null or rescheduled_from_id <> id);

create index follow_ups_appointment_idx
  on public.follow_ups (user_id, due_at)
  where is_appointment and status in ('pending', 'snoozed', 'overdue', 'waiting_on_customer');

create index follow_ups_rescheduled_from_idx
  on public.follow_ups (rescheduled_from_id)
  where rescheduled_from_id is not null;

-- ---------------------------------------------------------------------------
-- profiles — per-user scheduling preferences
--
-- Defaults encode the habits in the brief: a call that went unanswered is worth
-- retrying tomorrow, a voicemail deserves two days before chasing again.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column morning_at time not null default '09:00',
  add column afternoon_at time not null default '14:00',
  add column no_answer_follow_up_hours integer not null default 24,
  add column voicemail_follow_up_hours integer not null default 48,
  add column text_no_reply_follow_up_hours integer not null default 24,
  add column email_no_reply_follow_up_hours integer not null default 48,
  add column quote_sent_follow_up_hours integer not null default 24,
  add column waiting_timeout_hours integer not null default 72,
  add column default_lead_priority public.lead_priority not null default 'normal',
  add column date_time_display text not null default 'relative';

alter table public.profiles
  add constraint profiles_follow_up_hours_range check (
    no_answer_follow_up_hours between 1 and 8760
    and voicemail_follow_up_hours between 1 and 8760
    and text_no_reply_follow_up_hours between 1 and 8760
    and email_no_reply_follow_up_hours between 1 and 8760
    and quote_sent_follow_up_hours between 1 and 8760
    and waiting_timeout_hours between 1 and 8760
  ),
  add constraint profiles_date_time_display_allowed
    check (date_time_display in ('relative', 'absolute', 'both'));

-- ============================================================================
-- Transactional follow-up functions.
--
-- The client cannot close one follow-up and open the next as a single unit —
-- two PostgREST calls are two transactions, and the partial unique index means
-- the second would fail while the first had already landed. These functions do
-- both in one statement block.
--
-- security invoker: RLS still applies, so a caller can only touch their own
-- rows. The functions add convenience, never authority.
-- ============================================================================

-- Resolutions a caller may apply to the follow-up currently open.
create type public.follow_up_resolution as enum ('complete', 'cancel', 'reschedule');

create or replace function public.close_open_follow_up(
  p_customer_id uuid,
  p_resolution public.follow_up_resolution default 'complete',
  p_note text default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  closed_id uuid;
begin
  update public.follow_ups f
     set status = case p_resolution
                    when 'complete' then 'completed'::public.follow_up_status
                    else 'canceled'::public.follow_up_status
                  end,
         completed_at = case when p_resolution = 'complete' then now() else null end,
         canceled_at = case when p_resolution = 'complete' then null else now() end,
         -- Snooze and waiting deadlines are meaningless once the row is closed.
         snoozed_until = null,
         waiting_until = null,
         outcome_note = coalesce(left(p_note, 500), f.outcome_note)
   where f.customer_id = p_customer_id
     and f.status in ('pending', 'snoozed', 'overdue', 'waiting_on_customer')
  returning f.id into closed_id;

  return closed_id;
end;
$$;

comment on function public.close_open_follow_up is
  'Closes the open follow-up for a customer. Returns its id, or null when there was none.';

create or replace function public.schedule_follow_up(
  p_customer_id uuid,
  p_due_at timestamptz,
  p_reason text default null,
  p_recommended_method public.contact_method default null,
  p_priority public.lead_priority default 'normal',
  p_waiting_until timestamptz default null,
  p_is_appointment boolean default false,
  p_resolution public.follow_up_resolution default 'reschedule',
  p_resolution_note text default null,
  p_source public.record_source default 'manual'
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  previous_id uuid;
  new_id uuid;
  owner_id uuid := (select auth.uid());
  next_status public.follow_up_status;
begin
  if owner_id is null then
    raise exception 'schedule_follow_up requires an authenticated caller';
  end if;

  -- Closing the previous commitment and opening the next one happen together,
  -- so the unique index never sees two open rows and history is never lost.
  previous_id := public.close_open_follow_up(p_customer_id, p_resolution, p_resolution_note);

  next_status := case
    when p_waiting_until is not null then 'waiting_on_customer'::public.follow_up_status
    else 'pending'::public.follow_up_status
  end;

  insert into public.follow_ups (
    user_id, customer_id, due_at, status, priority, reason, recommended_method,
    waiting_until, is_appointment, rescheduled_from_id, source
  )
  values (
    owner_id, p_customer_id, p_due_at, next_status, p_priority, left(p_reason, 500),
    p_recommended_method, p_waiting_until, p_is_appointment, previous_id, p_source
  )
  returning id into new_id;

  return new_id;
end;
$$;

comment on function public.schedule_follow_up is
  'Closes any open follow-up and opens the next one in a single transaction, linking the two.';

-- ---------------------------------------------------------------------------
-- Waiting-for-customer expiry.
--
-- "Waiting" must never be a dead end. Once the deadline passes with no inbound
-- response, the follow-up becomes actionable again rather than sitting quietly.
-- Idempotent, so it is safe to call on every dashboard load; Phase 3 will call
-- the same function from a scheduler.
-- ---------------------------------------------------------------------------
create or replace function public.expire_waiting_follow_ups(p_now timestamptz default now())
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expired integer;
begin
  update public.follow_ups f
     set status = 'overdue',
         -- The deadline is when action became due, not when it was noticed.
         due_at = least(f.due_at, f.waiting_until),
         waiting_until = null,
         outcome_note = coalesce(f.outcome_note, 'Waiting period elapsed with no response')
   where f.status = 'waiting_on_customer'
     and f.waiting_until is not null
     and f.waiting_until <= p_now;

  get diagnostics expired = row_count;
  return expired;
end;
$$;

comment on function public.expire_waiting_follow_ups is
  'Returns lapsed waiting follow-ups to the action queue. Idempotent.';

-- ---------------------------------------------------------------------------
-- Inbound response clears the waiting state.
--
-- A customer who replies is no longer someone to wait on, so the follow-up
-- becomes due now and asks for a decision instead of staying parked.
-- ---------------------------------------------------------------------------
create or replace function public.clear_waiting_on_response(
  p_customer_id uuid,
  p_now timestamptz default now()
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cleared_id uuid;
begin
  update public.follow_ups f
     set status = 'pending',
         due_at = p_now,
         waiting_until = null,
         outcome_note = coalesce(f.outcome_note, 'Customer responded')
   where f.customer_id = p_customer_id
     and f.status = 'waiting_on_customer'
  returning f.id into cleared_id;

  return cleared_id;
end;
$$;

comment on function public.clear_waiting_on_response is
  'Converts a waiting follow-up into an immediately due one after an inbound response.';

-- ---------------------------------------------------------------------------
-- customer_next_action gains the appointment flag and an explicit lapsed-wait
-- signal. Replaced rather than dropped, so existing columns keep their names,
-- types and order and nothing that already reads the view is affected.
-- ---------------------------------------------------------------------------
create or replace view public.customer_next_action
with (security_invoker = on) as
select
  c.id as customer_id,
  c.user_id,
  c.full_name,
  c.lead_status,
  c.lead_priority,
  c.lead_temperature,
  c.archived_at,
  c.last_activity_at,
  f.id as open_follow_up_id,
  f.due_at as next_due_at,
  f.status as follow_up_status,
  f.waiting_until,
  f.recommended_method,
  c.lead_status in ('sold', 'lost', 'do_not_contact', 'archived') as is_closed,
  (
    c.lead_status in ('sold', 'lost', 'do_not_contact', 'archived')
    or f.id is not null
  ) as has_next_action,
  (
    c.lead_status not in ('sold', 'lost', 'do_not_contact', 'archived')
    and f.id is null
  ) as needs_next_action,
  case
    when f.id is null then null
    when f.status = 'waiting_on_customer' and f.waiting_until <= now() then true
    when f.status in ('pending', 'overdue') and f.due_at <= now() then true
    when f.status = 'snoozed' and f.snoozed_until <= now() then true
    else false
  end as is_overdue,
  coalesce(f.is_appointment, false) as is_appointment,
  (f.status = 'waiting_on_customer' and f.waiting_until <= now()) as is_waiting_expired
from public.customers c
left join public.follow_ups f
  on f.customer_id = c.id
 and f.status in ('pending', 'snoozed', 'overdue', 'waiting_on_customer');

-- ---------------------------------------------------------------------------
-- Execute privileges.
--
-- PostgreSQL grants EXECUTE to PUBLIC by default; that is revoked so only the
-- authenticated role can call these, matching the table grants.
-- ---------------------------------------------------------------------------
revoke execute on function public.close_open_follow_up(uuid, public.follow_up_resolution, text)
  from public, anon;
revoke execute on function public.schedule_follow_up(
  uuid, timestamptz, text, public.contact_method, public.lead_priority, timestamptz,
  boolean, public.follow_up_resolution, text, public.record_source
) from public, anon;
revoke execute on function public.expire_waiting_follow_ups(timestamptz) from public, anon;
revoke execute on function public.clear_waiting_on_response(uuid, timestamptz) from public, anon;

grant execute on function public.close_open_follow_up(uuid, public.follow_up_resolution, text)
  to authenticated;
grant execute on function public.schedule_follow_up(
  uuid, timestamptz, text, public.contact_method, public.lead_priority, timestamptz,
  boolean, public.follow_up_resolution, text, public.record_source
) to authenticated;
grant execute on function public.expire_waiting_follow_ups(timestamptz) to authenticated;
grant execute on function public.clear_waiting_on_response(uuid, timestamptz) to authenticated;
