-- Staff can correct who screened the lead and who did the intake when the
-- call record attributes both to whoever answered the phone.
alter table public.leads
  add column if not exists screen_by text,
  add column if not exists intake_by text;

comment on column public.leads.screen_by is
  'Staff override for who screened the lead. Null uses the call record.';

comment on column public.leads.intake_by is
  'Staff override for who did the intake. Null uses the call record.';
