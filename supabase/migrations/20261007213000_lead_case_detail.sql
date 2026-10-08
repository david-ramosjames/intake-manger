-- The Slack post is the case detail. The sequence is what SMS Follow-Up runs.
alter table public.leads
  add column if not exists case_detail text,
  add column if not exists sequence text;

alter table public.leads drop constraint if exists leads_sequence_check;
alter table public.leads
  add constraint leads_sequence_check
  check (sequence is null or sequence in ('want_to_sign', 'needs_info', 'referral', 'stop'));

create table if not exists public.lead_channel_posts (
  channel_id text not null,
  message_ts text not null,
  lead_id uuid references public.leads (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (channel_id, message_ts)
);

alter table public.lead_channel_posts enable row level security;
