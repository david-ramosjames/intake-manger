-- The lead is the decision. Grade and sentiment are both scores the team can
-- correct. Quo Router may revise them when a later call adds facts.
alter table public.leads
  add column if not exists sentiment text,
  add column if not exists sentiment_reason text,
  add column if not exists sentiment_source text,
  add column if not exists grade_source text;

alter table public.leads drop constraint if exists leads_sentiment_check;
alter table public.leads
  add constraint leads_sentiment_check
  check (sentiment is null or sentiment in ('positive', 'neutral', 'negative'));

comment on column public.leads.sentiment is
  'How ready the person sounds: positive, neutral, or negative. Separate from the A/B/C grade.';
comment on column public.leads.grade_source is
  'staff when someone in Intake Manager set the grade. quo-router when the latest call revised it.';
