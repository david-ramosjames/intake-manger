-- Add status tracking to referral_sends to distinguish between sent, already_sent, and declined referrals.
-- This allows staff to record when a lead declines a referral offer.
-- Also makes destination_id nullable to support declined referrals (no destination needed).

alter table public.referral_sends
  alter column destination_id drop not null;

alter table public.referral_sends
  add column if not exists status text not null default 'sent'
    check (status in ('sent', 'already_sent', 'declined'));

comment on column public.referral_sends.status is
  'Status of the referral: sent (text was sent), already_sent (recorded as sent outside), declined (lead declined the referral offer)';

comment on column public.referral_sends.destination_id is
  'Attorney/firm the referral was sent to. Null for declined referrals where no destination was needed.';

-- Backfill existing records as appropriate status based on note
update public.referral_sends
set status = 'already_sent'
where note = 'Already sent outside Intake Manager' and status = 'sent';
