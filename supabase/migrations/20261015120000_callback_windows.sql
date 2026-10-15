-- Each callback step names the window it should land in.
alter table public.sequence_steps
  add column if not exists callback_window text;

alter table public.sequence_steps drop constraint if exists sequence_steps_callback_window_check;
alter table public.sequence_steps
  add constraint sequence_steps_callback_window_check
  check (callback_window is null or callback_window in ('morning', 'lunch', 'afternoon', 'contact'));

update public.sequence_steps
set callback_window = case ((position - 1) % 4)
  when 0 then 'morning'
  when 1 then 'contact'
  when 2 then 'lunch'
  else 'afternoon'
end
where callback_window is null;

comment on column public.sequence_steps.callback_window is
  'morning 8:30–11:30, lunch 11:30–2:30, afternoon 2:30–5:30, or contact for the same window as the last contact. The minute varies inside the window.';
