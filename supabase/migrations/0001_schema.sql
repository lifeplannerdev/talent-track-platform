-- TalentTrackPlatform phase 1 schema, RLS and student-safe views.
--
-- Access model
--   * staff: role 'staff' in public.profiles. Full access except they cannot write
--     attempts / attempt_questions at all (scoring, release and attempt creation are
--     done by server code with the service role), so auto-scored points are never
--     editable from a staff session.
--   * student: sees only their own rows. Students have no direct SELECT policy on
--     attempts or questions. They read through two views that run with the view
--     owner's rights and filter by auth.uid():
--       student_attempts  - points, max_points, passed are NULL until status = 'released'
--       student_questions - question columns without correct_option_id, only for
--                           questions drawn into the student's own attempts
--   * anon: no access to anything.
--   * public sign-up is disabled (supabase/config.toml); every account is created by staff.
--
-- Profiles: a trigger on auth.users creates the profile row. Role, username, full_name,
-- batch and track are read from raw_app_meta_data, which only the Auth admin API
-- (service role) can set. raw_user_meta_data is user-editable, so it is ignored.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role text not null default 'student' check (role in ('staff', 'student')),
  username text not null unique check (username = lower(username) and length(username) > 0),
  full_name text,
  batch text,
  track text,
  consent_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.curriculums (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.exam_sets (
  id uuid primary key default gen_random_uuid(),
  curriculum_id uuid not null references public.curriculums (id) on delete cascade,
  name text not null,
  question_count integer not null check (question_count > 0),
  time_limit_min integer not null check (time_limit_min > 0),
  pass_mark_percent integer not null check (pass_mark_percent between 0 and 100),
  max_attempts integer not null default 1 check (max_attempts >= 1),
  hold_result boolean not null default false,
  topic_mix jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- options: [{"id":"a","de":"...","en":"..."}, ...]
create table public.questions (
  id uuid primary key default gen_random_uuid(),
  exam_set_id uuid not null references public.exam_sets (id) on delete cascade,
  topic text not null,
  difficulty text not null,
  stem_de text not null,
  stem_en text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2),
  correct_option_id text not null,
  points integer not null default 1 check (points > 0),
  status text not null default 'draft' check (status in ('draft', 'approved')),
  created_at timestamptz not null default now(),
  constraint questions_correct_option_in_options check (
    jsonb_path_exists(options, '$[*] ? (@.id == $id)', jsonb_build_object('id', correct_option_id))
  )
);

create table public.assignments (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  curriculum_id uuid not null references public.curriculums (id) on delete cascade,
  position integer not null default 0,
  status text not null default 'open' check (status in ('open', 'passed', 'blocked')),
  unique (student_id, curriculum_id)
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  exam_set_id uuid not null references public.exam_sets (id) on delete cascade,
  status text not null default 'in_progress' check (status in ('in_progress', 'submitted', 'released')),
  started_at timestamptz not null default now(),
  deadline_at timestamptz not null,
  submitted_at timestamptz,
  granted_by uuid references public.profiles (id) on delete set null,
  points integer,
  max_points integer,
  passed boolean,
  released_at timestamptz
);

create table public.attempt_questions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references public.attempts (id) on delete cascade,
  question_id uuid not null references public.questions (id) on delete restrict,
  position integer not null,
  option_order text[] not null,
  unique (attempt_id, position),
  unique (attempt_id, question_id)
);

create table public.answers (
  attempt_question_id uuid primary key references public.attempt_questions (id) on delete cascade,
  option_id text not null,
  saved_at timestamptz not null default now()
);

create table public.attempt_grants (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  exam_set_id uuid not null references public.exam_sets (id) on delete cascade,
  granted_by uuid references public.profiles (id) on delete set null,
  used_attempt_id uuid references public.attempts (id) on delete set null
);

-- Foreign-key indexes
create index exam_sets_curriculum_id_idx on public.exam_sets (curriculum_id);
create index questions_exam_set_id_idx on public.questions (exam_set_id);
create index assignments_curriculum_id_idx on public.assignments (curriculum_id);
create index attempts_student_id_idx on public.attempts (student_id);
create index attempts_exam_set_id_idx on public.attempts (exam_set_id);
create index attempts_granted_by_idx on public.attempts (granted_by);
create index attempt_questions_question_id_idx on public.attempt_questions (question_id);
create index attempt_grants_student_id_idx on public.attempt_grants (student_id);
create index attempt_grants_exam_set_id_idx on public.attempt_grants (exam_set_id);
create index attempt_grants_granted_by_idx on public.attempt_grants (granted_by);
create index attempt_grants_used_attempt_id_idx on public.attempt_grants (used_attempt_id);

-- ---------------------------------------------------------------------------
-- Helper functions (security definer, so policies do not recurse into RLS)
-- ---------------------------------------------------------------------------
create function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = (select auth.uid()) and role = 'staff');
$$;

create function private.owns_attempt(p_attempt_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attempts where id = p_attempt_id and student_id = (select auth.uid())
  );
$$;

