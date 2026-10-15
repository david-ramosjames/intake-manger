-- Sign Flow writes which channel carries the contract reminder sequence.

alter table public.leads
  add column if not exists agreement_via_sms boolean,
  add column if not exists agreement_via_email boolean;

comment on column public.leads.agreement_via_sms is 'Sign Flow contract reminder sequence includes text.';
comment on column public.leads.agreement_via_email is 'Sign Flow contract reminder sequence includes email.';
