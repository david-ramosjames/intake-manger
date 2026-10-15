alter table public.leads
  add column if not exists practice_area text,
  add column if not exists referral_opportunity boolean not null default false;

comment on column public.leads.practice_area is
  'Practice area from the referral directory. A non-PI legal inquiry stays a lead until the referral text is sent.';
comment on column public.leads.referral_opportunity is
  'Staff marked this lead as a referral. It stays open until the attorney contact text is sent.';

alter table public.referral_destinations
  add column if not exists practice_areas text[] not null default '{}',
  add column if not exists address text,
  add column if not exists email text,
  add column if not exists website text,
  add column if not exists spanish boolean not null default false,
  add column if not exists matters text;

alter table public.referral_sends
  add column if not exists language text,
  add column if not exists message text;

create table if not exists public.referral_templates (
  language text primary key check (language in ('en', 'es')),
  body text not null,
  updated_at timestamptz not null default now()
);

alter table public.referral_templates enable row level security;
drop policy if exists referral_templates_select on public.referral_templates;
drop policy if exists referral_templates_write on public.referral_templates;
create policy referral_templates_select on public.referral_templates for select to authenticated using (true);
create policy referral_templates_write on public.referral_templates for all to authenticated using (true) with check (true);
grant select, insert, update, delete on public.referral_templates to authenticated;

insert into public.referral_templates (language, body)
values
  ('en', '{{greeting}}, this is Ramos James Law. We are not able to help with {{area}}. Please contact {{attorney}} at {{phone}}. {{details}}'),
  ('es', '{{greeting}}, le habla Ramos James Law. No podemos ayudar con asuntos de {{area}}. Comuníquese con {{attorney}} al {{phone}}. {{details}}')
on conflict (language) do nothing;

update public.referral_destinations
set active = false
where name in ('Texas Lawyer Referral Service', 'Central Texas Lawyer Referral');

