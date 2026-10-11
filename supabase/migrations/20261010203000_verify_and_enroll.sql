-- Recover obvious blanks, flag the rest for a person, and create the missing follow-up steps.
-- The sequence starts one day out so a repair does not post a pile of due calls the same hour.

alter table public.leads
  add column if not exists needs_verification boolean not null default false;

update public.leads
set email = null
where lower(btrim(email)) in ('null', 'undefined', 'none', 'n/a', 'na', '-');

update public.leads as lead
set
  email = btrim(intake.email),
  needs_verification = true
from public.intakes as intake
where intake.call_id = lead.intake_call_id
  and lead.email is null
  and intake.email is not null
  and btrim(intake.email) <> ''
  and lower(btrim(intake.email)) not in ('null', 'undefined', 'none', 'n/a', 'na', '-')
  and intake.email ~ '@';

update public.leads as lead
set
  lead_name = btrim(intake.name),
  needs_verification = true
from public.intakes as intake
where intake.call_id = lead.intake_call_id
  and lead.lead_name is null
  and intake.name is not null
  and btrim(intake.name) <> ''
  and lower(btrim(intake.name)) not in ('null', 'undefined', 'none', 'n/a');

update public.leads as lead
set
  lead_name = guess.person,
  needs_verification = true
from (
  select
    id,
    btrim(
      coalesce(
        (regexp_match(summary, 'the caller,[[:space:]]+((?:[[:alpha:]][''’.[:alpha:]-]*[[:space:]]+){0,3}[[:alpha:]][''’.[:alpha:]-]*)[[:space:]]*,', 'i'))[1],
        (regexp_match(summary, 'spoke with[[:space:]]+((?:[[:alpha:]][''’.[:alpha:]-]*[[:space:]]+){0,3}[[:alpha:]][''’.[:alpha:]-]*)', 'i'))[1],
        (regexp_match(summary, 'contacted[[:space:]]+((?:[[:alpha:]][''’.[:alpha:]-]*[[:space:]]+){0,3}[[:alpha:]][''’.[:alpha:]-]*)', 'i'))[1],
        case
          when summary !~* 'from ramos|from rama|legal assistant|intake specialist'
          then (regexp_match(summary, '^((?:[[:alpha:]][''’.[:alpha:]-]*[[:space:]]+){0,3}[[:alpha:]][''’.[:alpha:]-]*)[[:space:]]+(called|is seeking|broke|reported|were injured)', 'i'))[1]
        end
      )
    ) as person
  from public.leads
  where lead_name is null
    and summary is not null
) as guess
where lead.id = guess.id
  and guess.person is not null
  and length(guess.person) > 2
  and guess.person !~* '^(the|caller|an|employee)$'
  and guess.person !~* 'ramos|legal assistant';

update public.leads
set
  phone = (regexp_match(summary, '(\+1[0-9]{10})'))[1],
  phone_e164 = (regexp_match(summary, '(\+1[0-9]{10})'))[1],
  needs_verification = true
where (phone is null or btrim(phone) = '')
  and summary ~ '\+1[0-9]{10}';

update public.leads
set needs_verification = true
where lead_name is null
   or btrim(lead_name) = ''
   or phone is null
   or btrim(phone) = '';

insert into public.lead_jobs (lead_id, queue, position, due_at, body, status)
select
  lead.id,
  step.queue,
  step.position,
  now() + ((step.delay_minutes + 1440) * interval '1 minute'),
  replace(
    replace(
      step.body,
      '{{name}}',
      coalesce(nullif(split_part(btrim(coalesce(lead.lead_name, '')), ' ', 1), ''), 'there')
    ),
    '{{case_type}}',
    coalesce(nullif(btrim(coalesce(lead.case_type, '')), ''), 'case')
  ),
  'pending'
from public.leads as lead
join public.sequence_steps as step
  on (
    lead.kind = 'needs_info' and step.queue = 'call'
  ) or (
    coalesce(lead.kind, 'pursue') <> 'needs_info' and step.queue in ('text', 'call')
  )
where lead.follow_up
  and lead.signed_case = false
  and lead.case_id is null
  and lead.lead_status not in ('Lost', 'Referred', 'Promoted', 'Signed')
  and not exists (
    select 1 from public.lead_jobs as job where job.lead_id = lead.id
  );

insert into public.lead_events (lead_id, event_type, actor, payload)
select distinct
  job.lead_id,
  'enrolled',
  'repair',
  jsonb_build_object('reason', 'Follow-up was on, and no steps had been created.')
from public.lead_jobs as job
where job.created_at > now() - interval '5 minutes';
