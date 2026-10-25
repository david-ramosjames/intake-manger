comment on column public.intake_settings.quo_from_number is
  'E.164 Quo number referral texts are sent from. Defaults to the Leads line. Chosen on Referrals and How it fits.';

update public.intake_settings
set quo_from_number = '+15127643037',
    updated_at = now()
where id = 'default'
  and quo_from_number = '+15126010647';
