-- Spec change 1 (owner, 2026-11-18): immediate marks, two free attempts per curriculum,
-- independent curriculums. See docs/superpowers/specs/2026-11-18-immediate-marks-attempts-design.md.
--
-- 1. Attempt limit per curriculum: curriculums.max_attempts (default 2, 1..20). Each assignment
--    has extra_attempts (staff-given, >= 0) and allow_repeats (staff override: an exam set of the
--    curriculum may be given again). Allowance = max_attempts + extra_attempts. Attempts used =
--    the student's attempts with status 'submitted' or 'released' over all exam sets of the
--    curriculum (in progress does not count until submitted).
-- 2. No grants: unused attempt_grants rows become +1 extra_attempts on the matching assignment,
--    then the table is dropped (grant_attempt with it).
-- 3. No hold and no release step: record_score scores and releases in one transaction
--    (status 'released', released_at = now(), released_by null) and decides the assignment:
--    pass -> 'passed'; fail and used >= allowance -> 'blocked' (only from 'open'; 'passed' is
--    never downgraded). Attempts already submitted with a score (held results) are released here
--    by the same rule. release_attempt, exam_sets.hold_result and exam_sets.max_attempts go.
-- 4. start_attempt (same signature, security invoker, empty search_path, service role only)
--    needs no grant. Under the assignment row lock (FOR UPDATE, 0017) it refuses, in this order:
--      not_open         no assignment for the curriculum
--      blocked / passed the assignment status
--      in_progress      an attempt of the curriculum is in progress (any exam set; the unique
--                       in-progress index stays as the backstop for the same set)
--      scoring_pending  a submitted attempt of the curriculum has no score yet (crash between
--                       close and score; server code finalises it first). Without this a start
--                       could run before an earlier pass or block is recorded.
--      no_attempts_left used >= max_attempts + extra_attempts
--      exam_set_used    the student already had this exam set and allow_repeats is false
--      invalid_draw / question_already_seen (the latter only without allow_repeats: with a
--                       repeated set server code prefers unseen questions but may reuse seen ones)
--    It keeps db now() for started_at / deadline_at and the pass mark snapshot (0019).
-- 5. student_assignments shows the real status (nothing is held any more).
--
-- Lock order (no cycles):
--   start_attempt, give_extra_attempts (0021), remove_curriculum, reorder_curriculums:
--     assignments row(s) FOR UPDATE -> (read attempts) -> new attempts / attempt_questions rows.
--   close_attempt: the existing attempts row only.
--   record_score: the existing attempts row FOR UPDATE -> the assignments row FOR UPDATE.
--   start_attempt never locks an existing attempts row, so a record_score waiting for the
--   assignment lock held by a start is never waited on by that start in turn.

-- 1. Additive ----------------------------------------------------------------------------
alter table public.curriculums
  add column max_attempts integer not null default 2
    constraint curriculums_max_attempts_check check (max_attempts between 1 and 20);

alter table public.assignments
  add column extra_attempts integer not null default 0
    constraint assignments_extra_attempts_check check (extra_attempts >= 0),
  add column allow_repeats boolean not null default false;

-- 2. Unused grants -> extra attempts --------------------------------------------------------
update public.assignments asg
set extra_attempts = asg.extra_attempts + g.unused
from (
  select g.student_id, e.curriculum_id, count(*)::integer as unused
  from public.attempt_grants g
  join public.exam_sets e on e.id = g.exam_set_id
  where g.used_attempt_id is null
  group by g.student_id, e.curriculum_id
) g
where asg.student_id = g.student_id and asg.curriculum_id = g.curriculum_id;

-- 3. Release held results (submitted with a score), oldest first, by the record_score rule ----
do $$
declare
  r record;
  v_used integer;
begin
  for r in
    select a.id, a.student_id, a.passed, e.curriculum_id
    from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.status = 'submitted' and a.points is not null and a.passed is not null
    order by a.submitted_at nulls last, a.started_at
  loop
    update public.attempts
    set status = 'released', released_at = now(), released_by = null
    where id = r.id;

    if r.passed then
      update public.assignments set status = 'passed'
      where student_id = r.student_id and curriculum_id = r.curriculum_id;
    else
      select count(*) into v_used
      from public.attempts a
      join public.exam_sets e on e.id = a.exam_set_id
      where a.student_id = r.student_id and e.curriculum_id = r.curriculum_id
        and a.status in ('submitted', 'released');
      update public.assignments asg
      set status = 'blocked'
      from public.curriculums c
      where c.id = asg.curriculum_id
        and asg.student_id = r.student_id and asg.curriculum_id = r.curriculum_id
        and asg.status = 'open'
        and v_used >= c.max_attempts + asg.extra_attempts;
    end if;
  end loop;
