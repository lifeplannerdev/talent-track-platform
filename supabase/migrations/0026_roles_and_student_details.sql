-- v2 Phase 1: roles (admin, trainer, student), trainer ownership of students and the private
-- student_details table. Spec: docs/superpowers/specs/2026-11-24-v2-roadmap-and-foundation-design.md.
--
-- 1. profiles.role becomes ('admin','trainer','student'); every existing 'staff' row becomes
--    'admin'. profiles gets trainer_id (the student's trainer) and active (deactivated staff).
--    No staff or student session can write profiles (0025), so trainer_id and active are only
--    written by the service role.
-- 2. private.is_staff() keeps its meaning (admin or trainer, and active). New private.is_admin()
--    and private.manages_student(uuid): admin for any student, a trainer for students whose
--    trainer_id is theirs. Policies use these, so scope is enforced in the database.
-- 3. handle_new_user (the deferred Auth trigger) also reads trainer_id from raw_app_meta_data
--    (admin API only). A missing, malformed or non-staff value stays null. The legacy role value
--    'staff' in app metadata is read as 'admin' so older callers (scripts, tests) keep working.
-- 4. student_details: personal data, readable and writable only by admin and the student's
--    trainer. Students and anon read nothing. No DELETE (rows go with the student by cascade).
-- 5. Staff policies are REPLACED (not added to): profiles, assignments, attempts,
--    attempt_questions and answers are scoped by manages_student; curriculums, exam_sets and
--    questions stay readable by every staff user but only an admin may insert or update.
-- 6. The three service-role functions that checked role = 'staff' (give_extra_attempts,
--    remove_curriculum, reorder_curriculums) now accept admin or trainer. Their ownership check
--    through manages_student comes in a later task.

-- ---------------------------------------------------------------------------
-- 1. Columns and role check
-- ---------------------------------------------------------------------------
alter table public.profiles drop constraint profiles_role_check;
update public.profiles set role = 'admin' where role = 'staff';
alter table public.profiles
  add constraint profiles_role_check check (role in ('admin', 'trainer', 'student'));
alter table public.profiles
  add column trainer_id uuid references public.profiles (id) on delete restrict,
  add column active boolean not null default true;
create index profiles_trainer_id_idx on public.profiles (trainer_id);

-- ---------------------------------------------------------------------------
-- 2. Helper functions
-- ---------------------------------------------------------------------------
create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('admin', 'trainer') and active
  );
$$;

create function private.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and active
  );
$$;

create function private.manages_student(p_student uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select private.is_admin())
    or exists (
      select 1
      from public.profiles me
      join public.profiles s on s.trainer_id = me.id
      where me.id = (select auth.uid()) and me.role = 'trainer' and me.active
        and s.id = p_student and s.role = 'student'
    );
$$;

create function private.manages_attempt(p_attempt uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.attempts a
    where a.id = p_attempt and (select private.manages_student(a.student_id))
  );
$$;

