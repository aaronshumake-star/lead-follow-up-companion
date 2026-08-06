-- ============================================================================
-- Phase 3 database tests: notification idempotency and the atomic claim,
-- clarification sessions, usage metering, screenshot intake constraints, and a
-- re-check that the Phase 1 and Phase 2 security controls still hold.
--
-- The claim is the important one. The one-open-follow-up index prevents
-- duplicate follow-up *records*; these assertions cover the separate mechanism
-- that prevents duplicate *sends*.
-- ============================================================================

\set ON_ERROR_STOP on

insert into auth.users (id, email) values
  ('11111111-0000-4000-8000-000000000001', 'phase3-owner@example.test'),
  ('22222222-0000-4000-8000-000000000002', 'phase3-other@example.test')
on conflict (id) do nothing;

insert into public.profiles (id, display_name) values
  ('11111111-0000-4000-8000-000000000001', 'Phase 3 Owner'),
  ('22222222-0000-4000-8000-000000000002', 'Phase 3 Other')
on conflict (id) do nothing;

insert into public.customers (id, user_id, full_name, lead_status)
values ('33333333-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', 'Intake Test', 'working')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
do $$
declare
  first_claim uuid;
  second_claim uuid;
begin
  reset role;

  first_claim := public.claim_notification(
    '11111111-0000-4000-8000-000000000001',
    'due_now:follow-up-1:2026-08-05T15:00:00Z',
    'follow_up_reminder',
    'due_now'
  );
  assert first_claim is not null, 'the first claim should succeed';

  -- The same logical message, claimed again: a concurrent run or a scheduler
  -- retry must lose the race rather than send a second copy.
  second_claim := public.claim_notification(
    '11111111-0000-4000-8000-000000000001',
    'due_now:follow-up-1:2026-08-05T15:00:00Z',
    'follow_up_reminder',
    'due_now'
  );
  assert second_claim is null, 'claiming the same key twice must return null';

  assert (select count(*) from public.notification_log
           where idempotency_key = 'due_now:follow-up-1:2026-08-05T15:00:00Z') = 1,
    'only one notification row should exist for one idempotency key';

  raise notice 'PASS  notification claim is atomic and single-winner';
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  other_claim uuid;
begin
  reset role;

  -- The key is scoped per user, so two accounts never collide with each other.
  other_claim := public.claim_notification(
    '22222222-0000-4000-8000-000000000002',
    'due_now:follow-up-1:2026-08-05T15:00:00Z',
    'follow_up_reminder',
    'due_now'
  );
  assert other_claim is not null, 'a different user should be able to claim the same key';

  raise notice 'PASS  idempotency keys are scoped per user';
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  claimed uuid;
  final_status public.notification_status;
