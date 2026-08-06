-- ============================================================================
-- Database tests: row-level security isolation and the constraints the product
-- rules depend on.
--
-- Run with `npm run test:db`, which replays the shim, the migrations and this
-- file against a throwaway database.
--
-- Each block runs as the `authenticated` role with a JWT subject claim set, so
-- the policies are exercised the same way PostgREST exercises them.
-- ============================================================================

\set ON_ERROR_STOP on

create or replace function public.test_as(user_id text)
returns void
language plpgsql
as $$
begin
  perform set_config('request.jwt.claim.sub', user_id, true);
end;
$$;

-- Two users, so cross-user access has something to fail against.
insert into auth.users (id, email) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'owner@example.test'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'intruder@example.test')
on conflict (id) do nothing;

insert into public.profiles (id, display_name) values
  ('aaaaaaaa-0000-4000-8000-000000000001', 'Owner'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'Intruder')
on conflict (id) do nothing;

insert into public.customers (id, user_id, full_name, primary_phone, dealership_customer_id)
values
  ('cccccccc-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000001',
   'Owner Customer', '+15550100301', 'OWN-1'),
  ('cccccccc-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000002',
   'Intruder Customer', '+15550100302', 'INT-1')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
do $$
declare
  visible integer;
begin
  set local role authenticated;
  perform public.test_as('aaaaaaaa-0000-4000-8000-000000000001');

  select count(*) into visible from public.customers;
  assert visible = 1, format('owner should see exactly their own customer, saw %s', visible);

  select count(*) into visible
    from public.customers
   where id = 'cccccccc-0000-4000-8000-000000000002';
  assert visible = 0, 'owner must not be able to read another user''s customer';

  raise notice 'PASS  rls: customers are isolated per user';
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  updated integer;
begin
  set local role authenticated;
  perform public.test_as('bbbbbbbb-0000-4000-8000-000000000002');

  update public.customers set notes = 'tampered'
   where id = 'cccccccc-0000-4000-8000-000000000001';
  get diagnostics updated = row_count;
  assert updated = 0, 'a user must not be able to update another user''s customer';

  delete from public.customers where id = 'cccccccc-0000-4000-8000-000000000001';
  get diagnostics updated = row_count;
  assert updated = 0, 'a user must not be able to delete another user''s customer';

  raise notice 'PASS  rls: cross-user writes are rejected';
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform public.test_as('bbbbbbbb-0000-4000-8000-000000000002');

  -- Forging user_id is not enough: the parent customer is checked too.
  begin
    insert into public.follow_ups (user_id, customer_id, due_at)
    values ('bbbbbbbb-0000-4000-8000-000000000002',
            'cccccccc-0000-4000-8000-000000000001',
            now() + interval '1 day');
    raise exception 'expected the follow-up insert to be blocked by RLS';
  exception
    when insufficient_privilege then
      raise notice 'PASS  rls: child rows cannot attach to another user''s customer';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform public.test_as('aaaaaaaa-0000-4000-8000-000000000001');

  -- The browser must not be able to invent an approved inbound command.
  begin
    insert into public.inbound_commands (user_id, channel, is_approved_sender, raw_text)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'whatsapp_text', true, 'mark everyone sold');
    raise exception 'expected the inbound_commands insert to be denied';
  exception
    when insufficient_privilege then
      raise notice 'PASS  grants: inbound commands are server-written only';
  end;

  begin
    insert into public.notification_log (user_id, kind, idempotency_key)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'follow_up_reminder', 'forged');
    raise exception 'expected the notification_log insert to be denied';
  exception
    when insufficient_privilege then
      raise notice 'PASS  grants: notification log is server-written only';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform public.test_as('aaaaaaaa-0000-4000-8000-000000000001');

  insert into public.audit_log (user_id, action, table_name, summary)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'update', 'customers', 'test entry');

  begin
    delete from public.audit_log where user_id = 'aaaaaaaa-0000-4000-8000-000000000001';
    raise exception 'expected the audit log delete to be denied';
  exception
    when insufficient_privilege then
      raise notice 'PASS  audit log is append-only';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform public.test_as('aaaaaaaa-0000-4000-8000-000000000001');

  insert into public.follow_ups (user_id, customer_id, due_at)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
          now() + interval '1 day');

  -- One open commitment per customer, or reminders would double-send.
  begin
    insert into public.follow_ups (user_id, customer_id, due_at)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
            now() + interval '2 days');
    raise exception 'expected the second open follow-up to be rejected';
  exception
    when unique_violation then
      raise notice 'PASS  constraint: only one open follow-up per customer';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform public.test_as('aaaaaaaa-0000-4000-8000-000000000001');

  begin
    insert into public.activities (user_id, customer_id, type, direction)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
            'outbound_call', 'inbound');
    raise exception 'expected the mismatched direction to be rejected';
  exception
    when check_violation then
      raise notice 'PASS  constraint: activity direction must match activity type';
  end;

  begin
    insert into public.activities (user_id, customer_id, type, direction, performed_by_user)
    values ('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
            'note', 'internal', true);
    raise exception 'expected an internal row flagged as a personal attempt to be rejected';
  exception
    when check_violation then
      raise notice 'PASS  constraint: internal activities are never personal attempts';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  reset role;

  begin
    insert into public.inbound_commands (channel, status, is_approved_sender)
    values ('whatsapp_text', 'applied', false);
    raise exception 'expected an applied command from an unapproved sender to be rejected';
  exception
    when check_violation then
      raise notice 'PASS  constraint: only approved senders can reach the applied state';
  end;

  begin
    insert into public.profiles (id, whatsapp_enabled) values
      ('bbbbbbbb-0000-4000-8000-000000000002', true)
    on conflict (id) do update set whatsapp_enabled = true, whatsapp_number_e164 = null;
    raise exception 'expected WhatsApp to be un-enableable without an approved number';
  exception
    when check_violation then
      raise notice 'PASS  constraint: WhatsApp requires an approved number';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  reset role;

  assert public.normalize_phone('+1 (555) 010-0114') = '5550100114',
    'normalize_phone should strip formatting and the US country code';
  assert public.normalize_phone('555.010.0114') = '5550100114',
    'normalize_phone should treat a 10-digit number as already normalized';
  assert public.normalize_phone('') is null, 'normalize_phone should return null for empty input';
  assert public.normalize_email('  Jesus.Ayala@Example.COM ') = 'jesus.ayala@example.com',
    'normalize_email should trim and lowercase';
  assert public.normalize_name('  Jesús   Ayala-Ortíz ') = 'jesus ayala ortiz',
    'normalize_name should fold accents, punctuation and spacing';

  raise notice 'PASS  normalization matches the client implementation';
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  attempted public.contact_method[];
  needing integer;
