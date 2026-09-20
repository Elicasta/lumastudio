-- LumaRig Studio remote session registry.
-- Client roles receive no table policies. All privileged access happens in the
-- lumarig-remote-session Edge Function with the Supabase server secret.

create table if not exists public.lumarig_remote_sessions (
  id uuid primary key default gen_random_uuid(),
  studio_id uuid not null,
  studio_name text not null default 'LumaRig Studio',
  pair_code text not null,
  room_token text not null,
  studio_token_hash text not null,
  created_at timestamptz not null default now(),
  pair_expires_at timestamptz not null default (now() + interval '10 minutes'),
  expires_at timestamptz not null default (now() + interval '12 hours'),
  last_seen_at timestamptz not null default now(),
  paired_count integer not null default 0 check (paired_count >= 0),
  active boolean not null default true
);

create unique index if not exists lumarig_remote_sessions_active_pair_code_idx
  on public.lumarig_remote_sessions (pair_code)
  where active = true;

create index if not exists lumarig_remote_sessions_studio_id_idx
  on public.lumarig_remote_sessions (studio_id, active);

create index if not exists lumarig_remote_sessions_expiry_idx
  on public.lumarig_remote_sessions (active, expires_at);

alter table public.lumarig_remote_sessions enable row level security;
revoke all on table public.lumarig_remote_sessions from anon, authenticated;

create table if not exists public.lumarig_remote_pair_attempts (
  id bigint generated always as identity primary key,
  fingerprint text not null,
  attempted_at timestamptz not null default now(),
  success boolean not null default false
);

create index if not exists lumarig_remote_pair_attempts_rate_idx
  on public.lumarig_remote_pair_attempts (fingerprint, attempted_at desc);

alter table public.lumarig_remote_pair_attempts enable row level security;
revoke all on table public.lumarig_remote_pair_attempts from anon, authenticated;
