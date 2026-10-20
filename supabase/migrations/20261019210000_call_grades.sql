-- One quality grade per intake call. Quo Router writes the row after the transcript is in.

create table if not exists public.call_grades (
  id uuid primary key default gen_random_uuid(),
  call_id text not null unique,
  lead_id uuid references public.leads (id) on delete set null,
  phone_e164 text,
  handler_id text,
  handler_name text,
  grade text not null,
  score integer,
  reason text,
  track text,
  direction text,
  quo_link text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint call_grades_grade_check check (grade in ('A', 'B', 'C', 'D', 'F')),
  constraint call_grades_score_check check (score is null or (score >= 0 and score <= 100))
);

create index if not exists call_grades_handler_idx
  on public.call_grades (handler_name, occurred_at desc);

create index if not exists call_grades_lead_idx
  on public.call_grades (lead_id, occurred_at desc);

create index if not exists call_grades_phone_idx
  on public.call_grades (phone_e164, occurred_at desc);

alter table public.call_grades enable row level security;

drop policy if exists call_grades_select on public.call_grades;
create policy call_grades_select
  on public.call_grades
  for select
  to authenticated
  using (true);

grant select on public.call_grades to authenticated;
