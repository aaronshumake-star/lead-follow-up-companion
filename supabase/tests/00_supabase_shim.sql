-- ============================================================================
-- Local-only shim that recreates the parts of a Supabase project the
-- migrations depend on (the auth schema, auth.uid(), and the anon /
-- authenticated / service_role roles).
--
-- This file is NOT a migration and must never be applied to a real project —
-- Supabase already provides all of it. It exists so `npm run test:db` can
-- replay the migrations against a plain PostgreSQL instance.
-- ============================================================================

create schema if not exists extensions;
create schema if not exists auth;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

create extension if not exists "pgcrypto" with schema extensions;

create table if not exists auth.users (
  id uuid primary key default extensions.gen_random_uuid(),
  email text unique,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Supabase derives auth.uid() from the request JWT. Locally we read a GUC that
-- the test harness sets, which lets tests impersonate a user.
create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

-- Supabase puts pgcrypto in the extensions schema and exposes gen_random_uuid()
-- unqualified; mirror that so migrations can call it without a schema prefix.
create or replace function public.gen_random_uuid()
returns uuid
language sql
volatile
as $$
  select extensions.gen_random_uuid()
$$;
