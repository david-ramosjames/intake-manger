-- Sign Flow writes the contract send and reminder times. SMS Follow-Up writes
-- which sequence a number is on. Intake Manager only displays these columns.

alter table public.leads
  add column if not exists agreement_status text,
  add column if not exists agreement_sent_at timestamptz,
  add column if not exists agreement_last_reminder_at timestamptz,
  add column if not exists agreement_next_reminder_at timestamptz,
  add column if not exists agreement_reminder_count integer,
  add column if not exists agreement_signing_url text,
  add column if not exists text_sequence_slug text,
  add column if not exists text_sequence_status text,
  add column if not exists text_next_at timestamptz;
