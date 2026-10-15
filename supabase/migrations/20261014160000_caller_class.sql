-- Why a call was kept out of the work queue, or kept and closed as outside practice.
-- The row stays so it can be reviewed. The work queue only lists real leads.

alter table public.leads
  add column if not exists caller_class text;

alter table public.leads drop constraint if exists leads_caller_class_check;
alter table public.leads
  add constraint leads_caller_class_check
  check (
    caller_class is null
    or caller_class in (
      'spam',
      'vendor',
      'employment',
      'existing_client',
      'insurance',
      'other_law_office',
      'wrong_number',
      'return_call',
      'non_pi'
    )
  );

alter table public.leads drop constraint if exists leads_close_reason_check;
alter table public.leads
  add constraint leads_close_reason_check
  check (close_reason is null or close_reason in ('not_a_lead', 'outside_practice'));

comment on column public.leads.caller_class is
  'Quo classification. Exclude classes stay out of the work queue. non_pi is still a lead and is closed as outside practice. return_call merges into the existing lead.';
