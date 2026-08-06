\set ON_ERROR_STOP on

insert into auth.users(id,email) values
 ('44444444-0000-4000-8000-000000000001','phase4@example.test'),
 ('55555555-0000-4000-8000-000000000002','other4@example.test')
on conflict do nothing;
insert into public.profiles(id) values
 ('44444444-0000-4000-8000-000000000001'),
 ('55555555-0000-4000-8000-000000000002')
on conflict do nothing;

do $$
begin
  reset role;
  insert into public.voice_processing_records(
    user_id,provider_message_id,provider_media_id_hash,mime_type,status
  ) values (
    '44444444-0000-4000-8000-000000000001','voice-1',repeat('a',64),'audio/ogg','authorized'
  );
  begin
    insert into public.voice_processing_records(
      user_id,provider_message_id,provider_media_id_hash,mime_type
    ) values (
      '44444444-0000-4000-8000-000000000001','voice-1',repeat('a',64),'audio/ogg'
    );
    raise exception 'expected duplicate voice message to fail';
  exception when unique_violation then
    raise notice 'PASS voice message idempotency';
  end;
end $$;

do $$
declare visible int;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub','55555555-0000-4000-8000-000000000002',true);
  select count(*) into visible from public.voice_processing_records;
  assert visible = 0, 'cross-user voice read leaked';
  begin
    insert into public.voice_processing_records(user_id,provider_message_id)
    values ('55555555-0000-4000-8000-000000000002','forged');
    raise exception 'browser forged voice record';
  exception when insufficient_privilege then
    raise notice 'PASS voice records server-written and cross-user blocked';
  end;
end $$;

do $$
begin
  reset role;
  begin
    update public.profiles set voice_messages_per_day = 101
    where id='44444444-0000-4000-8000-000000000001';
    raise exception 'expected voice limit check';
  exception when check_violation then
    raise notice 'PASS voice cost limits constrained';
  end;
  assert has_function_privilege(
    'anon','public.delete_all_user_data()','EXECUTE'
  ) = false, 'anon can delete data';
  raise notice 'PASS privacy functions unavailable anonymously';
end $$;

do $$ begin raise notice 'All Phase 4 database tests passed.'; end $$;
