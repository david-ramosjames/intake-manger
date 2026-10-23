-- Ensure all staff users (not just admins) can view and send referrals.
-- This fixes a bug where non-admin staff users couldn't see the Referral
-- section or send referrals, even though the feature should be available to
-- all staff members who are handling leads.

comment on table public.referral_destinations is
  'Attorneys and firms that take matters this office refers out. All staff can view and send referrals.';

comment on table public.referral_sends is
  'Record of referrals sent to partner attorneys. All staff can record referrals.';

comment on table public.referral_templates is
  'SMS templates for referral texts in English and Spanish. All staff can view and edit templates.';

-- Re-create policies to ensure all authenticated staff can access referrals
drop policy if exists referral_destinations_select on public.referral_destinations;
drop policy if exists referral_destinations_write on public.referral_destinations;
drop policy if exists referral_sends_select on public.referral_sends;
drop policy if exists referral_sends_write on public.referral_sends;
drop policy if exists referral_templates_select on public.referral_templates;
drop policy if exists referral_templates_write on public.referral_templates;

create policy referral_destinations_select on public.referral_destinations
  for select to authenticated using (true);

create policy referral_destinations_write on public.referral_destinations
  for all to authenticated using (true) with check (true);

create policy referral_sends_select on public.referral_sends
  for select to authenticated using (true);

create policy referral_sends_write on public.referral_sends
  for all to authenticated using (true) with check (true);

create policy referral_templates_select on public.referral_templates
  for select to authenticated using (true);

create policy referral_templates_write on public.referral_templates
  for all to authenticated using (true) with check (true);

-- Ensure grants are in place for all authenticated users
grant select, insert, update, delete on public.referral_destinations to authenticated;
grant select, insert, update, delete on public.referral_sends to authenticated;
grant select, insert, update, delete on public.referral_templates to authenticated;
