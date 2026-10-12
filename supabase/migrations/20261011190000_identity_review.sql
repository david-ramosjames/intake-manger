-- Flag client names and emails that match the existing staff directory.
-- Do not rename or close the lead. A person confirms the correction.
-- Move pending calls that land on Sunday or outside 8am–6pm Central to 9:00am on a weekday.

alter table public.leads
  add column if not exists identity_status text not null default 'ok',
  add column if not exists identity_evidence text;

alter table public.leads drop constraint if exists leads_identity_status_check;
alter table public.leads
  add constraint leads_identity_status_check
  check (identity_status in ('ok', 'needs_review', 'confirmed'));

with staff as (
  select btrim(name) as name, email
  from public.contacts
  where name is not null
    and lower(btrim(name)) not in ('referred', 'legal assistant')
),
aliases as (
  select name as staff_name, lower(regexp_replace(name, '\s+', ' ', 'g')) as alias
  from staff
  union
  select
    name,
    lower(split_part(email, '@', 1) || ' ' || regexp_replace(name, '^.* ', ''))
  from staff
  where email ilike '%@ramosjames.com'
    and split_part(email, '@', 1) ~ '^[A-Za-z]{4,12}$'
    and lower(split_part(email, '@', 1)) <> lower(split_part(name, ' ', 1))
    and position(
      lower(regexp_replace(regexp_replace(name, '^.* ', ''), '[^a-zA-Z]', '', 'g'))
      in lower(split_part(email, '@', 1))
    ) = 0
)
update public.leads as lead
set
  identity_status = 'needs_review',
  identity_evidence = 'The name matches ' || alias.staff_name || ' in the staff directory. Confirm whether this is the client or the person who handled the call.',
  needs_verification = true
from aliases as alias
where lead.identity_status <> 'confirmed'
  and lower(regexp_replace(btrim(lead.lead_name), '\s+', ' ', 'g')) = alias.alias;

update public.leads
set
  identity_status = 'needs_review',
  identity_evidence = concat_ws(
    ' ',
    identity_evidence,
    'The email is a Ramos James address, so it belongs to the firm rather than the prospective client.'
  ),
  needs_verification = true
where identity_status <> 'confirmed'
  and email ilike '%@ramosjames.com';

update public.leads
set
  identity_status = 'needs_review',
  identity_evidence = concat_ws(
    ' ',
    identity_evidence,
    'The summary describes this name as someone from Ramos James.'
  ),
  needs_verification = true
where identity_status <> 'confirmed'
  and lead_name is not null
  and summary ilike '%' || lead_name || ' from ramo%';

update public.lead_jobs
set due_at = (
  (
    date_trunc('day', due_at at time zone 'America/Chicago')
    + make_interval(days => case
        when extract(dow from due_at at time zone 'America/Chicago') = 0 then 1
        when extract(hour from due_at at time zone 'America/Chicago') >= 18
          and extract(dow from due_at at time zone 'America/Chicago') = 5 then 3
        when extract(hour from due_at at time zone 'America/Chicago') >= 18
          and extract(dow from due_at at time zone 'America/Chicago') = 6 then 2
        when extract(hour from due_at at time zone 'America/Chicago') >= 18 then 1
        else 0
      end)
    + time '09:00'
  ) at time zone 'America/Chicago'
)
where status = 'pending'
  and queue = 'call'
  and (
    extract(dow from due_at at time zone 'America/Chicago') = 0
    or extract(hour from due_at at time zone 'America/Chicago') < 8
    or extract(hour from due_at at time zone 'America/Chicago') >= 18
  );
