-- Inbox calls used for the dashboard answer rate. The line rules match the
-- Quo reporter Call Stats email: drop Extra Number, SA Law Firm, and
-- Trucking Chicas, and leave incoming calls on RJL Outbound out of the rate.

create table if not exists public.quo_inbox_calls (
  id text primary key,
  call_id text not null,
  line_name text not null,
  direction text not null default '',
  status text not null default '',
  answered_by text,
  ai_handled boolean not null default false,
  created_at timestamptz not null,
  synced_at timestamptz not null default now()
);

create index if not exists quo_inbox_calls_created_idx
  on public.quo_inbox_calls (created_at);

alter table public.quo_inbox_calls enable row level security;

drop policy if exists quo_inbox_calls_select on public.quo_inbox_calls;
create policy quo_inbox_calls_select
  on public.quo_inbox_calls
  for select
  to authenticated
  using (true);

grant select on public.quo_inbox_calls to authenticated;

create table if not exists public.quo_inbox_sync (
  id text primary key,
  window_start timestamptz,
  request_token text,
  pair_index integer not null default 0,
  finished_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.quo_inbox_sync enable row level security;
