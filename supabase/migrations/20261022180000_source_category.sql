-- Add source_category column to leads table
alter table public.leads
  add column if not exists source_category text;

comment on column public.leads.source_category is
  'Marketing subcategory (AI, Search, Social, etc.) or Referral subcategory (Law Office, Personal Referral, etc.)';

-- Create index for filtering by source category
create index if not exists leads_source_category_idx on public.leads (source_category);
