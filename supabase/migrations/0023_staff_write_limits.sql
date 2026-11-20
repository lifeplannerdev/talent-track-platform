-- Final review hardening for spec change 1.
--
-- 1. assignments: a staff session (authenticated + RLS policy assignments_staff_all) could write
--    any column, so it could set status, extra_attempts or allow_repeats around the rules of
--    record_score and give_extra_attempts, or delete a row (whose removal belongs to
--    remove_curriculum). App code only ever inserts (student_id, curriculum_id, position)
--    (createStudentAccount, assignCurriculum); everything else runs in service-role functions.
--    So authenticated keeps SELECT, gets INSERT on those three columns only, and loses UPDATE and
--    DELETE. The service role is unaffected.
-- 2. exam_sets: staff edit the settings columns (saveExamSet) but never move an exam set to
--    another curriculum (that would carry its attempts across curriculums). UPDATE becomes
--    column-level without curriculum_id. INSERT and SELECT are unchanged; DELETE was revoked in 0013.
-- 3. reorder_curriculums (0016) locked the student's assignment rows FOR UPDATE without an order;
--    it now locks them in id order (deterministic lock order between concurrent callers).
--    Same contract and hardening: security invoker, empty search_path, service role only.

revoke insert, update, delete on public.assignments from authenticated;
grant insert (student_id, curriculum_id, position) on public.assignments to authenticated;

revoke update on public.exam_sets from authenticated;
grant update (name, question_count, time_limit_min, pass_mark_percent, topic_mix, reminder_interval_min)
  on public.exam_sets to authenticated;

create or replace function public.reorder_curriculums(p_staff_id uuid, p_student_id uuid, p_curriculum_ids uuid[])
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
    select curriculum_id from public.assignments where student_id = p_student_id order by id for update
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

revoke all on function public.reorder_curriculums(uuid, uuid, uuid[]) from public, anon, authenticated;
grant execute on function public.reorder_curriculums(uuid, uuid, uuid[]) to service_role;
