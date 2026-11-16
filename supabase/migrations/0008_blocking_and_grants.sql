-- Blocking and staff grants (Task 7).
--
-- 1. release_attempt (same signature, same privileges) gets the blocking rule in its failed
--    branch. Blocked is only ever written at release, so a held result never shows up as a
--    block before staff release it (student_assignments masks a held attempt's outcome anyway).
--
--    "Attempts used" = the number of the student's attempts for that exam set that are scored,
--    i.e. status 'submitted' or 'released', counted at release time (the attempt being released
--    is already 'released' at that point and so counts). In-progress attempts do not count.
--    When attempts used >= exam_sets.max_attempts, the student's assignment for the exam set's
--    curriculum goes from 'open' to 'blocked'. A failure with attempts left leaves it 'open';
--    a pass sets 'passed' (unchanged). A 'passed' assignment is never downgraded.
--
-- 2. grant_attempt: the only way an attempt becomes available (retakes are never automatic).
--    Staff give a first attempt, a retake, or, after a block, an override: the grant and the
--    unblock commit together. It refuses (typed exceptions) a non-staff granter, an exam set
--    the student is not assigned to, a passed curriculum, an attempt in progress and an unused
--    grant that already exists (no stacking). It writes nothing and returns the shortfall when
--    the student's unseen approved questions cannot fill a paper. Service role only.

create or replace function public.release_attempt(p_attempt_id uuid, p_released_by uuid)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_student_id uuid;
  v_exam_set_id uuid;
  v_passed boolean;
  v_curriculum_id uuid;
  v_max_attempts integer;
  v_used integer;
begin
  if p_released_by is not null
     and not exists (select 1 from public.profiles where id = p_released_by and role = 'staff') then
    raise exception 'not_staff';
  end if;

  update public.attempts
  set status = 'released', released_at = now(), released_by = p_released_by
  where id = p_attempt_id
    and status = 'submitted'
    and points is not null
    and passed is not null
  returning student_id, exam_set_id, passed into v_student_id, v_exam_set_id, v_passed;
  if not found then
    return false;
  end if;

  select curriculum_id, max_attempts into v_curriculum_id, v_max_attempts
  from public.exam_sets where id = v_exam_set_id;

  if v_passed then
    update public.assignments
    set status = 'passed'
    where curriculum_id = v_curriculum_id
      and student_id = v_student_id;
  else
    -- Attempts used: scored attempts ('submitted' or 'released') of this student for this
    -- exam set, counted now, including the one just released.
    select count(*) into v_used
    from public.attempts
    where student_id = v_student_id
      and exam_set_id = v_exam_set_id
      and status in ('submitted', 'released');
    if v_used >= v_max_attempts then
      update public.assignments
      set status = 'blocked'
      where curriculum_id = v_curriculum_id
        and student_id = v_student_id
        and status = 'open';
    end if;
  end if;
  return true;
end;
$$;

-- Returns {"ok": true}, or {"ok": false, "unseen_available": n, "needed": m} (nothing written).
-- unseen = approved questions of the exam set that never appeared in any of the student's
-- attempt_questions. With a topic mix only unseen questions a mix slot can use count:
-- sum over topics of least(unseen in topic, needed for topic).
create function public.grant_attempt(p_student_id uuid, p_exam_set_id uuid, p_staff_id uuid)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_curriculum_id uuid;
  v_needed integer;
  v_mix jsonb;
  v_assignment_id uuid;
  v_assignment_status text;
  v_unseen integer;
begin
  if p_staff_id is null
     or not exists (select 1 from public.profiles where id = p_staff_id and role = 'staff') then
    raise exception 'not_staff';
  end if;

  select curriculum_id, question_count, topic_mix into v_curriculum_id, v_needed, v_mix
  from public.exam_sets where id = p_exam_set_id;
  if not found then
    raise exception 'exam_set_not_found';
  end if;

  -- Locking the assignment serialises concurrent grants for the same student and curriculum,
  -- so two clicks cannot both pass the no-stacking check.
  select id, status into v_assignment_id, v_assignment_status
  from public.assignments
  where student_id = p_student_id and curriculum_id = v_curriculum_id
  for update;
  if not found then
    raise exception 'not_assigned';
  end if;
  if v_assignment_status = 'passed' then
    raise exception 'assignment_passed';
  end if;

  if exists (
    select 1 from public.attempts
    where student_id = p_student_id and exam_set_id = p_exam_set_id and status = 'in_progress'
  ) then
    raise exception 'in_progress';
  end if;
  if exists (
    select 1 from public.attempt_grants
    where student_id = p_student_id and exam_set_id = p_exam_set_id and used_attempt_id is null
  ) then
    raise exception 'grant_exists';
  end if;

  with unseen as (
    select q.topic
    from public.questions q
    where q.exam_set_id = p_exam_set_id
      and q.status = 'approved'
      and not exists (
        select 1
        from public.attempt_questions aq
        join public.attempts a on a.id = aq.attempt_id
        where aq.question_id = q.id and a.student_id = p_student_id
      )
  )
  select case
    when v_mix is null or v_mix = '{}'::jsonb then (select count(*) from unseen)
    else (
      select coalesce(sum(least(
        (select count(*) from unseen u where u.topic = m.key),
        m.value::integer
      )), 0)
      from jsonb_each_text(v_mix) m
    )
  end
  into v_unseen;

  if v_unseen < v_needed then
    return jsonb_build_object('ok', false, 'unseen_available', v_unseen, 'needed', v_needed);
  end if;

  insert into public.attempt_grants (student_id, exam_set_id, granted_by)
  values (p_student_id, p_exam_set_id, p_staff_id);

  -- Staff override after a block: unblocked in the same transaction as the grant.
  update public.assignments set status = 'open'
  where id = v_assignment_id and status = 'blocked';

  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.grant_attempt(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.grant_attempt(uuid, uuid, uuid) to service_role;
-- create or replace keeps release_attempt's existing grants; restated for clarity.
revoke all on function public.release_attempt(uuid, uuid) from public, anon, authenticated;
grant execute on function public.release_attempt(uuid, uuid) to service_role;
