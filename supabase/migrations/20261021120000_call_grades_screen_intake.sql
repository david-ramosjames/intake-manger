-- Screen vs full-intake jobs on each graded call (same or different handlers).

alter table public.call_grades
  add column if not exists jobs text,
  add column if not exists screen_handler_name text,
  add column if not exists intake_handler_name text,
  add column if not exists screen_grade text,
  add column if not exists screen_score integer,
  add column if not exists intake_grade text,
  add column if not exists intake_score integer;

update public.call_grades
set
  jobs = case
    when track = 'other' then 'screen'
    when track = 'injury_lead' then 'both'
    else coalesce(jobs, 'screen')
  end,
  screen_handler_name = coalesce(screen_handler_name, handler_name),
  intake_handler_name = case
    when track = 'injury_lead' then coalesce(intake_handler_name, handler_name)
    else intake_handler_name
  end,
  screen_grade = coalesce(screen_grade, grade),
  screen_score = coalesce(screen_score, score),
  intake_grade = case
    when track = 'injury_lead' then coalesce(intake_grade, grade)
    else intake_grade
  end,
  intake_score = case
    when track = 'injury_lead' then coalesce(intake_score, score)
    else intake_score
  end
where jobs is null;

do $$ begin
  alter table public.call_grades
    add constraint call_grades_jobs_check check (jobs is null or jobs in ('screen', 'intake', 'both'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.call_grades
    add constraint call_grades_screen_grade_check check (screen_grade is null or screen_grade in ('A', 'B', 'C', 'D', 'F'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.call_grades
    add constraint call_grades_intake_grade_check check (intake_grade is null or intake_grade in ('A', 'B', 'C', 'D', 'F'));
exception when duplicate_object then null;
end $$;