create function private.owns_open_attempt_question(p_attempt_question_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.attempt_questions aq
    join public.attempts a on a.id = aq.attempt_id
    where aq.id = p_attempt_question_id
      and a.student_id = (select auth.uid())
      and a.status = 'in_progress'
      and a.deadline_at > now()
  );
$$;

revoke all on function private.is_staff(), private.owns_attempt(uuid), private.owns_open_attempt_question(uuid) from public, anon;
grant execute on function private.is_staff(), private.owns_attempt(uuid), private.owns_open_attempt_question(uuid) to authenticated;

-- Profile row for every auth user (see header comment).
create function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, role, username, full_name, batch, track)
  values (
    new.id,
    coalesce(new.raw_app_meta_data ->> 'role', 'student'),
    lower(coalesce(new.raw_app_meta_data ->> 'username', split_part(new.email, '@', 1))),
    new.raw_app_meta_data ->> 'full_name',
    new.raw_app_meta_data ->> 'batch',
    new.raw_app_meta_data ->> 'track'
  );
  return new;
end;
$$;

revoke all on function private.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- ---------------------------------------------------------------------------
-- Student-safe views (owner rights; filtered by auth.uid())
-- ---------------------------------------------------------------------------
create view public.student_attempts as
select
  a.id,
  a.student_id,
  a.exam_set_id,
  a.status,
  a.started_at,
  a.deadline_at,
  a.submitted_at,
  a.released_at,
  case when a.status = 'released' then a.points end as points,
  case when a.status = 'released' then a.max_points end as max_points,
  case when a.status = 'released' then a.passed end as passed
from public.attempts a
where a.student_id = (select auth.uid());

create view public.student_questions as
select
  aq.id as attempt_question_id,
  aq.attempt_id,
  aq.position,
  aq.option_order,
  q.id as question_id,
  q.exam_set_id,
  q.topic,
  q.difficulty,
  q.stem_de,
  q.stem_en,
  q.options,
  q.points
from public.attempt_questions aq
join public.attempts a on a.id = aq.attempt_id
join public.questions q on q.id = aq.question_id
where a.student_id = (select auth.uid());

-- ---------------------------------------------------------------------------
-- Privileges: nothing for anon; authenticated only what the policies need
-- ---------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
revoke all on all functions in schema public from anon;

grant select, insert, update, delete on
  public.profiles, public.curriculums, public.exam_sets, public.questions,
  public.assignments, public.attempt_grants to authenticated;
grant select on public.attempts, public.attempt_questions to authenticated;
grant select, insert, update on public.answers to authenticated;
grant select on public.student_attempts, public.student_questions to authenticated;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.curriculums enable row level security;
alter table public.exam_sets enable row level security;
alter table public.questions enable row level security;
alter table public.assignments enable row level security;
alter table public.attempts enable row level security;
alter table public.attempt_questions enable row level security;
alter table public.answers enable row level security;
alter table public.attempt_grants enable row level security;

-- profiles: own row for students, everything for staff. Students cannot update
-- (consent and other changes go through server actions with the service role).
create policy profiles_staff_all on public.profiles
  for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy profiles_select_own on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

-- curriculums and exam_sets: staff manage; students read the ones assigned to them.
create policy curriculums_staff_all on public.curriculums
  for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy curriculums_select_assigned on public.curriculums
  for select to authenticated
  using (exists (
    select 1 from public.assignments a
    where a.curriculum_id = curriculums.id and a.student_id = (select auth.uid())
  ));

create policy exam_sets_staff_all on public.exam_sets
  for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy exam_sets_select_assigned on public.exam_sets
  for select to authenticated
  using (exists (
    select 1 from public.assignments a
    where a.curriculum_id = exam_sets.curriculum_id and a.student_id = (select auth.uid())
  ));

-- questions: staff only. Students read via public.student_questions.
create policy questions_staff_all on public.questions
  for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- assignments and grants
create policy assignments_staff_all on public.assignments
  for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
create policy assignments_select_own on public.assignments
  for select to authenticated
  using (student_id = (select auth.uid()));

create policy attempt_grants_staff_all on public.attempt_grants
  for all to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

-- attempts and attempt_questions: staff read only; all writes use the service role.
-- Students have no policy here: they use public.student_attempts / student_questions.
create policy attempts_staff_select on public.attempts
  for select to authenticated
  using ((select private.is_staff()));
create policy attempt_questions_staff_select on public.attempt_questions
  for select to authenticated
  using ((select private.is_staff()));

-- answers: staff read; students read and write their own while the attempt is open.
create policy answers_staff_select on public.answers
  for select to authenticated
  using ((select private.is_staff()));
create policy answers_select_own on public.answers
  for select to authenticated
  using ((select private.owns_open_attempt_question(attempt_question_id)) or exists (
    select 1 from public.attempt_questions aq
    where aq.id = answers.attempt_question_id and (select private.owns_attempt(aq.attempt_id))
  ));
create policy answers_insert_own on public.answers
  for insert to authenticated
  with check ((select private.owns_open_attempt_question(attempt_question_id)));
create policy answers_update_own on public.answers
  for update to authenticated
  using ((select private.owns_open_attempt_question(attempt_question_id)))
  with check ((select private.owns_open_attempt_question(attempt_question_id)));
