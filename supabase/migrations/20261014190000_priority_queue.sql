-- Priority is a contract that is out, a person flagging the lead, or an AI suggestion waiting to be confirmed.
alter table public.leads
  drop constraint if exists leads_priority_reason_check;

alter table public.leads
  add column if not exists priority_suggestion text,
  add column if not exists priority_suggestion_dismissed boolean not null default false;

comment on column public.leads.priority_reason is
  'Why a person flagged this lead. Free text, such as a promising web form or a high-quality referral.';

comment on column public.leads.priority_suggestion is
  'An AI recommendation that this lead should be priority. It is not on the list until a person confirms it.';
