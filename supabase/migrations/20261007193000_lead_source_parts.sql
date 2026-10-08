-- Source is three parts: how they reached us, the specific place, and a free note.
alter table public.leads
  add column if not exists source_channel text,
  add column if not exists source_note text;

update public.leads
set source_channel = case
  when arrival = 'form' or source_type = 'Form' then 'Web form'
  when arrival in ('missed', 'sona', 'human_call', 'qualified_call') or source_type = 'Call' then 'Call'
  else source_channel
end
where source_channel is null
  and (arrival is not null or source_type in ('Form', 'Call'));
