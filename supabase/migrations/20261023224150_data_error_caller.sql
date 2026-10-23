-- A data error is a bad record, not a bad call. It leaves the work queue
-- under its own caller class and close reason, apart from the non-lead classes.

alter table public.leads drop constraint if exists leads_caller_class_check;
alter table public.leads
  add constraint leads_caller_class_check
  check (
    caller_class is null
    or caller_class in (
      'spam',
      'vendor',
      'employment',
      'existing_client',
      'insurance',
      'other_law_office',
      'wrong_number',
      'return_call',
      'non_pi',
      'data_error'
    )
  );

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
      'outside_practice',
      'data_error'
    )
  );

comment on column public.leads.caller_class is
  'Why a row is outside the work queue. spam through return_call are bad calls. data_error is a bad record, not a bad call. non_pi stays a lead.';
