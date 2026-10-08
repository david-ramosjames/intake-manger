-- Jaymie marks the leads Jon should see, with the note she used to send by hand.
alter table public.leads
  add column if not exists priority boolean not null default false,
  add column if not exists priority_reason text,
  add column if not exists last_action text,
  add column if not exists next_action text;

alter table public.leads drop constraint if exists leads_priority_reason_check;
alter table public.leads
  add constraint leads_priority_reason_check
  check (
    priority_reason is null
    or priority_reason in ('contract_out', 'send_contract', 'high_potential')
  );

create index if not exists leads_priority_open_idx
  on public.leads (priority)
  where priority and signed_case = false and case_id is null;
