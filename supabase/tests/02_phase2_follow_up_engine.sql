-- ============================================================================
-- Phase 2 database tests: the follow-up engine and the waiting-for-customer
-- lifecycle, plus a re-check that the Phase 1 security controls still hold
-- after the additive migration.
--
-- Run as the `authenticated` role with a JWT subject claim set, so RLS applies
-- exactly as it does through PostgREST.
-- ============================================================================

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('dddddddd-0000-4000-8000-000000000001', 'phase2-owner@example.test'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'phase2-intruder@example.test')
on conflict (id) do nothing;

insert into public.profiles (id, display_name) values
  ('dddddddd-0000-4000-8000-000000000001', 'Phase 2 Owner'),
  ('eeeeeeee-0000-4000-8000-000000000002', 'Phase 2 Intruder')
on conflict (id) do nothing;

insert into public.customers (id, user_id, full_name, lead_status)
values
  ('ffffffff-0000-4000-8000-000000000001', 'dddddddd-0000-4000-8000-000000000001', 'Engine Test', 'working'),
  ('ffffffff-0000-4000-8000-000000000002', 'eeeeeeee-0000-4000-8000-000000000002', 'Other Owner', 'working')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
do $$
declare
  first_id uuid;
  second_id uuid;
  open_count integer;
  previous_status public.follow_up_status;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000001', true);

  first_id := public.schedule_follow_up(
    'ffffffff-0000-4000-8000-000000000001',
    now() + interval '1 day',
    'First commitment'
  );

  -- Replacing an open follow-up must leave exactly one open row, in one
  -- transaction, without tripping the partial unique index.
  second_id := public.schedule_follow_up(
    'ffffffff-0000-4000-8000-000000000001',
    now() + interval '2 days',
    'Second commitment'
  );

  select count(*) into open_count
    from public.follow_ups
   where customer_id = 'ffffffff-0000-4000-8000-000000000001'
     and status in ('pending', 'snoozed', 'overdue', 'waiting_on_customer');
  assert open_count = 1, format('expected one open follow-up, found %s', open_count);

  select status into previous_status from public.follow_ups where id = first_id;
  assert previous_status = 'canceled',
    format('the replaced follow-up should be canceled, was %s', previous_status);

  -- History is walkable: the new row names the one it replaced.
  assert (select rescheduled_from_id from public.follow_ups where id = second_id) = first_id,
    'the replacement should link back to the follow-up it replaced';

  raise notice 'PASS  schedule_follow_up swaps the open follow-up transactionally';
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  closed_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000001', true);

  closed_id := public.close_open_follow_up('ffffffff-0000-4000-8000-000000000001', 'complete', 'Done');
  assert closed_id is not null, 'closing should return the id of the follow-up it closed';

  assert (select status from public.follow_ups where id = closed_id) = 'completed',
    'the follow-up should be completed';
  assert (select completed_at from public.follow_ups where id = closed_id) is not null,
    'a completed follow-up must carry a completion time';

  -- Closing when nothing is open is a no-op rather than an error.
  assert public.close_open_follow_up('ffffffff-0000-4000-8000-000000000001', 'complete', null) is null,
    'closing with nothing open should return null';

  raise notice 'PASS  close_open_follow_up completes and is safe to repeat';
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  needs_action boolean;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000001', true);

  -- Completing without booking the next action is how a lead goes quiet, so the
  -- customer must reappear in the no-next-action queue.
  select cna.needs_next_action into needs_action
    from public.customer_next_action cna
   where cna.customer_id = 'ffffffff-0000-4000-8000-000000000001';

  assert needs_action, 'a completed follow-up must leave the customer needing a next action';

  raise notice 'PASS  completing a follow-up returns the customer to the no-next-action queue';
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  waiting_id uuid;
  expired integer;
  resulting_status public.follow_up_status;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000001', true);

  waiting_id := public.schedule_follow_up(
    'ffffffff-0000-4000-8000-000000000001',
    now() - interval '1 hour',
    'Waiting on the payoff amount',
    'email',
    'normal',
    now() - interval '1 hour'
  );

  assert (select status from public.follow_ups where id = waiting_id) = 'waiting_on_customer',
    'a follow-up with a waiting deadline should be in the waiting state';

  -- Waiting must never be a dead end: a lapsed deadline becomes actionable.
  expired := public.expire_waiting_follow_ups(now());
  assert expired = 1, format('expected one expired waiting follow-up, got %s', expired);

  select status into resulting_status from public.follow_ups where id = waiting_id;
  assert resulting_status = 'overdue',
    format('a lapsed waiting follow-up should become overdue, was %s', resulting_status);
  assert (select waiting_until from public.follow_ups where id = waiting_id) is null,
    'the waiting deadline should be cleared once it has elapsed';

  -- Idempotent, so calling it on every dashboard load is safe.
  assert public.expire_waiting_follow_ups(now()) = 0,
    'expiring again should change nothing';

  raise notice 'PASS  a lapsed waiting deadline returns to the action queue';
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  waiting_id uuid;
  cleared_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000001', true);

  waiting_id := public.schedule_follow_up(
    'ffffffff-0000-4000-8000-000000000001',
    now() + interval '3 days',
    'Waiting on financing',
    null,
    'normal',
    now() + interval '3 days'
  );

  cleared_id := public.clear_waiting_on_response('ffffffff-0000-4000-8000-000000000001', now());
  assert cleared_id = waiting_id, 'responding should clear the waiting follow-up';

  assert (select status from public.follow_ups where id = waiting_id) = 'pending',
    'a customer who responded is no longer someone to wait on';
  assert (select waiting_until from public.follow_ups where id = waiting_id) is null,
    'the waiting deadline should be cleared after a response';
  assert (select due_at from public.follow_ups where id = waiting_id) <= now(),
    'the follow-up should become due immediately so the next decision is asked for';

  raise notice 'PASS  an inbound response clears the waiting state';
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  appointment_id uuid;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000001', true);

  appointment_id := public.schedule_follow_up(
    'ffffffff-0000-4000-8000-000000000001',
    now() + interval '2 days',
    'Saturday walkthrough',
    'in_person',
    'urgent',
    null,
    true
  );

  assert (select is_appointment from public.follow_ups where id = appointment_id),
    'the appointment flag should be recorded';
  assert (
    select is_appointment from public.customer_next_action
     where customer_id = 'ffffffff-0000-4000-8000-000000000001'
  ), 'the view should expose the appointment flag';

  raise notice 'PASS  appointments are marked and visible through the view';
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-4000-8000-000000000002', true);

  -- The functions are security invoker, so RLS still decides what a caller can
  -- touch. Scheduling against someone else's customer must fail.
  begin
    perform public.schedule_follow_up(
      'ffffffff-0000-4000-8000-000000000001',
      now() + interval '1 day',
      'Should not be allowed'
    );
    raise exception 'expected the cross-user schedule to be blocked';
  exception
    when insufficient_privilege then
      raise notice 'PASS  schedule_follow_up cannot reach another user''s customer';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  affected integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'eeeeeeee-0000-4000-8000-000000000002', true);

  -- Closing and expiring are filtered by RLS rather than erroring, so assert
  -- that they simply reach nothing belonging to another user.
  assert public.close_open_follow_up('ffffffff-0000-4000-8000-000000000001', 'cancel', null) is null,
    'closing another user''s follow-up must affect nothing';

  affected := public.expire_waiting_follow_ups(now() + interval '10 years');
  assert affected = 0,
    format('expiring should not touch another user''s rows, affected %s', affected);

  raise notice 'PASS  follow-up functions never reach across users';
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000001', true);

  -- Canceled rows must carry a cancellation time, matching the new constraint.
  begin
    insert into public.follow_ups (user_id, customer_id, due_at, status)
    values ('dddddddd-0000-4000-8000-000000000001', 'ffffffff-0000-4000-8000-000000000001',
            now(), 'canceled');
    raise exception 'expected a canceled follow-up without a timestamp to be rejected';
  exception
    when check_violation then
      raise notice 'PASS  constraint: a canceled follow-up needs a cancellation time';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  reset role;

  -- Phase 2 added settings columns; their bounds are enforced too.
  begin
    update public.profiles set waiting_timeout_hours = 0
     where id = 'dddddddd-0000-4000-8000-000000000001';
    raise exception 'expected an out-of-range waiting timeout to be rejected';
  exception
    when check_violation then
      raise notice 'PASS  constraint: follow-up intervals stay within range';
  end;

  begin
    update public.profiles set date_time_display = 'holographic'
     where id = 'dddddddd-0000-4000-8000-000000000001';
    raise exception 'expected an unknown display preference to be rejected';
  exception
    when check_violation then
      raise notice 'PASS  constraint: date and time display is restricted to known values';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  granted boolean;
begin
  reset role;

  -- The Phase 1 posture must survive the Phase 2 migration: anon reaches
  -- nothing, and the new functions are not executable anonymously.
  select bool_or(has_table_privilege('anon', c.oid, 'SELECT'))
    into granted
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v');
  assert coalesce(granted, false) = false, 'anon must not be able to read anything in public';

  assert has_function_privilege('anon', 'public.expire_waiting_follow_ups(timestamptz)', 'EXECUTE') = false,
    'anon must not be able to execute the follow-up functions';
  assert has_function_privilege('authenticated', 'public.expire_waiting_follow_ups(timestamptz)', 'EXECUTE'),
    'the authenticated role should be able to execute the follow-up functions';

  raise notice 'PASS  Phase 1 security posture is unchanged by the Phase 2 migration';
end
$$;

do $$ begin raise notice 'All Phase 2 database tests passed.'; end $$;
