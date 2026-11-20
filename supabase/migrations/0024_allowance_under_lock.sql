-- Fix wave 2 for spec change 1 (CodeRabbit). Same signatures, contracts and hardening
-- (security invoker, empty search_path, service role only); lock order unchanged:
-- assignment -> new attempt rows (start_attempt, give_extra_attempts); record_score locks the
-- attempt, then the assignment.
--
-- start_attempt: curriculums.max_attempts is read in its own statement after the assignment
--   FOR UPDATE (it was joined into the exam set lookup before the lock, so a limit lowered while
--   the call waited was missed). A SQL NULL or non-array p_draw raises invalid_draw (a NULL draw
--   used to pass the checks and create an attempt with no questions).
-- record_score: the allowance (max_attempts + extra_attempts) is read after locking the
--   assignment, not in a query joined to curriculums.
-- give_extra_attempts: still adds n, but a blocked assignment opens only when max_attempts +
--   extra_attempts then exceeds the attempts used (submitted or released in the curriculum).

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
  select e.time_limit_min, e.question_count, e.curriculum_id, e.pass_mark_percent
  into v_time_limit, v_question_count, v_curriculum_id, v_pass_mark
  from public.exam_sets e
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
  -- Read the limit only now, under the assignment lock: a limit staff lowered while this call
  -- waited for the lock is respected.
  select max_attempts into v_max_attempts from public.curriculums where id = v_curriculum_id;

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

  -- A SQL NULL or a non-array draw is invalid (jsonb_typeof(NULL) is NULL, which would pass).
  if p_draw is null or jsonb_typeof(p_draw) is distinct from 'array' then
    raise exception 'invalid_draw';
  end if;
  if jsonb_array_length(p_draw) <> v_question_count then
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
  v_extra integer;
  v_max_attempts integer;
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

  -- Lock order: attempt row (above) -> assignment row. The allowance is read after the lock, in
  -- its own statements, so blocking uses the limit and extra attempts as they are now.
  select asg.id, asg.extra_attempts
  into v_assignment_id, v_extra
  from public.assignments asg
  where asg.student_id = v_student_id and asg.curriculum_id = v_curriculum_id
  for update;
  if not found then
    return 'released'; -- curriculum removed from the student meanwhile; the result still stands
  end if;
  select max_attempts into v_max_attempts from public.curriculums where id = v_curriculum_id;
  v_allowance := v_max_attempts + v_extra;

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

create or replace function public.give_extra_attempts(
  p_staff_id uuid,
  p_student_id uuid,
  p_curriculum_id uuid,
  p_n integer,
  p_allow_repeats boolean
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_status text;
  v_used integer;
  v_max_attempts integer;
begin
  if p_staff_id is null
     or not exists (select 1 from public.profiles where id = p_staff_id and role = 'staff') then
    raise exception 'not_staff';
  end if;
  if p_n is null or p_n < 1 or p_n > 10 then
    raise exception 'invalid_n';
  end if;

  select id, status into v_assignment_id, v_status
  from public.assignments
  where student_id = p_student_id and curriculum_id = p_curriculum_id
  for update;
  if not found then
    raise exception 'not_assigned';
  end if;
  if v_status = 'passed' then
    raise exception 'already_passed';
  end if;

  -- Attempts used in the curriculum (submitted or released) and the limit, read under the lock.
  select count(*) into v_used
  from public.attempts a
  join public.exam_sets e on e.id = a.exam_set_id
  where a.student_id = p_student_id and e.curriculum_id = p_curriculum_id
    and a.status in ('submitted', 'released');
  select max_attempts into v_max_attempts from public.curriculums where id = p_curriculum_id;

  -- The extra attempts always count; a block is lifted only when the new allowance exceeds the
  -- attempts already used (otherwise the student still has nothing to start).
  update public.assignments
  set extra_attempts = extra_attempts + p_n,
      allow_repeats = allow_repeats or coalesce(p_allow_repeats, false),
      status = case
        when status = 'blocked' and v_max_attempts + extra_attempts + p_n > v_used then 'open'
        else status
      end
  where id = v_assignment_id;
end;
$$;

revoke all on function public.start_attempt(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.start_attempt(uuid, uuid, jsonb) to service_role;
revoke all on function public.record_score(uuid, integer, integer, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.record_score(uuid, integer, integer, boolean, jsonb) to service_role;
revoke all on function public.give_extra_attempts(uuid, uuid, uuid, integer, boolean) from public, anon, authenticated;
grant execute on function public.give_extra_attempts(uuid, uuid, uuid, integer, boolean) to service_role;