end;
$$;

-- 4. start_attempt ----------------------------------------------------------------------------
create or replace function public.start_attempt(p_student_id uuid, p_exam_set_id uuid, p_draw jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_time_limit integer;
  v_question_count integer;
  v_curriculum_id uuid;
  v_pass_mark integer;
  v_assignment_status text;
  v_extra integer;
  v_allow_repeats boolean;
  v_max_attempts integer;
  v_used integer;
  v_attempt_id uuid;
begin
  select e.time_limit_min, e.question_count, e.curriculum_id, e.pass_mark_percent, c.max_attempts
  into v_time_limit, v_question_count, v_curriculum_id, v_pass_mark, v_max_attempts
  from public.exam_sets e
  join public.curriculums c on c.id = e.curriculum_id
  where e.id = p_exam_set_id;
  if not found then
    raise exception 'exam_set_not_found';
  end if;

  select status, extra_attempts, allow_repeats
  into v_assignment_status, v_extra, v_allow_repeats
  from public.assignments
  where student_id = p_student_id and curriculum_id = v_curriculum_id
  for update; -- serialises starts (and give_extra_attempts) per student and curriculum
  if not found then
    raise exception 'not_open';
  end if;
  if v_assignment_status = 'blocked' then
    raise exception 'blocked';
  end if;
  if v_assignment_status = 'passed' then
    raise exception 'passed';
  end if;
  if v_assignment_status <> 'open' then
    raise exception 'not_open';
  end if;

  -- One exam at a time per curriculum (any exam set of it).
  if exists (
    select 1 from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.student_id = p_student_id and e.curriculum_id = v_curriculum_id and a.status = 'in_progress'
  ) then
    raise exception 'in_progress';
  end if;
  -- A submitted attempt without a score: its pass or block is not recorded yet.
  if exists (
    select 1 from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.student_id = p_student_id and e.curriculum_id = v_curriculum_id and a.status = 'submitted'
  ) then
    raise exception 'scoring_pending';
  end if;

  select count(*) into v_used
  from public.attempts a
  join public.exam_sets e on e.id = a.exam_set_id
  where a.student_id = p_student_id and e.curriculum_id = v_curriculum_id
    and a.status in ('submitted', 'released');
  if v_used >= v_max_attempts + v_extra then
    raise exception 'no_attempts_left';
  end if;

  if not v_allow_repeats and exists (
    select 1 from public.attempts
    where student_id = p_student_id and exam_set_id = p_exam_set_id
  ) then
    raise exception 'exam_set_used';
  end if;

  if jsonb_typeof(p_draw) <> 'array' or jsonb_array_length(p_draw) <> v_question_count then
    raise exception 'invalid_draw';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_draw) d
    left join public.questions q
      on q.id = (d ->> 'question_id')::uuid and q.exam_set_id = p_exam_set_id and q.status = 'approved'
    where q.id is null
  ) then
    raise exception 'invalid_draw';
  end if;
  -- Never hand a student a question they were already given (for example a question staff moved
  -- from another exam set), unless staff allowed repeats.
  if not v_allow_repeats and exists (
    select 1
    from jsonb_array_elements(p_draw) d
    join public.attempt_questions aq on aq.question_id = (d ->> 'question_id')::uuid
    join public.attempts a on a.id = aq.attempt_id
    where a.student_id = p_student_id
  ) then
    raise exception 'question_already_seen';
  end if;

  begin
    insert into public.attempts (student_id, exam_set_id, status, started_at, deadline_at, pass_mark_percent)
    values (p_student_id, p_exam_set_id, 'in_progress', now(), now() + make_interval(mins => v_time_limit), v_pass_mark)
    returning id into v_attempt_id;
  exception when unique_violation then
    raise exception 'in_progress';
  end;

  insert into public.attempt_questions (attempt_id, question_id, position, option_order)
  select v_attempt_id,
         (d.value ->> 'question_id')::uuid,
         d.ordinality,
         array(select jsonb_array_elements_text(d.value -> 'option_order'))
  from jsonb_array_elements(p_draw) with ordinality d;

  return v_attempt_id;
end;
$$;

