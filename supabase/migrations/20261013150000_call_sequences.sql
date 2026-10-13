-- Three call sequences. Existing steps stay on "want to sign" until the timings are edited.
alter table public.sequence_steps
  add column if not exists sequence text not null default 'want_to_sign';

alter table public.sequence_steps drop constraint if exists sequence_steps_sequence_check;
alter table public.sequence_steps
  add constraint sequence_steps_sequence_check
  check (sequence in ('want_to_sign', 'first_talk', 'more_info'));

alter table public.sequence_steps drop constraint if exists sequence_steps_queue_position_key;
alter table public.sequence_steps drop constraint if exists sequence_steps_sequence_queue_position_key;
alter table public.sequence_steps
  add constraint sequence_steps_sequence_queue_position_key unique (sequence, queue, position);

comment on column public.sequence_steps.sequence is
  'want_to_sign, first_talk, or more_info. Call steps set the next call. Text steps are listed here; SMS Follow-Up sends the texts.';
