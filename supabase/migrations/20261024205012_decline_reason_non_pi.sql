-- Decline reasons added after the original check: Non-PI, outside the
-- service area, and workers comp. The app writes the text after "DEC: ".
alter table public.leads drop constraint if exists leads_decline_reason_check;
alter table public.leads
  add constraint leads_decline_reason_check
  check (
    decline_reason is null
    or decline_reason in (
      'At Fault / Bad Facts',
      'Has Attorney',
      'Medmal',
      'No Injury / Property Damage',
      'No Insurance',
      'Non-PI Legal Matter',
      'Outside Service Area',
      'Referred',
      'Statue Issue',
      'Workers Comp'
    )
  );
