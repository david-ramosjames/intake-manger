-- Allow the renamed decline reason. The previous wording stays valid so a
-- save from the current site still succeeds until the new label is deployed.
alter table public.leads drop constraint if exists leads_decline_reason_check;
alter table public.leads
  add constraint leads_decline_reason_check
  check (
    decline_reason is null
    or decline_reason in (
      'At Fault / Bad Facts',
      'Has Attorney',
      'Medmal',
      'Minor Injury / Property Damage',
      'No Injury / Property Damage',
      'No Insurance',
      'Non-PI Legal Matter',
      'Outside Service Area',
      'Referred',
      'Statue Issue',
      'Workers Comp'
    )
  );

insert into public.callrail_tags (name)
values ('DEC: Minor Injury / Property Damage')
on conflict (name) do nothing;
