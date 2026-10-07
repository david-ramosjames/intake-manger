-- Intake Manager operations: lead kind, CallRail tags, text and call queues,
-- scheduled Slack posts, and the referral tree.
-- Existing call intakes are not enrolled. Follow-up starts from a new Slack
-- lead or when someone turns it on, so historical rows are not texted.

alter table public.leads
  add column if not exists kind text not null default 'pursue',
  add column if not exists arrival text,
  add column if not exists callrail_tags text[] not null default '{}',
  add column if not exists confirmed_at timestamptz,
  add column if not exists confirmed_by text,
  add column if not exists follow_up boolean not null default false,
  add column if not exists slack_message_ts text;

alter table public.leads drop constraint if exists leads_kind_check;
alter table public.leads
  add constraint leads_kind_check check (kind in ('pursue', 'needs_info'));

alter table public.leads drop constraint if exists leads_arrival_check;
alter table public.leads
  add constraint leads_arrival_check check (
    arrival is null or arrival in ('form', 'missed', 'sona', 'human_call', 'qualified_call', 'manual')
  );

create unique index if not exists leads_slack_message_idx
  on public.leads (slack_channel_id, slack_message_ts)
  where slack_message_ts is not null;

create table if not exists public.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  queue text not null check (queue in ('text', 'call')),
  position integer not null check (position > 0),
  delay_minutes integer not null check (delay_minutes >= 0),
  body text not null,
  unique (queue, position)
);

create table if not exists public.lead_jobs (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  queue text not null check (queue in ('text', 'call')),
  position integer not null,
  due_at timestamptz not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  detail text,
  notified_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (lead_id, queue, position)
);

create index if not exists lead_jobs_due_idx
  on public.lead_jobs (status, due_at);

create table if not exists public.slack_posts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  body text not null,
  due_at timestamptz not null,
  mention text,
  status text not null default 'pending' check (status in ('pending', 'posted', 'failed', 'cancelled')),
  detail text,
  created_by text,
  created_at timestamptz not null default now(),
  posted_at timestamptz
);

create index if not exists slack_posts_due_idx
  on public.slack_posts (status, due_at);

create table if not exists public.referral_destinations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  case_types text[] not null default '{}',
  notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.referral_sends (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  destination_id uuid not null references public.referral_destinations (id),
  actor text,
  note text,
  created_at timestamptz not null default now()
);

create table if not exists public.callrail_tags (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  callrail_id text,
  synced_at timestamptz
);

alter table public.sequence_steps enable row level security;
alter table public.lead_jobs enable row level security;
alter table public.slack_posts enable row level security;
alter table public.referral_destinations enable row level security;
alter table public.referral_sends enable row level security;
alter table public.callrail_tags enable row level security;

drop policy if exists sequence_steps_select on public.sequence_steps;
drop policy if exists sequence_steps_write on public.sequence_steps;
drop policy if exists lead_jobs_select on public.lead_jobs;
drop policy if exists lead_jobs_write on public.lead_jobs;
drop policy if exists slack_posts_select on public.slack_posts;
drop policy if exists slack_posts_write on public.slack_posts;
drop policy if exists referral_destinations_select on public.referral_destinations;
drop policy if exists referral_destinations_write on public.referral_destinations;
drop policy if exists referral_sends_select on public.referral_sends;
drop policy if exists referral_sends_write on public.referral_sends;
drop policy if exists callrail_tags_select on public.callrail_tags;
drop policy if exists callrail_tags_write on public.callrail_tags;

create policy sequence_steps_select on public.sequence_steps for select to authenticated using (true);
create policy sequence_steps_write on public.sequence_steps for all to authenticated using (true) with check (true);
create policy lead_jobs_select on public.lead_jobs for select to authenticated using (true);
create policy lead_jobs_write on public.lead_jobs for all to authenticated using (true) with check (true);
create policy slack_posts_select on public.slack_posts for select to authenticated using (true);
create policy slack_posts_write on public.slack_posts for all to authenticated using (true) with check (true);
create policy referral_destinations_select on public.referral_destinations for select to authenticated using (true);
create policy referral_destinations_write on public.referral_destinations for all to authenticated using (true) with check (true);
create policy referral_sends_select on public.referral_sends for select to authenticated using (true);
create policy referral_sends_write on public.referral_sends for all to authenticated using (true) with check (true);
create policy callrail_tags_select on public.callrail_tags for select to authenticated using (true);
create policy callrail_tags_write on public.callrail_tags for all to authenticated using (true) with check (true);

grant select, insert, update, delete on public.sequence_steps to authenticated;
grant select, insert, update, delete on public.lead_jobs to authenticated;
grant select, insert, update, delete on public.slack_posts to authenticated;
grant select, insert, update, delete on public.referral_destinations to authenticated;
grant select, insert, update, delete on public.referral_sends to authenticated;
grant select, insert, update, delete on public.callrail_tags to authenticated;

insert into public.sequence_steps (queue, position, delay_minutes, body)
values
  ('text', 1, 0, 'Hi {{name}}, this is Ramos James Law. We received your {{case_type}} and want to help. Is now a good time to talk?'),
  ('text', 2, 1440, 'Hi {{name}}, just checking in from Ramos James Law about your {{case_type}}. Reply here or call us when you can.'),
  ('text', 3, 2880, 'Hi {{name}}, we still have your {{case_type}} and would like to hear what happened.'),
  ('text', 4, 5760, 'Hi {{name}}, following up one more time on your {{case_type}}. We are here when you are ready.'),
  ('text', 5, 8640, 'Hi {{name}}, this is Ramos James Law. Your {{case_type}} is still open with us if you want to talk.'),
  ('text', 6, 11520, 'Hi {{name}}, we have not heard back about your {{case_type}}. A quick reply is enough if you still want help.'),
  ('text', 7, 17280, 'Hi {{name}}, last note from Ramos James Law about your {{case_type}}. Reply if you would like us to keep this open.'),
  ('call', 1, 0, 'First call. Read the summary, then ask what happened and whether we can help.'),
  ('call', 2, 1440, 'Day 1 call. Confirm the phone number and whether they still want to talk.'),
  ('call', 3, 2880, 'Day 2 call. Ask for the facts that are still missing.'),
  ('call', 4, 5760, 'Day 4 call. Decide if this is a case we can take or a referral.'),
  ('call', 5, 10080, 'Day 7 call. If we still cannot reach them, leave a short voicemail.'),
  ('call', 6, 14400, 'Day 10 call. One more attempt before the sequence ends.'),
  ('call', 7, 18720, 'Day 13 call. Close the loop: sign, refer, or stop.')
on conflict (queue, position) do nothing;

insert into public.referral_destinations (name, phone, case_types, notes)
select
  'Texas Lawyer Referral Service',
  '512-474-0007',
  array['family', 'divorce', 'custody', 'child support', 'criminal', 'immigration'],
  'Statewide referral line for matters this firm does not take.'
where not exists (
  select 1 from public.referral_destinations where name = 'Texas Lawyer Referral Service'
);

insert into public.referral_destinations (name, phone, case_types, notes)
select
  'Central Texas Lawyer Referral',
  '512-472-8303',
  array['other'],
  'Local referral line when the case type is not one this firm handles and no closer match exists.'
where not exists (
  select 1 from public.referral_destinations where name = 'Central Texas Lawyer Referral'
);
