-- Callback reminders can name who to tag, and the time can be edited before Slack posts.
alter table public.lead_jobs
  add column if not exists mention text,
  add column if not exists assigned_name text;

comment on column public.lead_jobs.assigned_name is
  'Proposed caller. Contract follow-up uses the person who handled the contract. A person can change it.';
comment on column public.lead_jobs.mention is
  'Slack user id to tag. When empty, dispatch looks up assigned_name, then the channel Lead.';

-- Starting call cadence. Staff can change the delays on Sequences. Texts stay with SMS Follow-Up.
insert into public.sequence_steps (sequence, queue, position, delay_minutes, body)
select seed.sequence, seed.queue, seed.position, seed.delay_minutes, seed.body
from (
  values
    ('first_talk', 'call', 1, 0, 'Call to establish first contact.'),
    ('first_talk', 'call', 2, 1440, 'Call again to establish first contact.'),
    ('first_talk', 'call', 3, 2880, 'Call again to establish first contact.'),
    ('first_talk', 'call', 4, 5760, 'Call again to establish first contact.'),
    ('first_talk', 'call', 5, 10080, 'Call again to establish first contact.'),
    ('more_info', 'call', 1, 1440, 'Call to reconnect after the consultation.'),
    ('more_info', 'call', 2, 4320, 'Call again after the consultation.'),
    ('more_info', 'call', 3, 10080, 'Call again after the consultation.'),
    ('more_info', 'call', 4, 20160, 'Call again after the consultation.')
) as seed(sequence, queue, position, delay_minutes, body)
where not exists (
  select 1
  from public.sequence_steps existing
  where existing.sequence = seed.sequence
    and existing.queue = seed.queue
    and existing.position = seed.position
);
