-- Conversion desired is its own milestone. Older desired_case values were calculated
-- from grade and qualified, so they do not count until a person or a sent contract sets the source.
alter table public.leads
  add column if not exists desired_source text;

alter table public.leads
  drop constraint if exists leads_desired_source_check;

alter table public.leads
  add constraint leads_desired_source_check
  check (desired_source is null or desired_source in ('staff', 'contract'));

comment on column public.leads.desired_source is
  'staff: a person marked conversion desired. contract: a sent contract set it. Null ignores a previously calculated desired_case.';

update public.leads
set desired_case = true,
    desired_source = 'staff'
where desired_source is null
  and callrail_tags @> array['CVR DESIRED']::text[];

update public.leads
set desired_case = true,
    desired_source = case when desired_source = 'staff' then 'staff' else 'contract' end
where agreement_status in ('sent', 'viewed', 'signed', 'completed')
   or (agreement_sent_at is not null and coalesce(agreement_status, '') <> 'failed');
