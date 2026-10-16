-- Intake Manager can hide someone who left and still keep their contact for the rest of the firm.
alter table public.contacts add column if not exists listed boolean not null default true;

comment on column public.contacts.listed is
  'When false, Intake Manager leaves this person off staff lists and Slack tags.';

update public.contacts
set listed = false
where lower(email) = 'kody@ramosjames.com';

insert into public.contacts (user_id, name, email, role, created_at, updated_at, team_calendar_scope, slack_display_name, listed)
select u.id,
       'Jissela Calix',
       u.email,
       'other',
       (extract(epoch from now()) * 1000)::bigint,
       (extract(epoch from now()) * 1000)::bigint,
       'assigned_cases',
       'Jissela',
       true
from auth.users u
where lower(u.email) = 'jissela@ramosjames.com'
  and not exists (
    select 1 from public.contacts c
    where c.user_id = u.id or lower(c.email) = lower(u.email)
  );

update public.leads
set owner_name = 'Jissela Calix'
where owner_name = 'Giselle';

update public.lead_jobs
set assigned_name = 'Jissela Calix'
where assigned_name = 'Giselle';
