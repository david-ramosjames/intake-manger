-- Open or closed follows lead_status. close_reason says why a lead left the funnel.
-- close_suggestion is an AI proposal that stays open until a person confirms it.

alter table public.leads
  add column if not exists close_suggestion text;

alter table public.leads drop constraint if exists leads_close_reason_check;
alter table public.leads
  add constraint leads_close_reason_check
  check (
    close_reason is null
    or close_reason in (
      'signed',
      'declined',
      'referred',
      'not_interested',
      'no_response',
      'not_a_lead',
      'outside_practice'
    )
  );

alter table public.leads drop constraint if exists leads_close_suggestion_check;
alter table public.leads
  add constraint leads_close_suggestion_check
  check (
    close_suggestion is null
    or close_suggestion in ('decline', 'not_interested', 'not_a_lead')
  );

comment on column public.leads.close_suggestion is
  'AI proposal to close the lead. The lead stays open until a person confirms or dismisses it.';
