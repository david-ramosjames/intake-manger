-- Each sequence keeps its own day 1. Moving to a new sequence does not reuse the old call positions.
alter table public.lead_jobs
  add column if not exists sequence text;

update public.lead_jobs
set sequence = 'legacy'
where sequence is null;

alter table public.lead_jobs
  alter column sequence set not null;

alter table public.lead_jobs
  drop constraint if exists lead_jobs_lead_id_queue_position_key;

alter table public.lead_jobs
  drop constraint if exists lead_jobs_lead_id_queue_sequence_position_key;

alter table public.lead_jobs
  add constraint lead_jobs_lead_id_queue_sequence_position_key
  unique (lead_id, queue, sequence, position);

comment on column public.lead_jobs.sequence is
  'Call sequence this job belongs to: want_to_sign, first_talk, more_info, or legacy.';
