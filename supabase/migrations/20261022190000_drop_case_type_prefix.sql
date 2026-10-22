-- Drop the T: prefix. Anything that is not one of the standard case types becomes TBD.
update public.leads
set case_type = case
  when regexp_replace(case_type, '^T:\s*', '', 'i') in (
    'Wrongful Death',
    'Work Injury',
    'Sexual Assault / Child Abuse',
    'Premises Liability',
    'Pedestrian / Bicycle / Scooter',
    'Other Injury',
    'Dog Bite',
    'Commercial / 18 Wheeler',
    'TBD',
    'Non-PI Legal Matter'
  ) then regexp_replace(case_type, '^T:\s*', '', 'i')
  else 'TBD'
end
where case_type is not null
  and case_type not in (
    'Wrongful Death',
    'Work Injury',
    'Sexual Assault / Child Abuse',
    'Premises Liability',
    'Pedestrian / Bicycle / Scooter',
    'Other Injury',
    'Dog Bite',
    'Commercial / 18 Wheeler',
    'TBD',
    'Non-PI Legal Matter'
  );
