-- Staff-tagged language for the lead (English / Spanish). Used in the side panel
-- and as an analytics filter on the Intake dashboard.
alter table public.leads
  add column if not exists preferred_language text
  check (preferred_language is null or preferred_language in ('en', 'es'));

comment on column public.leads.preferred_language is
  'Staff-selected English (en) or Spanish (es) for the lead. Null when unset.';
