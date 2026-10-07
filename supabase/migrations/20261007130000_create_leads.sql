-- Intake Manager v1: the lead cockpit record.
-- Call intakes are imported once. Later services attach by intake_call_id or phone.
-- Signed (the client signed) is separate from case_id (staff promoted the intake).

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  lead_date date,
  lead_name text,
  phone text,
  phone_e164 text,
  email text,
  lead_source text,
  source_type text,
  case_type text,
  lead_status text not null default 'New',
  consultation text,
  consultation_date date,
  desired_case boolean,
  signed_case boolean not null default false,
  case_number text,
  date_signed date,
  grade text,
  grade_reason text,
  qualified boolean,
  quo_link text,
  intake_call_id text,
  case_id uuid references public.cases (id) on delete set null,
  slack_channel_id text,
  slack_thread_ts text,
  slack_permalink text,
  signflow_request_id text,
  callrail_account_id text,
  callrail_person_id text,
  callrail_call_id text,
  summary text,
  owner_name text,
  signed_at timestamptz,
  form_fill_closed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_grade_check check (grade is null or grade in ('A', 'B', 'C')),
  constraint leads_intake_call_id_key unique (intake_call_id)
);

create index if not exists leads_phone_e164_idx on public.leads (phone_e164) where phone_e164 is not null;
create index if not exists leads_status_idx on public.leads (lead_status);
create index if not exists leads_signed_open_idx on public.leads (signed_case, case_id);
create index if not exists leads_lead_date_idx on public.leads (lead_date desc nulls last);

create table if not exists public.lead_events (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.leads (id) on delete cascade,
  event_type text not null,
  actor text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists lead_events_lead_idx on public.lead_events (lead_id, created_at desc);

create or replace function public.set_leads_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

revoke all on function public.set_leads_updated_at() from public, anon, authenticated;

drop trigger if exists leads_set_updated_at on public.leads;
create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_leads_updated_at();

alter table public.leads enable row level security;
alter table public.lead_events enable row level security;

drop policy if exists leads_select on public.leads;
drop policy if exists leads_insert on public.leads;
drop policy if exists leads_update on public.leads;
drop policy if exists lead_events_select on public.lead_events;
drop policy if exists lead_events_insert on public.lead_events;

create policy leads_select on public.leads for select to authenticated using (true);
create policy leads_insert on public.leads for insert to authenticated with check (true);
create policy leads_update on public.leads for update to authenticated using (true) with check (true);
create policy lead_events_select on public.lead_events for select to authenticated using (true);
create policy lead_events_insert on public.lead_events for insert to authenticated with check (true);

grant select, insert, update on public.leads to authenticated;
grant select, insert on public.lead_events to authenticated;

comment on table public.leads is
  'Intake cockpit lead. Signed means the client signed. case_id is set later, when staff promote the intake to a Docket case.';
comment on column public.leads.signed_case is
  'True when the client has signed. Does not mean the intake has been promoted.';
comment on column public.leads.form_fill_closed_at is
  'Quo Router should stop merging new facts into the intake form after this time.';

-- One lead per existing Quo call intake. Do not guess "signed" from free-text representation dates.
insert into public.leads (
  lead_date,
  lead_name,
  phone,
  phone_e164,
  email,
  lead_source,
  source_type,
  lead_status,
  case_number,
  quo_link,
  intake_call_id,
  case_id,
  slack_permalink,
  summary
)
select
  i.created_at::date,
  nullif(btrim(i.name), ''),
  nullif(btrim(i.phone), ''),
  case
    when length(digits) = 10 then '+1' || digits
    when length(digits) = 11 and left(digits, 1) = '1' then '+' || digits
    else null
  end,
  nullif(btrim(i.email), ''),
  nullif(btrim(i.how_found), ''),
  'Call',
  case when i.case_id is not null then 'Promoted' else 'New' end,
  nullif(btrim(c.case_number), ''),
  nullif(btrim(i.quo_link), ''),
  i.call_id,
  i.case_id,
  nullif(btrim(i.slack_permalink), ''),
  nullif(left(btrim(coalesce(i.accident_description, i.notes)), 2000), '')
from public.intakes i
left join public.cases c on c.id = i.case_id
cross join lateral (
  select regexp_replace(coalesce(i.phone, ''), '\D', '', 'g') as digits
) p
where i.call_id is not null
on conflict (intake_call_id) do nothing;

insert into public.lead_events (lead_id, event_type, actor, payload)
select l.id, 'imported', 'system', jsonb_build_object('from', 'intakes', 'intake_call_id', l.intake_call_id)
from public.leads l
where l.intake_call_id is not null
  and not exists (
    select 1 from public.lead_events e
    where e.lead_id = l.id and e.event_type = 'imported'
  );
