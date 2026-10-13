-- When a call reminder may fire. Monday through Friday share one window. Saturday and Sunday are optional.
create table if not exists public.sequence_hours (
  sequence text primary key,
  weekday_start smallint not null,
  weekday_end smallint not null,
  saturday_start smallint,
  saturday_end smallint,
  sunday_start smallint,
  sunday_end smallint,
  constraint sequence_hours_sequence_check check (sequence in ('want_to_sign', 'first_talk', 'more_info')),
  constraint sequence_hours_weekday_check check (
    weekday_start >= 0 and weekday_end <= 1440 and weekday_end > weekday_start
  ),
  constraint sequence_hours_saturday_check check (
    (saturday_start is null and saturday_end is null)
    or (
      saturday_start is not null
      and saturday_end is not null
      and saturday_start >= 0
      and saturday_end <= 1440
      and saturday_end > saturday_start
    )
  ),
  constraint sequence_hours_sunday_check check (
    (sunday_start is null and sunday_end is null)
    or (
      sunday_start is not null
      and sunday_end is not null
      and sunday_start >= 0
      and sunday_end <= 1440
      and sunday_end > sunday_start
    )
  )
);

insert into public.sequence_hours (sequence, weekday_start, weekday_end, saturday_start, saturday_end)
values
  ('want_to_sign', 480, 1080, 480, 1080),
  ('first_talk', 480, 1080, 480, 1080),
  ('more_info', 480, 1080, 480, 1080)
on conflict (sequence) do nothing;

alter table public.sequence_hours enable row level security;

drop policy if exists sequence_hours_select on public.sequence_hours;
create policy sequence_hours_select on public.sequence_hours
  for select to authenticated using (true);

drop policy if exists sequence_hours_write on public.sequence_hours;
create policy sequence_hours_write on public.sequence_hours
  for all to authenticated using (true) with check (true);

comment on table public.sequence_hours is
  'When a call reminder may fire. Monday through Friday share one window. Saturday and Sunday are optional.';
