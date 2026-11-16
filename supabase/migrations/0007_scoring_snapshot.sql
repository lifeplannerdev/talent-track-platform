-- Per-question scoring snapshot (Task 6 review).
--
-- attempts.points / max_points / passed are a snapshot taken at scoring time, but staff may
-- edit questions afterwards (key, points, topic). Readers that recomputed per-question or
-- per-topic results from the live questions could then contradict the stored total. So the
-- key, points, topic and awarded points of every attempt question are stored when the attempt
-- is scored, in the same transaction as the total, and every reader uses only these.
--
-- Server code (scoreAttempt in TypeScript) stays the single authority for scoring. It passes
-- the per-question snapshot it scored with; record_score checks that the snapshot covers
-- exactly the attempt's questions and adds up to the totals it stores, else 'invalid_snapshot'.
--
-- attempt_questions stays staff-select only (no student policy, not in any student view).

alter table public.attempt_questions
  add column correct_option_id text,
  add column max_points integer check (max_points > 0),
  add column awarded_points integer check (awarded_points >= 0 and awarded_points <= max_points),
  add column topic text;

drop function public.record_score(uuid, integer, integer, boolean);

-- p_questions: [{"attempt_question_id", "correct_option_id", "max_points", "awarded_points", "topic"}, ...]
create function public.record_score(
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
  v_valid boolean;
begin
  -- Lock the attempt; a concurrent second call waits here and then finds it scored.
  select e.hold_result into v_hold
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

-- Backfill attempts scored before this migration from the questions as they are now, counting
-- only answers saved at or before the deadline (the scoring rule). If a question was edited
-- after such an attempt was scored, its rows may not add up to the stored total; the total
-- stays authoritative.
update public.attempt_questions aq
set correct_option_id = q.correct_option_id,
    max_points = q.points,
    awarded_points = case when ans.option_id = q.correct_option_id then q.points else 0 end,
    topic = q.topic
from public.attempts a
join public.attempt_questions aq2 on aq2.attempt_id = a.id
join public.questions q on q.id = aq2.question_id
left join public.answers ans on ans.attempt_question_id = aq2.id and ans.saved_at <= a.deadline_at
where aq.id = aq2.id
  and a.points is not null
  and aq.awarded_points is null;
