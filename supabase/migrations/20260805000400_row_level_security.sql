-- ============================================================================
-- Row Level Security.
--
-- Every user-owned table is deny-by-default. Ownership is always checked with
-- (select auth.uid()) = user_id — the subselect form lets Postgres evaluate the
-- uid once per statement instead of once per row.
--
-- Child tables verify BOTH their own user_id and that the parent row belongs to
-- the same user, so a forged user_id on a child row cannot attach it to someone
-- else's customer.
-- ============================================================================

alter table public.profiles enable row level security;
alter table public.customers enable row level security;
alter table public.customer_contact_methods enable row level security;
alter table public.vehicle_interests enable row level security;
alter table public.activities enable row level security;
alter table public.follow_ups enable row level security;
alter table public.screenshots enable row level security;
alter table public.screenshot_extraction_fields enable row level security;
alter table public.inbound_commands enable row level security;
alter table public.customer_match_candidates enable row level security;
alter table public.notification_log enable row level security;
alter table public.audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- Table privileges.
--
-- RLS filters rows; grants decide which verbs exist at all. Both are set
-- explicitly so a missing policy can never fall back to a permissive default.
-- Nothing at all is reachable anonymously.
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, public;

grant select, insert, update on public.profiles to authenticated;
grant select, insert, update, delete on public.customers to authenticated;
grant select, insert, update, delete on public.customer_contact_methods to authenticated;
grant select, insert, update, delete on public.vehicle_interests to authenticated;
grant select, insert, update, delete on public.follow_ups to authenticated;
grant select, insert, update, delete on public.screenshots to authenticated;
grant select, insert, update, delete on public.screenshot_extraction_fields to authenticated;
grant select, insert, update, delete on public.customer_match_candidates to authenticated;

-- Append-only from the browser: history stays intact.
grant select, insert, update on public.activities to authenticated;
grant select, insert on public.audit_log to authenticated;

-- Written only by the server. The browser reads its own rows and nothing more,
-- so an approved-sender flag or a billable send cannot be forged client-side.
grant select on public.inbound_commands to authenticated;
grant select on public.notification_log to authenticated;

-- ---------------------------------------------------------------------------
-- Helper: does this customer belong to the current user?
-- ---------------------------------------------------------------------------
create or replace function public.owns_customer(target_customer_id uuid)
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select exists (
    select 1
    from public.customers c
    where c.id = target_customer_id
      and c.user_id = (select auth.uid())
  )
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy "profiles: owner can read"
  on public.profiles for select to authenticated
  using ((select auth.uid()) = id);

create policy "profiles: owner can insert"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

create policy "profiles: owner can update"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Deliberately no delete policy: a profile disappears with its auth user.

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
create policy "customers: owner can read"
  on public.customers for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "customers: owner can insert"
  on public.customers for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "customers: owner can update"
  on public.customers for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "customers: owner can delete"
  on public.customers for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- customer_contact_methods
-- ---------------------------------------------------------------------------
create policy "contact methods: owner can read"
  on public.customer_contact_methods for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "contact methods: owner can insert"
  on public.customer_contact_methods for insert to authenticated
  with check ((select auth.uid()) = user_id and public.owns_customer(customer_id));

create policy "contact methods: owner can update"
  on public.customer_contact_methods for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.owns_customer(customer_id));

create policy "contact methods: owner can delete"
  on public.customer_contact_methods for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- vehicle_interests
-- ---------------------------------------------------------------------------
create policy "vehicle interests: owner can read"
  on public.vehicle_interests for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "vehicle interests: owner can insert"
  on public.vehicle_interests for insert to authenticated
  with check ((select auth.uid()) = user_id and public.owns_customer(customer_id));

create policy "vehicle interests: owner can update"
  on public.vehicle_interests for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.owns_customer(customer_id));

create policy "vehicle interests: owner can delete"
  on public.vehicle_interests for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- activities — insert/update only; the ledger is not client-deletable so that
-- history cannot be quietly rewritten.
-- ---------------------------------------------------------------------------
create policy "activities: owner can read"
  on public.activities for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "activities: owner can insert"
  on public.activities for insert to authenticated
  with check ((select auth.uid()) = user_id and public.owns_customer(customer_id));

create policy "activities: owner can update"
  on public.activities for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.owns_customer(customer_id));

-- ---------------------------------------------------------------------------
-- follow_ups
-- ---------------------------------------------------------------------------
create policy "follow ups: owner can read"
  on public.follow_ups for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "follow ups: owner can insert"
  on public.follow_ups for insert to authenticated
  with check ((select auth.uid()) = user_id and public.owns_customer(customer_id));

create policy "follow ups: owner can update"
  on public.follow_ups for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and public.owns_customer(customer_id));

create policy "follow ups: owner can delete"
  on public.follow_ups for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- screenshots — deletable by the owner so a mistaken paste can be purged.
-- ---------------------------------------------------------------------------
create policy "screenshots: owner can read"
  on public.screenshots for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "screenshots: owner can insert"
  on public.screenshots for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "screenshots: owner can update"
  on public.screenshots for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "screenshots: owner can delete"
  on public.screenshots for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- screenshot_extraction_fields
-- ---------------------------------------------------------------------------
create policy "extraction fields: owner can read"
  on public.screenshot_extraction_fields for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "extraction fields: owner can insert"
  on public.screenshot_extraction_fields for insert to authenticated
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.screenshots s
      where s.id = screenshot_id and s.user_id = (select auth.uid())
    )
  );

create policy "extraction fields: owner can update"
  on public.screenshot_extraction_fields for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "extraction fields: owner can delete"
  on public.screenshot_extraction_fields for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- inbound_commands — read-only from the browser. Webhook rows are written
-- server-side by the service role after the sender has been validated, so the
-- client is never able to forge an "approved" command.
-- ---------------------------------------------------------------------------
create policy "inbound commands: owner can read"
  on public.inbound_commands for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- customer_match_candidates
-- ---------------------------------------------------------------------------
create policy "match candidates: owner can read"
  on public.customer_match_candidates for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "match candidates: owner can insert"
  on public.customer_match_candidates for insert to authenticated
  with check ((select auth.uid()) = user_id and public.owns_customer(customer_id));

create policy "match candidates: owner can update"
  on public.customer_match_candidates for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "match candidates: owner can delete"
  on public.customer_match_candidates for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- notification_log — read-only from the browser; sends are recorded by the
-- server so the idempotency key and billable flag stay trustworthy.
-- ---------------------------------------------------------------------------
create policy "notifications: owner can read"
  on public.notification_log for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- audit_log — append-only. No update or delete policy exists at all.
-- ---------------------------------------------------------------------------
create policy "audit log: owner can read"
  on public.audit_log for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "audit log: owner can append"
  on public.audit_log for insert to authenticated
  with check ((select auth.uid()) = user_id);
