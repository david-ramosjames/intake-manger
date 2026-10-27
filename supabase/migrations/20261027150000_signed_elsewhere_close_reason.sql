-- Staff can mark a pursued lead lost as "signed elsewhere".
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
      'signed_elsewhere',
      'not_a_lead',
      'outside_practice',
      'data_error'
    )
  );
