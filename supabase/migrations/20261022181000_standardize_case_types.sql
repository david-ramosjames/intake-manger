-- Standardize all case types to use "T:" prefix format
-- Map old case types to new standardized types

-- Update case types to new format with T: prefix
update public.leads
set case_type = case
  when case_type = 'Commercial / 18 Wheeler' then 'T: Commercial / 18 Wheeler'
  when case_type = 'Dog Bite' then 'T: Dog Bite'
  when case_type = 'Non-PI Legal Matter' then 'T: Non-PI Legal Matter'
  when case_type = 'Other Injury' then 'T: Other Injury'
  when case_type = 'Pedestrian / Bicycle / Scooter' then 'T: Pedestrian / Bicycle / Scooter'
  when case_type = 'Premises Liability' then 'T: Premises Liability'
  when case_type = 'Sexual Assault / Child Abuse' then 'T: Sexual Assault / Child Abuse'
  when case_type = 'Work Injury' then 'T: Work Injury'
  when case_type = 'Wrongful Death' then 'T: Wrongful Death'
  -- Map deprecated types to T: TBD
  when case_type = 'Auto Accident' then 'T: TBD'
  when case_type = 'MedMal' then 'T: TBD'
  when case_type = 'Workers Comp' then 'T: TBD'
  when case_type = 'No Injuries / Property Damage' then 'T: TBD'
  -- Map other variations
  when case_type ilike 'auto%accident%' then 'T: TBD'
  when case_type ilike '%medmal%' then 'T: TBD'
  when case_type ilike '%medical%malpractice%' then 'T: TBD'
  when case_type ilike '%workers%comp%' then 'T: TBD'
  when case_type ilike '%property%damage%' then 'T: TBD'
  when case_type ilike '%18%wheeler%' then 'T: Commercial / 18 Wheeler'
  when case_type ilike '%commercial%truck%' then 'T: Commercial / 18 Wheeler'
  when case_type ilike '%dog%bite%' then 'T: Dog Bite'
  when case_type ilike '%pedestrian%' then 'T: Pedestrian / Bicycle / Scooter'
  when case_type ilike '%bicycle%' then 'T: Pedestrian / Bicycle / Scooter'
  when case_type ilike '%scooter%' then 'T: Pedestrian / Bicycle / Scooter'
  when case_type ilike '%premises%' then 'T: Premises Liability'
  when case_type ilike '%slip%fall%' then 'T: Premises Liability'
  when case_type ilike '%sexual%assault%' then 'T: Sexual Assault / Child Abuse'
  when case_type ilike '%child%abuse%' then 'T: Sexual Assault / Child Abuse'
  when case_type ilike '%work%injury%' then 'T: Work Injury'
  when case_type ilike '%wrongful%death%' then 'T: Wrongful Death'
  when case_type ilike '%non%pi%' then 'T: Non-PI Legal Matter'
  -- Default for any other case
  else 'T: TBD'
end
where case_type is not null
  and case_type not like 'T:%';

-- Log the changes
do $$
declare
  updated_count integer;
begin
  select count(*) into updated_count
  from public.leads
  where case_type like 'T:%';
  
  raise notice 'Standardized % case types to T: format', updated_count;
end $$;
