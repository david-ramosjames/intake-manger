alter table public.intake_settings
  add column if not exists quo_api_key text,
  add column if not exists quo_from_number text;

comment on column public.intake_settings.quo_from_number is
  'E.164 Quo number referral texts are sent from. Chosen on How it fits.';
comment on column public.intake_settings.quo_api_key is
  'Quo API key for referral texts. Server only.';
