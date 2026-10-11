-- SMS Follow-Up sends texts. Intake Manager only queues the calls.
update public.lead_jobs
set
  status = 'skipped',
  detail = 'SMS Follow-Up sends texts. This app only queues calls.'
where queue = 'text'
  and status = 'pending';
