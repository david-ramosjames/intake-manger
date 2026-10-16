alter table public.intake_settings
  add column if not exists slack_test_phone text;

comment on column public.intake_settings.slack_test_phone is
  'When set, Slack call reminders post only for this phone. Empty posts for every due lead.';
