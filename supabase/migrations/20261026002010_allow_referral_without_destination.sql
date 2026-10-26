-- A referral category can be sent from the template when no attorney is on file.
alter table public.referral_sends alter column destination_id drop not null;
