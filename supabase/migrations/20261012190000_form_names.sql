-- Web form posts already name the client and the accident. Copy those onto
-- the lead and open an intake row before anyone has called.

with parsed as (
  select id,
    nullif(btrim(substring(case_detail from '(?in)^[[:space:]]*[>*•\-]*[[:space:]]*(?:full name|client name|name)[[:space:]]*\**:[[:space:]]*\**[[:space:]]*([^[:cntrl:]]+)')), '') as raw_name,
    nullif(btrim(substring(case_detail from '(?in)^[[:space:]]*[>*•\-]*[[:space:]]*(?:type of accident|case type|tipo de accidente)[[:space:]]*\**:[[:space:]]*\**[[:space:]]*([^[:cntrl:]]+)')), '') as raw_accident
  from public.leads
  where case_detail is not null
), clean as (
  select id,
    case when raw_name is null or raw_name ~* '^(other|n/a|na|none|unknown|yes|no|-)$' then null else raw_name end as client_name,
    case when raw_accident is null or raw_accident ~* '^(other|n/a|na|none|unknown|yes|no|-)$' then null else raw_accident end as accident
  from parsed
)
update public.leads as lead
set lead_name = case
      when nullif(btrim(lead.lead_name), '') is not null then lead.lead_name
      when exists (
        select 1 from public.contacts as staff
        where lower(regexp_replace(staff.name, '\s+', ' ', 'g')) = lower(regexp_replace(clean.client_name, '\s+', ' ', 'g'))
      ) then lead.lead_name
      else clean.client_name
    end,
    case_type = coalesce(nullif(btrim(lead.case_type), ''), clean.accident)
from clean
where lead.id = clean.id
  and (clean.client_name is not null or clean.accident is not null);

insert into public.intakes (call_id, name, phone, email, accident_description)
select 'form:' || lead.id::text,
       nullif(btrim(lead.lead_name), ''),
       lead.phone,
       lead.email,
       nullif(btrim(lead.case_type), '')
from public.leads as lead
where lead.intake_call_id is null
  and (
    nullif(btrim(lead.lead_name), '') is not null
    or nullif(btrim(lead.case_type), '') is not null
  )
  and lead.case_detail ~* '(?n)^[[:space:]]*(?:full name|client name|name|type of accident|case type)[[:space:]]*:'
on conflict (call_id) do update set
  name = coalesce(public.intakes.name, excluded.name),
  phone = coalesce(public.intakes.phone, excluded.phone),
  email = coalesce(public.intakes.email, excluded.email),
  accident_description = coalesce(public.intakes.accident_description, excluded.accident_description);

update public.leads
set intake_call_id = 'form:' || id::text
where intake_call_id is null
  and exists (
    select 1 from public.intakes
    where call_id = 'form:' || leads.id::text
  );
