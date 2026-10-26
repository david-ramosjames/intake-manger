-- An attorney typed in for a referral type that has nobody on file.
alter table public.referral_sends add column if not exists attorney_name text;
