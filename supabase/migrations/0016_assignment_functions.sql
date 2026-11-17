-- CodeRabbit C1 and C2: atomic assignment changes for the staff student page.
--
-- reorder_curriculums(p_staff_id, p_student_id, p_curriculum_ids): sets positions 1..n in the
--   given order in one statement. The list must be exactly the student's curriculums (no
--   duplicates, none missing, none extra), else 'order_mismatch' and nothing changes. The
--   student's assignment rows are locked first, so concurrent reorders serialise.
-- remove_curriculum(p_staff_id, p_student_id, p_curriculum_id, p_confirm): locks the assignment
--   row (FOR UPDATE, so start_attempt's FOR SHARE read waits), refuses with 'in_progress' while an
--   attempt in the curriculum is in progress, returns {ok:false, code:'has_attempts', attempts:n}
--   without changes when the student has attempts and p_confirm is not true, else deletes the
--   unused grants for the curriculum's exam sets and the assignment in the same transaction.
--   Attempts and results stay. Server code closes expired attempts first (lazy expiry).
-- Both: 'not_staff' unless p_staff_id is a staff profile (the action passes the session's id
-- after requireRole('staff')). Security invoker, empty search_path, service role only.

create function public.reorder_curriculums(p_staff_id uuid, p_student_id uuid, p_curriculum_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_current uuid[];
begin
  if p_staff_id is null
     or not exists (select 1 from public.profiles where id = p_staff_id and role = 'staff') then
    raise exception 'not_staff';
  end if;

  select coalesce(array_agg(curriculum_id order by curriculum_id), '{}') into v_current
  from (
    select curriculum_id from public.assignments where student_id = p_student_id for update
  ) locked;

  if p_curriculum_ids is null
     or cardinality(p_curriculum_ids) <> cardinality(v_current)
     or (select count(distinct c) from unnest(p_curriculum_ids) c) <> cardinality(v_current)
     or exists (select 1 from unnest(p_curriculum_ids) c where c is null or not (c = any (v_current))) then
    raise exception 'order_mismatch';
  end if;

  update public.assignments a
  set position = o.ordinality
  from unnest(p_curriculum_ids) with ordinality o(curriculum_id, ordinality)
  where a.student_id = p_student_id and a.curriculum_id = o.curriculum_id;
end;
$$;

create function public.remove_curriculum(p_staff_id uuid, p_student_id uuid, p_curriculum_id uuid, p_confirm boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_assignment_id uuid;
  v_attempts integer;
begin
  if p_staff_id is null
     or not exists (select 1 from public.profiles where id = p_staff_id and role = 'staff') then
    raise exception 'not_staff';
  end if;

  select id into v_assignment_id
  from public.assignments
  where student_id = p_student_id and curriculum_id = p_curriculum_id
  for update;
  if not found then
    raise exception 'not_assigned';
  end if;

  if exists (
    select 1 from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.student_id = p_student_id and e.curriculum_id = p_curriculum_id and a.status = 'in_progress'
  ) then
    raise exception 'in_progress';
  end if;

  select count(*) into v_attempts
  from public.attempts a
  join public.exam_sets e on e.id = a.exam_set_id
  where a.student_id = p_student_id and e.curriculum_id = p_curriculum_id;
  if v_attempts > 0 and p_confirm is not true then
    return jsonb_build_object('ok', false, 'code', 'has_attempts', 'attempts', v_attempts);
  end if;

  delete from public.attempt_grants g
  using public.exam_sets e
  where e.id = g.exam_set_id
    and e.curriculum_id = p_curriculum_id
    and g.student_id = p_student_id
    and g.used_attempt_id is null;
  delete from public.assignments where id = v_assignment_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function
  public.reorder_curriculums(uuid, uuid, uuid[]),
  public.remove_curriculum(uuid, uuid, uuid, boolean)
from public, anon, authenticated;
grant execute on function
  public.reorder_curriculums(uuid, uuid, uuid[]),
  public.remove_curriculum(uuid, uuid, uuid, boolean)
to service_role;
