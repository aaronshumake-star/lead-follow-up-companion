-- ============================================================================
-- Derived read models.
--
-- All views are security_invoker so the caller's RLS policies apply; a view is
-- never a way around row ownership.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- customer_next_action — the query behind the "no next action" queue.
--
-- A customer is covered when it is in a terminal state (sold / lost / do not
-- contact / archived) or has an open follow-up. Anything else is a lead that
-- can be forgotten, which is exactly what this app exists to prevent.
-- ---------------------------------------------------------------------------
create view public.customer_next_action
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
  end as is_overdue
from public.customers c
left join public.follow_ups f
  on f.customer_id = c.id
 and f.status in ('pending', 'snoozed', 'overdue', 'waiting_on_customer');

comment on view public.customer_next_action is
  'One row per customer with its open follow-up, if any. needs_next_action drives the no-next-action queue.';

-- ---------------------------------------------------------------------------
-- customer_contact_summary — keeps the three communication concepts apart.
--
--   methods_available    channels that exist for the customer
--   methods_attempted    channels *I* personally used (performed_by_user only)
--   methods_not_attempted the difference
--
-- Activity merely visible in a CRM screenshot never lands in methods_attempted,
-- because those rows are imported with performed_by_user = false.
--
-- The recommended next method is intentionally not computed here; it is a
-- product judgement that lives in src/domain/contact-methods.ts where it is
-- unit-tested.
-- ---------------------------------------------------------------------------
create view public.customer_contact_summary
with (security_invoker = on) as
with available as (
  select
    m.customer_id,
    array_agg(distinct m.method order by m.method) as methods_available
  from public.customer_contact_methods m
  where not m.opted_out
  group by m.customer_id
),
attempted as (
  select
    a.customer_id,
    array_agg(distinct a.method order by a.method)
      filter (where a.method is not null) as methods_attempted,
    count(*) as total_attempts,
    max(a.occurred_at) filter (where a.direction = 'outbound') as last_outbound_attempt_at
  from public.activities a
  where a.performed_by_user
  group by a.customer_id
),
inbound as (
  select
    a.customer_id,
    max(a.occurred_at) as last_inbound_response_at
  from public.activities a
  where a.direction = 'inbound'
  group by a.customer_id
)
select
  c.id as customer_id,
  c.user_id,
  coalesce(av.methods_available, '{}'::public.contact_method[]) as methods_available,
  coalesce(att.methods_attempted, '{}'::public.contact_method[]) as methods_attempted,
  array(
    select unnest(coalesce(av.methods_available, '{}'::public.contact_method[]))
    except
    select unnest(coalesce(att.methods_attempted, '{}'::public.contact_method[]))
  ) as methods_not_attempted,
  coalesce(att.total_attempts, 0) as total_attempts,
  att.last_outbound_attempt_at,
  ib.last_inbound_response_at
from public.customers c
left join available av on av.customer_id = c.id
left join attempted att on att.customer_id = c.id
left join inbound ib on ib.customer_id = c.id;

-- ---------------------------------------------------------------------------
-- monthly_message_usage — the cost meter checked before every send.
-- ---------------------------------------------------------------------------
create view public.monthly_message_usage
with (security_invoker = on) as
select
  n.user_id,
  date_trunc('month', n.sent_at) as month,
  n.channel,
  count(*) as messages_sent,
  count(*) filter (where n.billable) as billable_messages
from public.notification_log n
where n.sent_at is not null
  and n.status in ('sent', 'delivered', 'read')
group by n.user_id, date_trunc('month', n.sent_at), n.channel;

comment on view public.monthly_message_usage is
  'Billable message count per month. Compared against profiles.monthly_message_budget before sending.';

grant select on public.customer_next_action to authenticated;
grant select on public.customer_contact_summary to authenticated;
grant select on public.monthly_message_usage to authenticated;