begin
  reset role;

  claimed := public.claim_notification(
    '11111111-0000-4000-8000-000000000001',
    'due_now:follow-up-2:2026-08-05T15:00:00Z',
    'follow_up_reminder',
    'due_now'
  );

  perform public.record_notification_result(claimed, 'failed', null, false, 'Provider rejected', true, null);

  select status into final_status from public.notification_log where id = claimed;
  assert final_status = 'failed', 'the failure should be recorded';
  assert (select permanent_failure from public.notification_log where id = claimed),
    'a permanent failure should stay marked so it remains visible';
  assert (select attempt_count from public.notification_log where id = claimed) = 1,
    'the attempt should be counted';

  raise notice 'PASS  a permanent failure is recorded and stays visible';
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  claimed uuid;
begin
  reset role;

  claimed := public.claim_notification(
    '11111111-0000-4000-8000-000000000001',
    'attempt-cap-test',
    'follow_up_reminder',
    'overdue'
  );

  -- The cap matches the notification_log attempt_count constraint, so a
  -- provider outage cannot bill in a loop.
  perform public.record_notification_result(claimed, 'failed', null, false, 'e', false, now());
  perform public.record_notification_result(claimed, 'failed', null, false, 'e', false, now());
  perform public.record_notification_result(claimed, 'failed', null, false, 'e', false, now());
  perform public.record_notification_result(claimed, 'failed', null, false, 'e', false, now());

  assert (select attempt_count from public.notification_log where id = claimed) = 3,
    'attempts should be capped at three';

  raise notice 'PASS  send attempts are capped';
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000001', true);

  -- The browser must never be able to forge a send or claim one.
  begin
    perform public.claim_notification(
      '11111111-0000-4000-8000-000000000001', 'forged', 'follow_up_reminder', 'due_now'
    );
    raise exception 'expected the claim to be denied to the browser';
  exception
    when insufficient_privilege then
      raise notice 'PASS  grants: only the service role may claim a notification';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  visible integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '22222222-0000-4000-8000-000000000002', true);

  select count(*) into visible
    from public.notification_log
   where user_id = '11111111-0000-4000-8000-000000000001';
  assert visible = 0, 'a user must not see another user''s notifications';

  select count(*) into visible from public.usage_events;
  assert visible = 0, 'usage events start isolated per user';

  raise notice 'PASS  rls: notifications and usage are isolated per user';
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000001', true);

  -- In-browser OCR runs on the client, so the client records its own usage.
  insert into public.usage_events (user_id, kind, quantity, estimated_cost_usd)
  values ('11111111-0000-4000-8000-000000000001', 'ocr_job', 1, 0);

  assert (select count(*) from public.usage_events) = 1, 'the owner should see their usage event';

  begin
    insert into public.usage_events (user_id, kind)
    values ('22222222-0000-4000-8000-000000000002', 'message_sent');
    raise exception 'expected a cross-user usage insert to be rejected';
  exception
    when insufficient_privilege then
      raise notice 'PASS  rls: usage events cannot be written for another user';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  reset role;

  insert into public.clarification_sessions (user_id, kind, prompt, expires_at)
  values ('11111111-0000-4000-8000-000000000001', 'select_customer', 'Which customer?', now() + interval '30 minutes');

  -- A second open question would make a bare "1" ambiguous all over again.
  begin
    insert into public.clarification_sessions (user_id, kind, prompt, expires_at)
    values ('11111111-0000-4000-8000-000000000001', 'select_customer', 'Another?', now() + interval '30 minutes');
    raise exception 'expected the second open clarification to be rejected';
  exception
    when unique_violation then
      raise notice 'PASS  constraint: only one open clarification per user';
  end;

  -- Resolving one frees the slot.
  update public.clarification_sessions
     set resolved_at = now(), resolution = 'applied'
   where user_id = '11111111-0000-4000-8000-000000000001' and resolved_at is null;

  insert into public.clarification_sessions (user_id, kind, prompt, expires_at)
  values ('11111111-0000-4000-8000-000000000001', 'select_customer', 'Next?', now() + interval '30 minutes');

  raise notice 'PASS  a resolved clarification frees the slot';
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  reset role;

  -- An expiry is mandatory: a question that never expires would silently
  -- capture an unrelated reply weeks later.
  begin
    insert into public.clarification_sessions (user_id, kind, prompt, expires_at)
    values ('22222222-0000-4000-8000-000000000002', 'select_customer', 'Bad', now() - interval '1 minute');
    raise exception 'expected an expiry in the past to be rejected';
  exception
    when check_violation then
      raise notice 'PASS  constraint: a clarification must expire in the future';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000001', true);

  -- Duplicate detection is a unique index on the hash, not application code.
  insert into public.screenshots (user_id, file_hash, mime_type, byte_size, decision, overall_confidence)
  values ('11111111-0000-4000-8000-000000000001', repeat('c3', 32), 'image/png', 12345, 'auto_create', 0.9);

  begin
    insert into public.screenshots (user_id, file_hash, mime_type, byte_size)
    values ('11111111-0000-4000-8000-000000000001', repeat('c3', 32), 'image/png', 12345);
    raise exception 'expected a duplicate screenshot hash to be rejected';
  exception
    when unique_violation then
      raise notice 'PASS  constraint: a screenshot hash is unique per user';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000001', true);

  -- Filenames are only ever displayed, so anything path-like is refused.
  begin
    insert into public.screenshots (user_id, file_hash, mime_type, byte_size, original_filename)
    values ('11111111-0000-4000-8000-000000000001', repeat('c4', 32), 'image/png', 100, '../../etc/passwd');
    raise exception 'expected a path-like filename to be rejected';
  exception
    when check_violation then
      raise notice 'PASS  constraint: screenshot filenames cannot contain a path';
  end;

  begin
    insert into public.screenshots (user_id, file_hash, mime_type, byte_size)
    values ('11111111-0000-4000-8000-000000000001', repeat('c5', 32), 'image/gif', 100);
    raise exception 'expected an unsupported mime type to be rejected';
  exception
    when check_violation then
      raise notice 'PASS  constraint: only PNG, JPEG and WEBP are accepted';
  end;

  begin
    insert into public.screenshots (user_id, file_hash, mime_type, byte_size, retained)
    values ('11111111-0000-4000-8000-000000000001', repeat('c6', 32), 'image/png', 100, true);
    raise exception 'expected retention without a stored path to be rejected';
  exception
    when check_violation then
      raise notice 'PASS  constraint: retention requires a stored image';
  end;
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  queued integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000001', true);

  update public.screenshots
     set status = 'needs_review'
   where user_id = '11111111-0000-4000-8000-000000000001' and file_hash = repeat('c3', 32);

  select count(*) into queued from public.screenshot_review_queue;
  assert queued = 1, format('the review queue should contain one item, found %s', queued);

  raise notice 'PASS  view: the review queue exposes screenshots needing a person';
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  total numeric;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '11111111-0000-4000-8000-000000000001', true);

  insert into public.usage_events (user_id, kind, quantity, estimated_cost_usd)
  values ('11111111-0000-4000-8000-000000000001', 'message_sent', 2, 0.03);

  select sum(total_cost_usd) into total from public.monthly_usage_summary;
  assert total = 0.03, format('the cost meter should total 0.03, got %s', total);

  raise notice 'PASS  view: monthly usage totals measured cost';
end
$$;

-- ---------------------------------------------------------------------------
do $$
declare
  granted boolean;
begin
  reset role;

  -- The Phase 1 and Phase 2 posture must survive the Phase 3 migration.
  select bool_or(has_table_privilege('anon', c.oid, 'SELECT'))
    into granted
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'v');
  assert coalesce(granted, false) = false, 'anon must not be able to read anything in public';

  assert has_table_privilege('authenticated', 'public.clarification_sessions', 'INSERT') = false,
    'clarification sessions must be server-written only';
  assert has_table_privilege('authenticated', 'public.notification_log', 'INSERT') = false,
    'the notification log must stay server-written only';
  assert has_table_privilege('authenticated', 'public.usage_events', 'INSERT'),
    'the client records its own in-browser OCR usage';

  raise notice 'PASS  Phase 1 and Phase 2 security posture is unchanged by Phase 3';
end
$$;

do $$ begin raise notice 'All Phase 3 database tests passed.'; end $$;
