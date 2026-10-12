-- A Slack alert is not a finished call. Staff claim the call and record what happened.

alter table public.lead_jobs drop constraint if exists lead_jobs_status_check;
alter table public.lead_jobs
  add constraint lead_jobs_status_check
  check (status in ('pending', 'sent', 'skipped', 'failed', 'completed'));

alter table public.lead_jobs
  add column if not exists assigned_email text,
  add column if not exists outcome text,
  add column if not exists outcome_note text,
  add column if not exists completed_at timestamptz,
  add column if not exists completed_by text;

alter table public.lead_jobs drop constraint if exists lead_jobs_outcome_check;
alter table public.lead_jobs
  add constraint lead_jobs_outcome_check
  check (
    outcome is null
    or outcome in ('answered', 'no_answer', 'voicemail', 'callback', 'wrong_number', 'not_interested')
  );

create table if not exists public.call_attempts (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  job_id uuid references public.lead_jobs (id) on delete set null,
  outcome text not null,
  note text,
  actor text,
  attempted_at timestamptz not null default now(),
  next_due_at timestamptz
);

create index if not exists call_attempts_lead_idx on public.call_attempts (lead_id, attempted_at desc);
create index if not exists call_attempts_job_idx on public.call_attempts (job_id, attempted_at desc);

alter table public.call_attempts enable row level security;
drop policy if exists call_attempts_select on public.call_attempts;
drop policy if exists call_attempts_insert on public.call_attempts;
create policy call_attempts_select on public.call_attempts for select to authenticated using (true);
create policy call_attempts_insert on public.call_attempts for insert to authenticated with check (true);
grant select, insert on public.call_attempts to authenticated;

create table if not exists public.queue_runs (
  id bigint generated always as identity primary key,
  ran_at timestamptz not null default now(),
  calls_alerted integer not null default 0,
  texts integer not null default 0,
  slack integer not null default 0,
  failed integer not null default 0
);

alter table public.queue_runs enable row level security;
drop policy if exists queue_runs_select on public.queue_runs;
create policy queue_runs_select on public.queue_runs for select to authenticated using (true);
grant select on public.queue_runs to authenticated;
