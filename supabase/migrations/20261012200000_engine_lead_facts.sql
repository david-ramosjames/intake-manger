-- Intake Engine landing-page posts already name the client, the ad source,
-- and the accident. Copy those onto leads that arrived before the list read them.

with parsed as (
  select id,
    nullif(btrim(substring(case_detail from '(?in)full name[[:space:]]*:?[[:space:]]*\**[[:space:]]*:?[[:space:]]*([^[:cntrl:]]+)')), '') as client_name,
    nullif(btrim(substring(case_detail from '(?in)what type of accident[^:[:cntrl:]]*:[[:space:]]*\**[[:space:]]*([^[:cntrl:]]+)')), '') as raw_accident,
    nullif(btrim(substring(case_detail from '(?in)(?:^|\n)Source:[[:space:]]*([^·[:cntrl:]]+)')), '') as raw_source
  from public.leads
  where case_detail ~* 'from intake engine landing page'
), clean as (
  select id,
    client_name,
    case when raw_accident is null or raw_accident ~* '^(other|n/a|na|none|unknown|-)$' then null else raw_accident end as accident,
    case
      when raw_source is null then null
      else regexp_replace(
        regexp_replace(initcap(raw_source), '\mCpc\M', 'cpc', 'gi'),
        '\mGmb\M', 'GMB', 'g'
      )
    end as source
  from parsed
), updated as (
  update public.leads as lead
  set lead_name = case
        when clean.client_name is null then lead.lead_name
        when nullif(nullif(btrim(lead.lead_name), ''), 'null') is null then clean.client_name
        when btrim(lead.lead_name) = 'the caller regarding a' then clean.client_name
        else lead.lead_name
      end,
      case_type = coalesce(nullif(btrim(lead.case_type), ''), clean.accident),
      lead_source = coalesce(nullif(btrim(lead.lead_source), ''), clean.source)
  from clean
  where lead.id = clean.id
  returning lead.id, lead.lead_name, lead.phone, lead.email, lead.case_type, lead.intake_call_id
)
update public.intakes as intake
set name = coalesce(nullif(btrim(intake.name), ''), updated.lead_name),
    phone = coalesce(intake.phone, updated.phone),
    email = coalesce(intake.email, updated.email),
    accident_description = coalesce(nullif(btrim(intake.accident_description), ''), updated.case_type)
from updated
where updated.intake_call_id is not null
  and intake.call_id = updated.intake_call_id;

insert into public.intakes (call_id, name, phone, email, accident_description)
select 'form:' || lead.id::text,
       nullif(btrim(lead.lead_name), ''),
       lead.phone,
       lead.email,
       nullif(btrim(lead.case_type), '')
from public.leads as lead
where lead.case_detail ~* 'from intake engine landing page'
  and lead.intake_call_id is null
  and (
    nullif(btrim(lead.lead_name), '') is not null
    or nullif(btrim(lead.case_type), '') is not null
  )
on conflict (call_id) do update set
  name = coalesce(public.intakes.name, excluded.name),
  phone = coalesce(public.intakes.phone, excluded.phone),
  email = coalesce(public.intakes.email, excluded.email),
  accident_description = coalesce(public.intakes.accident_description, excluded.accident_description);

update public.leads
set intake_call_id = 'form:' || id::text
where intake_call_id is null
  and case_detail ~* 'from intake engine landing page'
  and (
    nullif(btrim(lead_name), '') is not null
    or nullif(btrim(case_type), '') is not null
  );