begin
  reset role;

  -- Screenshot-sourced communication must never count as a personal attempt.
  insert into public.customer_contact_methods (user_id, customer_id, method, value)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
          'phone_call', '+15550100301');
  insert into public.activities (user_id, customer_id, type, direction, method, source, performed_by_user)
  values ('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000001',
          'outbound_call', 'outbound', 'phone_call', 'screenshot', false);

  select methods_attempted into attempted
    from public.customer_contact_summary
   where customer_id = 'cccccccc-0000-4000-8000-000000000001';
  assert attempted = '{}'::public.contact_method[],
    format('screenshot activity must not count as attempted, got %s', attempted);

  raise notice 'PASS  view: screenshot activity is not a personal attempt';

  -- A customer with no open follow-up and no terminal status must surface.
  insert into public.customers (id, user_id, full_name)
  values ('cccccccc-0000-4000-8000-000000000003',
          'aaaaaaaa-0000-4000-8000-000000000001', 'Forgotten Lead');

  select count(*) into needing
    from public.customer_next_action
   where customer_id = 'cccccccc-0000-4000-8000-000000000003'
     and needs_next_action;
  assert needing = 1, 'a customer without a follow-up must appear in the no-next-action queue';

  raise notice 'PASS  view: no-next-action queue catches uncovered customers';
end
$$;

do $$ begin raise notice 'All database tests passed.'; end $$;