revoke all on function public.start_attempt(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.start_attempt(uuid, uuid, jsonb) to service_role;

-- 5. record_score: score, release and decide the assignment in one transaction ------------------
-- Same signature and grants as 0019. Returns 'released', or null when the attempt is not a
-- submitted, unscored attempt (already scored, in progress or unknown).
create or replace function public.record_score(
  p_attempt_id uuid,
  p_points integer,
  p_max_points integer,
  p_passed boolean,
  p_questions jsonb
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_curriculum_id uuid;
  v_pass_mark integer;
  v_valid boolean;
  v_assignment_id uuid;
  v_allowance integer;
  v_used integer;
begin
  -- Lock the attempt; a concurrent second call waits here and then finds it scored.
  select a.student_id, e.curriculum_id, coalesce(a.pass_mark_percent, e.pass_mark_percent)
  into v_student_id, v_curriculum_id, v_pass_mark
  from public.attempts a
  join public.exam_sets e on e.id = a.exam_set_id
  where a.id = p_attempt_id
    and a.status = 'submitted'
    and a.points is null
  for update of a;
  if not found then
    return null;
  end if;

  if p_questions is null or jsonb_typeof(p_questions) <> 'array' then
    raise exception 'invalid_snapshot';
  end if;

  with s as (
    select (x ->> 'attempt_question_id')::uuid as aq_id,
           x ->> 'correct_option_id' as correct_option_id,
           (x ->> 'max_points')::integer as max_points,
           (x ->> 'awarded_points')::integer as awarded_points,
           x ->> 'topic' as topic
    from jsonb_array_elements(p_questions) x
  ),
  paper as (
    select id from public.attempt_questions where attempt_id = p_attempt_id
  )
  select
    (select count(*) from s) = (select count(*) from paper)
    and (select count(distinct aq_id) from s) = (select count(*) from paper)
    and not exists (select 1 from s where aq_id is null or aq_id not in (select id from paper))
    and not exists (
      select 1 from s
      where correct_option_id is null or topic is null or max_points is null or awarded_points is null
         or max_points <= 0 or awarded_points < 0 or awarded_points > max_points
    )
    and (select coalesce(sum(awarded_points), 0) from s) = p_points
    and (select coalesce(sum(max_points), 0) from s) = p_max_points
  into v_valid;
  if not v_valid then
    raise exception 'invalid_snapshot';
  end if;

  -- Pass or fail is decided by the pass mark snapshot, exactly (no float rounding).
  if p_passed is null
     or p_passed is distinct from (p_max_points > 0 and p_points * 100 >= v_pass_mark * p_max_points) then
    raise exception 'invalid_outcome';
  end if;

  update public.attempt_questions aq
  set correct_option_id = x ->> 'correct_option_id',
      max_points = (x ->> 'max_points')::integer,
      awarded_points = (x ->> 'awarded_points')::integer,
      topic = x ->> 'topic'
  from jsonb_array_elements(p_questions) x
  where aq.id = (x ->> 'attempt_question_id')::uuid
    and aq.attempt_id = p_attempt_id;

  update public.attempts
  set points = p_points, max_points = p_max_points, passed = p_passed,
      status = 'released', released_at = now(), released_by = null
  where id = p_attempt_id;

  -- Lock order: attempt row (above) -> assignment row.
  select asg.id, c.max_attempts + asg.extra_attempts
  into v_assignment_id, v_allowance
  from public.assignments asg
  join public.curriculums c on c.id = asg.curriculum_id
  where asg.student_id = v_student_id and asg.curriculum_id = v_curriculum_id
  for update of asg;
  if not found then
    return 'released'; -- curriculum removed from the student meanwhile; the result still stands
  end if;

  if p_passed then
    update public.assignments set status = 'passed' where id = v_assignment_id;
  else
    -- Attempts used, counted now, including the one just released.
    select count(*) into v_used
    from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.student_id = v_student_id and e.curriculum_id = v_curriculum_id
      and a.status in ('submitted', 'released');
    if v_used >= v_allowance then
      update public.assignments set status = 'blocked'
      where id = v_assignment_id and status = 'open';
    end if;
  end if;
  return 'released';
end;
$$;

revoke all on function public.record_score(uuid, integer, integer, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.record_score(uuid, integer, integer, boolean, jsonb) to service_role;

-- 6. student_assignments: no masking (same columns, so existing grants stay) --------------------
create or replace view public.student_assignments as
select
  asg.id,
  asg.student_id,
  asg.curriculum_id,
  asg.position,
  asg.status
from public.assignments asg
where asg.student_id = (select auth.uid());

revoke all on public.student_assignments from public, anon, authenticated;
grant select on public.student_assignments to authenticated;

-- 7. Destructive -------------------------------------------------------------------------------
drop function public.release_attempt(uuid, uuid);
drop function public.grant_attempt(uuid, uuid, uuid);
drop table public.attempt_grants;
alter table public.exam_sets drop column hold_result, drop column max_attempts;
