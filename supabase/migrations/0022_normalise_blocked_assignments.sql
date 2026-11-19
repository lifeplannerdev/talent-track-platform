-- Spec change 1, data normalisation after 0020/0021. Data only: no function, policy or grant.
--
-- 0020 decided blocks only for results it released itself. An assignment can still be 'open'
-- although the student has used every allowed attempt of the curriculum (submitted or released,
-- over all its exam sets, against curriculums.max_attempts + assignments.extra_attempts) and the
-- latest scored attempt failed, for example when the old per-exam-set limit was higher than the
-- new per-curriculum one. Such a student can never start again (start_attempt refuses
-- no_attempts_left), so the assignment is set to 'blocked', which is what record_score would
-- have decided; staff lift it with give_extra_attempts. 'passed' and 'blocked' rows are left alone.
-- Re-running it changes nothing.

update public.assignments asg
set status = 'blocked'
from public.curriculums c
where c.id = asg.curriculum_id
  and asg.status = 'open'
  and (
    select count(*)
    from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.student_id = asg.student_id and e.curriculum_id = asg.curriculum_id
      and a.status in ('submitted', 'released')
  ) >= c.max_attempts + asg.extra_attempts
  and (
    select a.passed
    from public.attempts a
    join public.exam_sets e on e.id = a.exam_set_id
    where a.student_id = asg.student_id and e.curriculum_id = asg.curriculum_id
      and a.points is not null and a.passed is not null
    order by a.submitted_at desc nulls last, a.started_at desc
    limit 1
  ) is false;
