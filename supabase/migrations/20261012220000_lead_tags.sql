-- Decline reason is filled only from a DEC tag. DEC means declined.
alter table public.leads
  add column if not exists decline_reason text;

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
      'Referred',
      'Statue Issue'
    )
  );

comment on column public.leads.decline_reason is
  'Set only when the lead has a DEC tag. The value is the text after DEC:.';

insert into public.callrail_tags (name)
values
  ('QUALIFIED YES'),
  ('QUALIFIED NO'),
  ('CVR DESIRED'),
  ('CVR SIGNED'),
  ('DEC: At Fault / Bad Facts'),
  ('DEC: Has Attorney'),
  ('DEC: Medmal'),
  ('DEC: No Injury / Property Damage'),
  ('DEC: No Insurance'),
  ('DEC: Referred'),
  ('DEC: Statue Issue')
on conflict (name) do nothing;
