-- Quo or a person can mark a call that was never a personal-injury lead.
-- Lost stops follow-up. close_reason tells the list to say "Not a lead".

alter table public.leads
  add column if not exists close_reason text;

alter table public.leads drop constraint if exists leads_close_reason_check;
alter table public.leads
  add constraint leads_close_reason_check
  check (close_reason is null or close_reason in ('not_a_lead'));

comment on column public.leads.close_reason is
  'not_a_lead when Quo or staff closed the lead because it was never a personal-injury matter.';
