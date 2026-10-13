-- Call reminders use the Quo Router Slack bot. Posting stays off until someone turns it on.
create table if not exists public.intake_settings (
  id text primary key,
  slack_posting boolean not null default false,
  slack_bot_token text,
  slack_channel_id text,
  updated_at timestamptz not null default now(),
  updated_by text
);

insert into public.intake_settings (id, slack_posting, slack_channel_id)
values ('default', false, 'C026G89PPSS')
on conflict (id) do nothing;

alter table public.intake_settings enable row level security;

comment on table public.intake_settings is
  'Staff-managed Slack reminder settings. The bot token is the Quo Router Slack bot, not a separate Intake Manager app.';
