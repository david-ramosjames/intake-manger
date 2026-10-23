-- Practice and pre-launch rows stay in the database.
-- The work queue, open calls, priority, and scheduling skip them.
-- Status, close reason, and the other lead fields are not changed.

alter table public.leads
  add column if not exists test boolean not null default false;

comment on column public.leads.test is
  'Pre-launch and practice rows. Hidden from the work queue, open calls, priority, and scheduling. Lead status is left unchanged.';
