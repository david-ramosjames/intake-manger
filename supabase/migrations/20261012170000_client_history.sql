-- Tie the Quo conversation log to the lead so Intake Manager can show it.
-- Quo Router keeps writing the rows. Staff can read them.

alter table public.intake_interactions
  add column if not exists lead_id uuid references public.leads (id) on delete set null,
  add column if not exists phone_e164 text;

create index if not exists intake_interactions_lead_idx
  on public.intake_interactions (lead_id, occurred_at desc);

create index if not exists intake_interactions_phone_e164_idx
  on public.intake_interactions (phone_e164, occurred_at desc);

update public.intake_interactions
set phone_e164 = case
  when length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) = 10
    then '+1' || regexp_replace(phone, '\D', '', 'g')
  when length(regexp_replace(coalesce(phone, ''), '\D', '', 'g')) = 11
    and left(regexp_replace(phone, '\D', '', 'g'), 1) = '1'
    then '+' || regexp_replace(phone, '\D', '', 'g')
  else phone_e164
end
where phone_e164 is null
  and phone is not null;

update public.intake_interactions as interaction
set lead_id = picked.id
from (
  select distinct on (phone_e164)
    id,
    phone_e164
  from public.leads
  where phone_e164 is not null
  order by phone_e164,
    case when case_id is null and lead_status is distinct from 'Promoted' then 0 else 1 end,
    created_at desc
) as picked
where interaction.lead_id is null
  and interaction.phone_e164 = picked.phone_e164;

alter table public.intake_interactions enable row level security;

drop policy if exists intake_interactions_select on public.intake_interactions;
create policy intake_interactions_select
  on public.intake_interactions
  for select
  to authenticated
  using (true);

grant select on public.intake_interactions to authenticated;