revoke all on function private.is_admin(), private.manages_student(uuid), private.manages_attempt(uuid) from public, anon;
grant execute on function private.is_admin(), private.manages_student(uuid), private.manages_attempt(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Profile trigger: trainer_id and the new role names
-- ---------------------------------------------------------------------------
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  meta jsonb;
  v_role text;
  v_trainer uuid;
begin
  select raw_app_meta_data into meta from auth.users where id = new.id;
  if not found then
    return null; -- user was removed again in the same transaction
  end if;
  if coalesce(meta ->> 'username', '') = '' then
    raise exception 'username is required in raw_app_meta_data';
  end if;

  v_role := coalesce(meta ->> 'role', 'student');
  if v_role = 'staff' then
    v_role := 'admin'; -- legacy value from before 0026
  end if;

  begin
    v_trainer := (meta ->> 'trainer_id')::uuid;
  exception when invalid_text_representation then
    v_trainer := null;
  end;
  if v_trainer is not null and not exists (
    select 1 from public.profiles where id = v_trainer and role in ('admin', 'trainer')
  ) then
    v_trainer := null;
  end if;

  insert into public.profiles (id, role, username, full_name, batch, track, trainer_id)
  values (
    new.id,
    v_role,
    lower(meta ->> 'username'),
    meta ->> 'full_name',
    meta ->> 'batch',
    meta ->> 'track',
    v_trainer
  );
  return null;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. student_details
-- ---------------------------------------------------------------------------
create table public.student_details (
  student_id uuid primary key references public.profiles (id) on delete cascade,
  contact_email text not null check (length(btrim(contact_email)) > 0),
  phone text,
  guardian_name text,
  guardian_phone text,
  date_of_birth date,
  gender text,
  address text,
  passport_number text,
  passport_expiry date,
  destination_country text,
  target_intake text,
  german_level text check (german_level in ('A0', 'A1', 'A2', 'B1', 'B2', 'C1')),
  qualification text,
  joined_on date,
  programme_start date,
  status text not null default 'active' check (status in ('active', 'on_hold', 'completed', 'dropped')),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.student_details enable row level security;
revoke all on public.student_details from public, anon, authenticated;
grant select, insert, update on public.student_details to authenticated;
grant all on public.student_details to service_role;

create policy student_details_select on public.student_details
  for select to authenticated
  using ((select private.manages_student(student_id)));
create policy student_details_insert on public.student_details
  for insert to authenticated
  with check ((select private.manages_student(student_id)));
create policy student_details_update on public.student_details
  for update to authenticated
  using ((select private.manages_student(student_id)))
  with check ((select private.manages_student(student_id)));

-- ---------------------------------------------------------------------------
-- 5. Staff policies, replaced
-- ---------------------------------------------------------------------------
-- profiles: admin reads everything, a trainer only their students (the own row stays readable
-- through profiles_select_own).
drop policy profiles_staff_select on public.profiles;
create policy profiles_staff_select on public.profiles
  for select to authenticated
  using ((select private.is_admin()) or (role = 'student' and (select private.manages_student(id))));

-- curriculums, exam_sets, questions: every staff user reads, only an admin writes.
drop policy curriculums_staff_insert on public.curriculums;
drop policy curriculums_staff_update on public.curriculums;
create policy curriculums_staff_insert on public.curriculums
  for insert to authenticated
  with check ((select private.is_admin()));
create policy curriculums_staff_update on public.curriculums
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy exam_sets_staff_insert on public.exam_sets;
drop policy exam_sets_staff_update on public.exam_sets;
create policy exam_sets_staff_insert on public.exam_sets
  for insert to authenticated
  with check ((select private.is_admin()));
create policy exam_sets_staff_update on public.exam_sets
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

drop policy questions_staff_all on public.questions;
create policy questions_staff_select on public.questions
  for select to authenticated
  using ((select private.is_staff()));
create policy questions_staff_insert on public.questions
  for insert to authenticated
  with check ((select private.is_admin()));
create policy questions_staff_update on public.questions
  for update to authenticated
  using ((select private.is_admin())) with check ((select private.is_admin()));

-- assignments: staff read and insert for students they manage (updates and deletes have no
-- privilege since 0023).
drop policy assignments_staff_all on public.assignments;
create policy assignments_staff_select on public.assignments
  for select to authenticated
  using ((select private.manages_student(student_id)));
create policy assignments_staff_insert on public.assignments
  for insert to authenticated
  with check ((select private.manages_student(student_id)));

-- attempts, attempt_questions, answers: staff read what belongs to students they manage.
drop policy attempts_staff_select on public.attempts;
create policy attempts_staff_select on public.attempts
  for select to authenticated
  using ((select private.manages_student(student_id)));

drop policy attempt_questions_staff_select on public.attempt_questions;
create policy attempt_questions_staff_select on public.attempt_questions
  for select to authenticated
  using ((select private.manages_attempt(attempt_id)));

drop policy answers_staff_select on public.answers;
create policy answers_staff_select on public.answers
  for select to authenticated
  using (exists (
    select 1 from public.attempt_questions aq
    where aq.id = answers.attempt_question_id and (select private.manages_attempt(aq.attempt_id))
  ));

-- ---------------------------------------------------------------------------
-- 6. Service-role functions: accept both staff roles (same bodies, check widened)
-- ---------------------------------------------------------------------------
do $$
declare
  fn regprocedure;
  def text;
  patched text;
begin
  foreach fn in array array[
    'public.give_extra_attempts(uuid, uuid, uuid, integer, boolean)'::regprocedure,
    'public.remove_curriculum(uuid, uuid, uuid, boolean)'::regprocedure,
    'public.reorder_curriculums(uuid, uuid, uuid[])'::regprocedure
  ] loop
    def := pg_get_functiondef(fn);
    patched := replace(def, 'and role = ''staff''', 'and role in (''admin'', ''trainer'') and active');
    if patched = def then
      raise exception 'staff role check not found in %', fn;
    end if;
    execute patched;
  end loop;
end;
$$;
