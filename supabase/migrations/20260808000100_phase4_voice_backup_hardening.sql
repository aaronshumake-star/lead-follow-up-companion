-- Phase 4: privacy-conscious voice processing and operational diagnostics.
-- Additive only; every existing policy and constraint remains intact.

create type public.voice_processing_status as enum (
  'received', 'authorized', 'media_fetching', 'media_downloaded',
  'transcribing', 'transcribed', 'parsing', 'clarification_required',
  'applied', 'rejected', 'failed', 'deleted'
);

create type public.voice_failure_classification as enum (
  'temporary_download', 'permanent_download', 'unsupported_media',
  'oversized', 'duration_exceeded', 'corrupt_media', 'transcription_disabled',
  'temporary_transcription', 'permanent_transcription', 'timeout',
  'low_confidence', 'unsupported_command', 'database_failure', 'confirmation_failure'
);

create table public.voice_processing_records (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  inbound_command_id uuid references public.inbound_commands(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  provider_message_id text not null,
  provider_media_id_hash text,
  provider text not null default 'whatsapp_cloud',
  transcription_provider text,
  transcription_request_id text,
  mime_type text,
  declared_size integer,
  actual_size integer,
  duration_seconds integer,
  detected_language text,
  transcript_preview text,
  transcript_confidence numeric(4,3),
  parsed_intent text,
  status public.voice_processing_status not null default 'received',
  failure_classification public.voice_failure_classification,
  failure_summary text,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz,
  audio_storage_path text,
  audio_purge_after timestamptz,
  audio_deleted_at timestamptz,
  simulated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint voice_message_unique unique(provider, provider_message_id),
  constraint voice_hash_shape check (provider_media_id_hash is null or provider_media_id_hash ~ '^[0-9a-f]{64}$'),
  constraint voice_mime_allowed check (mime_type is null or mime_type in (
    'audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/aac',
    'audio/amr', 'audio/3gpp', 'audio/webm', 'audio/wav'
  )),
  constraint voice_size_range check (actual_size is null or actual_size between 1 and 26214400),
  constraint voice_duration_range check (duration_seconds is null or duration_seconds between 0 and 600),
  constraint voice_confidence_range check (transcript_confidence is null or transcript_confidence between 0 and 1),
  constraint voice_preview_length check (transcript_preview is null or length(transcript_preview) <= 500),
  constraint voice_attempt_cap check (attempt_count between 0 and 3),
  constraint voice_failure_length check (failure_summary is null or length(failure_summary) <= 500)
);

create trigger voice_processing_set_updated_at before update on public.voice_processing_records
for each row execute function public.set_updated_at();

create index voice_processing_user_created_idx
  on public.voice_processing_records(user_id, created_at desc);
create index voice_processing_retry_idx
  on public.voice_processing_records(next_attempt_at)
  where status = 'failed' and next_attempt_at is not null;
create index voice_processing_purge_idx
  on public.voice_processing_records(audio_purge_after)
  where audio_storage_path is not null and audio_deleted_at is null;

alter table public.voice_processing_records enable row level security;
revoke all on public.voice_processing_records from anon, public;
grant select, delete on public.voice_processing_records to authenticated;
create policy "voice records: owner can read"
  on public.voice_processing_records for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "voice records: owner can delete retained audio metadata"
  on public.voice_processing_records for delete to authenticated
  using ((select auth.uid()) = user_id);

alter table public.profiles
  add column voice_messages_per_day integer not null default 20,
  add column transcription_confidence_threshold numeric(4,3) not null default 0.65,
  add column failed_audio_retention_hours integer not null default 24,
  add column retain_failed_transcripts boolean not null default false,
  add constraint profiles_voice_messages_daily_range check (voice_messages_per_day between 0 and 100),
  add constraint profiles_transcription_confidence_range check (transcription_confidence_threshold between 0 and 1),
  add constraint profiles_failed_audio_retention_range check (failed_audio_retention_hours between 0 and 168);

alter type public.usage_event_kind add value if not exists 'voice_message_received';
alter type public.usage_event_kind add value if not exists 'audio_minute_processed';
alter type public.usage_event_kind add value if not exists 'transcription_request';
alter type public.usage_event_kind add value if not exists 'transcription_failed';
alter type public.usage_event_kind add value if not exists 'transcription_retry';
alter type public.usage_event_kind add value if not exists 'audio_retained';

create view public.operational_diagnostics
with (security_invoker = on) as
select
  p.id as user_id,
  (select max(created_at) from public.inbound_commands i where i.user_id = p.id and i.is_approved_sender) as last_successful_webhook,
  (select max(created_at) from public.audit_log a where a.user_id = p.id and a.action = 'access_denied') as last_rejected_webhook,
  (select max(sent_at) from public.notification_log n where n.user_id = p.id) as last_reminder_send,
  (select max(created_at) from public.voice_processing_records v where v.user_id = p.id and v.status in ('transcribed','applied')) as last_transcription,
  (select max(created_at) from public.voice_processing_records v where v.user_id = p.id and v.status = 'failed') as last_voice_failure,
  (select count(*) from public.notification_log n where n.user_id = p.id and n.permanent_failure) as permanent_failures,
  (select count(*) from public.notification_log n where n.user_id = p.id and n.next_attempt_at is not null) as pending_retries,
  (select count(*) from public.screenshots s where s.user_id = p.id and s.retained) as retained_screenshots,
  (select count(*) from public.voice_processing_records v where v.user_id = p.id and v.audio_storage_path is not null and v.audio_deleted_at is null) as retained_audio
from public.profiles p;
grant select on public.operational_diagnostics to authenticated;

-- Service-only creation/update; browser can read and request deletion only.
revoke insert, update on public.voice_processing_records from authenticated;
grant all on public.voice_processing_records to service_role;

-- Privacy cleanup. SECURITY INVOKER keeps RLS in force for browser calls.
create or replace function public.delete_old_private_diagnostics(
  p_before timestamptz,
  p_delete_transcripts boolean default true
) returns integer language plpgsql security invoker set search_path = '' as $$
declare affected integer := 0;
begin
  update public.voice_processing_records
     set transcript_preview = case when p_delete_transcripts then null else transcript_preview end,
         failure_summary = null,
         audio_storage_path = null,
         audio_deleted_at = coalesce(audio_deleted_at, now()),
         status = case when status = 'failed' then 'deleted' else status end
   where user_id = (select auth.uid()) and created_at < p_before;
  get diagnostics affected = row_count;
  delete from public.clarification_sessions
   where user_id = (select auth.uid()) and expires_at < p_before;
  update public.notification_log set payload_summary = null, error = null
   where user_id = (select auth.uid()) and created_at < p_before;
  return affected;
end $$;
revoke execute on function public.delete_old_private_diagnostics(timestamptz, boolean) from public, anon;
grant execute on function public.delete_old_private_diagnostics(timestamptz, boolean) to authenticated;

-- Deletes application data but deliberately leaves auth.users and profiles.
create or replace function public.delete_all_user_data()
returns void language plpgsql security invoker set search_path = '' as $$
declare uid uuid := (select auth.uid());
begin
  if uid is null then raise exception 'authentication required'; end if;
  delete from public.voice_processing_records where user_id = uid;
  delete from public.clarification_sessions where user_id = uid;
  delete from public.notification_log where user_id = uid;
  delete from public.usage_events where user_id = uid;
  delete from public.screenshots where user_id = uid;
  delete from public.audit_log where user_id = uid;
  delete from public.customers where user_id = uid;
end $$;
revoke execute on function public.delete_all_user_data() from public, anon;
grant execute on function public.delete_all_user_data() to authenticated;
