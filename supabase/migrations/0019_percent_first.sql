-- Percent first (owner, 2026-11-18): "mainly focus on percentage; passing percentage is 90%".
--
-- 1. exam_sets.pass_mark_percent defaults to 90 (it had no default; the staff form proposed 60).
--    It stays staff-editable per exam set (0 to 100).
-- 2. attempts.pass_mark_percent: the pass mark in force when the attempt was started, copied by
--    start_attempt. Scoring (record_score, scoreAttempt via finalizeAttempt) and every report use
--    this snapshot instead of the live exam set, so a later change of the pass mark never changes
--    or contradicts an attempt that was already started, scored or released. Nullable only for
--    legacy rows whose stored outcome disagrees with the current exam set (see backfill).
-- 3. record_score refuses an outcome that disagrees with the snapshot ('invalid_outcome'):
--    passed must equal points * 100 >= pass_mark_percent * max_points (exact integer comparison).
-- 4. Existing exam sets still at 60 (the old form default) move to 90. This is safe: the
--    snapshot is backfilled first, so attempts already started, held or released keep 60 as their
--    pass mark and their stored points / passed are never touched. Only attempts started after
--    this migration use 90. Exam sets with any other pass mark keep it.
--
-- Lock order is unchanged (see 0017): start_attempt locks the assignments row FOR UPDATE, then
-- attempt_grants rows, then inserts the new attempt / attempt_questions rows; record_score locks
-- the existing attempts row and then (via release_attempt) the assignments row.

alter table public.exam_sets alter column pass_mark_percent set default 90;

alter table public.attempts
  add column pass_mark_percent integer
    constraint attempts_pass_mark_percent_check check (pass_mark_percent between 0 and 100);

-- Backfill: unscored attempts get the exam set's current pass mark (the one they would have been
-- scored with); scored attempts get it only when it agrees with their stored outcome, otherwise
-- the pass mark at scoring time is unknown and stays null (reports then omit it).
update public.attempts a
set pass_mark_percent = e.pass_mark_percent
from public.exam_sets e
where e.id = a.exam_set_id
  and a.pass_mark_percent is null
  and (
    a.points is null or a.max_points is null or a.passed is null
    or (a.max_points > 0 and (a.points * 100 >= e.pass_mark_percent * a.max_points) = a.passed)
  );

update public.exam_sets set pass_mark_percent = 90 where pass_mark_percent = 60;

-- start_attempt: 0017 plus the pass mark snapshot. Same signature, security invoker, empty
-- search_path, service role only. Keeps: exam set lookup, assignment row FOR UPDATE ('not_open'
-- unless open), 'result_pending', 'in_progress' (other exam set of the curriculum, and the unique
-- in-progress index on the same set), draw checks, unseen questions, grant FOR UPDATE, now().
create or replace function public.start_attempt(p_student_id uuid, p_exam_set_id uuid, p_draw jsonb)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_grant_id uuid;
  v_granted_by uuid;
  v_time_limit integer;
  v_question_count integer;
  v_curriculum_id uuid;
  v_pass_mark integer;
  v_assignment_status text;
  v_attempt_id uuid;
begin
  select time_limit_min, question_count, curriculum_id, pass_mark_percent
  into v_time_limit, v_question_count, v_curriculum_id, v_pass_mark
  from public.exam_sets where id = p_exam_set_id;
  if not found then
    raise exception 'exam_set_not_found';
  end if;

  select status into v_assignment_status
  from public.assignments
  where student_id = p_student_id and curriculum_id = v_curriculum_id
  for update; -- serialises starts per student and curriculum (see 0017)
  if not found or v_assignment_status <> 'open' then
    raise exception 'not_open';
  end if;
  if exists (
    select 1 from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.student_id = p_student_id and e.curriculum_id = v_curriculum_id and a.status = 'submitted'
  ) then
    raise exception 'result_pending';
  end if;
  -- One exam at a time per curriculum: an attempt in progress on another exam set of it blocks
  -- the start (the unique index only covers the same exam set).
  if exists (
    select 1 from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.student_id = p_student_id and e.curriculum_id = v_curriculum_id
      and a.exam_set_id <> p_exam_set_id and a.status = 'in_progress'
  ) then
    raise exception 'in_progress';
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
  -- Never hand a student a question they were already given in this exam set.
  if exists (
    select 1
    from jsonb_array_elements(p_draw) d
    join public.attempt_questions aq on aq.question_id = (d ->> 'question_id')::uuid
    join public.attempts a on a.id = aq.attempt_id
    where a.student_id = p_student_id
  ) then
    raise exception 'question_already_seen';
  end if;

  select id, granted_by into v_grant_id, v_granted_by
  from public.attempt_grants
  where student_id = p_student_id and exam_set_id = p_exam_set_id and used_attempt_id is null
  order by id
  limit 1
  for update; -- a concurrent start waits here, then sees the grant as used
  if not found then
    raise exception 'no_grant';
  end if;

  begin
    insert into public.attempts (student_id, exam_set_id, status, started_at, deadline_at, granted_by, pass_mark_percent)
    values (p_student_id, p_exam_set_id, 'in_progress', now(), now() + make_interval(mins => v_time_limit), v_granted_by, v_pass_mark)
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

  update public.attempt_grants set used_attempt_id = v_attempt_id
  where id = v_grant_id and used_attempt_id is null;

  return v_attempt_id;
end;
$$;

revoke all on function public.start_attempt(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.start_attempt(uuid, uuid, jsonb) to service_role;

-- record_score: 0007 plus the outcome check against the snapshot (falling back to the exam set
-- for a legacy attempt without one). Same signature and grants.
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
  v_hold boolean;
  v_pass_mark integer;
  v_valid boolean;
begin
  -- Lock the attempt; a concurrent second call waits here and then finds it scored.
  select e.hold_result, coalesce(a.pass_mark_percent, e.pass_mark_percent) into v_hold, v_pass_mark
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
  set points = p_points, max_points = p_max_points, passed = p_passed
  where id = p_attempt_id;

  if v_hold then
    return 'submitted';
  end if;
  perform public.release_attempt(p_attempt_id, null);
  return 'released';
end;
$$;

revoke all on function public.record_score(uuid, integer, integer, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.record_score(uuid, integer, integer, boolean, jsonb) to service_role;