insert into public.referral_destinations (name, phone, case_types, practice_areas, address, email, website, spanish, matters, notes)
select seed.name, seed.phone, seed.practice_areas, seed.practice_areas, seed.address, seed.email, seed.website, seed.spanish, seed.matters, seed.notes
from (
  values
    ('Laura Martinez', '512-535-3322', array['family']::text[], '2221 Hancock Drive, Austin, TX 78756', null, null, true, 'Divorce, child custody, property division, child support, spousal support, adoption, grandparents rights, CPS, premarital agreements.', null),
    ('Iris Albizu', '512-861-5638', array['family', 'immigration']::text[], '111 W Anderson Lane, D-207, Austin, TX 78752', null, 'https://www.albizulaw.com/', true, 'Family law, and family-based immigration, naturalization, asylum, visas, green cards, citizenship, deportation, VAWA, and appeals.', null),
    ('Angelica Cormier', '512-337-9549', array['family']::text[], '3307 Northland Drive, Suite 420, Austin, TX 78731', null, 'https://www.gbfamilylaw.com/attorney/angelica-rolong-cormier/', false, 'Family law.', null),
    ('Kate Lincoln Goldfinch', '512-488-1776', array['immigration']::text[], '1005 E 40th St, Austin, TX 78751', 'elihu@lincolngoldfinch.com', 'https://www.lincolngoldfinch.com/', true, 'Family-based immigration, naturalization, asylum, temporary visas, green cards, citizenship, deportation, VAWA, appeals, and employers.', 'Get the caller name and phone number. Email the potential client to elihu@lincolngoldfinch.com, and copy kate@lincolngoldfinch.com and laura@ramosjames.com.'),
    ('Tayrin Cardenas Wittenstein', '512-484-9389', array['criminal']::text[], '603 W 12th St, Austin, TX 78701', 'ty@cardenaswittlaw.com', null, true, 'DWI, assault, homicide, robbery, kidnapping, domestic violence, sexual assault, and drug possession.', null),
    ('Jorge Vela', '512-537-1237', array['criminal']::text[], '1301 Nueces St, Suite 200, Austin, TX 78701', 'jorge@jorgevelalaw.com', 'https://www.jorgevelalaw.com/', true, 'Criminal defense.', null),
    ('Addy Maldonado', '512-843-1883', array['criminal']::text[], '505 W 12th, Suite 206, Austin, TX 78701', null, null, false, 'Criminal defense.', null),
    ('Guillermo Ochoa Cronfel', '512-347-9600', array['real_estate']::text[], '7500 Rialto Boulevard, Bldg 1, Suite 250, Austin, TX 78735', null, 'https://www.atxlawyers.com/', true, 'Real estate, bankruptcy, and turnover.', null),
    ('Michelle M Cheng', '833-913-1885', array['medmal']::text[], '1114 Lost Creek Blvd, Ste 410, Austin, TX 78746', null, 'https://www.nationaltriallaw.com/our-team/michelle-m-cheng/', false, 'Medical malpractice. Wrongful death or a truly catastrophic injury only, where the party at fault was a medical provider.', 'National Trial Law.'),
    ('Shawn Frazier', '512-561-0102', array['personal_injury']::text[], '1000 Heritage Center Circle, Round Rock, TX 78664', 'shawn@shawnfrazierlaw.com', 'https://sj-lawfirm.com/', false, 'Car accidents, pedestrian accidents, dog bites, product liability, slip and fall, work injuries, wrongful death, and truck accidents.', null),
    ('Ben Newman', '512-487-5050', array['personal_injury']::text[], '7500 Rialto Blvd, Building 1, Suite 250, Austin, TX 78735', 'ben@bnaalaw.com', 'https://www.bnaalaw.com/', false, 'Personal injury.', null),
    ('V. Valenzuela Law', '512-400-4406', array['personal_injury']::text[], '1105 Nueces Street, Suite D, Austin, TX 78701', 'connect@vvalenzuelalaw.com', 'https://vvalenzuelalaw.com/', false, 'Personal injury.', null),
    ('Gary Rodriguez', '512-326-2622', array['workers_comp']::text[], '6104 Fredericksburg Road, Box 93009, Austin, TX 78749', 'admin@garyrodriguez.com', 'https://www.garyrodriguez.com/', false, 'Workplace injury when workers compensation is present.', null),
    ('Richard Pena', '512-327-6884', array['workers_comp']::text[], '2211 I-35 #300, Austin, TX 78741', 'receptionist@rpenalaw.com', 'https://www.rpenalaw.com/', true, 'Workers compensation.', null),
    ('Volunteer Legal Services', '512-476-5550', array['miscellaneous']::text[], '8001 Centre Park Dr, Suite 120, Austin, TX 78754', null, null, false, 'Miscellaneous matters.', null),
    ('Lawyer Referral Services', '512-472-8303', array['miscellaneous']::text[], '1016 La Posada Dr, Suite 210, Austin, TX 78752', null, null, false, 'Austin and surrounding areas. Round Rock and Cedar Park leads only.', null),
    ('Fair Labor Law, Aaron Johnson', '512-277-3505', array['labor']::text[], '314 E. Highland Mall Blvd, Ste. 401, Austin, TX 78752', null, 'https://www.fairlaborlaw.com/', false, 'Unpaid time, lunch breaks, tipped employees, bonuses, per diems, incentive pay, overtime, and salaried workers.', null),
    ('Equal Justice Center', '512-474-0007', array['labor']::text[], '510 S Congress Ave, Suite 206, Austin, TX 78704', null, null, false, 'Labor issues.', null),
    ('Workers Defense Project', '512-391-2305', array['labor']::text[], '5604 Manor Rd, Austin, TX 78723', null, null, false, 'Labor issues.', null),
    ('Erik Moskowitz', '512-872-3840', array['employment']::text[], '3410 Far West Boulevard, Suite 210, Austin, TX 78731', null, 'https://www.chapmanfirmtx.com/attorneys/erik-g-moskowitz/', false, 'Trade secrets, construction defects, contract disputes, harassment and discrimination, wage and hour, unemployment, and workers rights.', 'Also 512-879-9033.')
) as seed(name, phone, practice_areas, address, email, website, spanish, matters, notes)
where not exists (
  select 1 from public.referral_destinations existing where existing.name = seed.name
);
