-- Jukevibe initial schema.
-- All access goes through the Next.js API using the Supabase secret key.
-- RLS is enabled on every table with no policies, so the public/anon key can read nothing.

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null default 'Jukevibe',
  mode text not null default 'car' check (mode in ('car', 'party')),
  host_display_name text,
  skip_ratio numeric not null default 0.5 check (skip_ratio > 0 and skip_ratio <= 1),
  max_pending_per_guest int not null default 2 check (max_pending_per_guest between 1 and 10),
  voting_open boolean not null default true,
  now_playing jsonb,
  locked_request_id uuid,
  last_skipped_track_id text,
  created_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  ended_at timestamptz
);

-- Host secrets: Spotify tokens and the host cookie hash. Never sent to clients.
create table public.room_secrets (
  room_id uuid primary key references public.rooms (id) on delete cascade,
  host_token_hash text not null,
  spotify_user_id text not null,
  spotify_access_token text not null,
  spotify_refresh_token text not null,
  token_expires_at timestamptz not null,
  last_tick_at timestamptz
);

create table public.guests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 24),
  is_host boolean not null default false,
  genre_vote text,
  token_hash text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index guests_room_idx on public.guests (room_id, last_seen_at);

create table public.requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  guest_id uuid references public.guests (id) on delete set null,
  track_id text not null,
  uri text not null,
  name text not null,
  artists text not null,
  image text,
  duration_ms int,
  source text not null default 'guest' check (source in ('guest', 'genre')),
  status text not null default 'pending' check (status in ('pending', 'queued', 'played', 'removed')),
  created_at timestamptz not null default now(),
  queued_at timestamptz,
  played_at timestamptz
);
create index requests_room_status_idx on public.requests (room_id, status);

alter table public.rooms
  add constraint rooms_locked_request_fk
  foreign key (locked_request_id) references public.requests (id) on delete set null;

create table public.votes (
  request_id uuid not null references public.requests (id) on delete cascade,
  guest_id uuid not null references public.guests (id) on delete cascade,
  room_id uuid not null references public.rooms (id) on delete cascade,
  value smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  primary key (request_id, guest_id)
);
create index votes_room_idx on public.votes (room_id);

create table public.skip_votes (
  room_id uuid not null references public.rooms (id) on delete cascade,
  track_id text not null,
  guest_id uuid not null references public.guests (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (room_id, track_id, guest_id)
);

alter table public.rooms enable row level security;
alter table public.room_secrets enable row level security;
alter table public.guests enable row level security;
alter table public.requests enable row level security;
alter table public.votes enable row level security;
alter table public.skip_votes enable row level security;

revoke all on public.rooms, public.room_secrets, public.guests, public.requests, public.votes, public.skip_votes
  from anon, authenticated;

-- Atomically claim the right to run the queue engine for a room (at most once per interval).
create or replace function public.claim_tick(p_room_id uuid, p_interval_seconds int default 4)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with claimed as (
    update public.room_secrets
    set last_tick_at = now()
    where room_id = p_room_id
      and (last_tick_at is null or last_tick_at < now() - make_interval(secs => p_interval_seconds))
    returning 1
  )
  select exists (select 1 from claimed);
$$;

-- Atomically claim the right to skip a given track (prevents double skips).
create or replace function public.claim_skip(p_room_id uuid, p_track_id text)
returns boolean
language sql
security invoker
set search_path = ''
as $$
  with claimed as (
    update public.rooms
    set last_skipped_track_id = p_track_id
    where id = p_room_id
      and last_skipped_track_id is distinct from p_track_id
    returning 1
  )
  select exists (select 1 from claimed);
$$;

revoke execute on function public.claim_tick(uuid, int) from public, anon, authenticated;
revoke execute on function public.claim_skip(uuid, text) from public, anon, authenticated;
grant execute on function public.claim_tick(uuid, int) to service_role;
grant execute on function public.claim_skip(uuid, text) to service_role;
