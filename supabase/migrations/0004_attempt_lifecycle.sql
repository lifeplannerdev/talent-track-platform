-- Attempt lifecycle (Task 5): start, save, close, score, expire.
--
-- supabase-js has no transactions, so every multi-statement write is one function call.
-- The functions run as the caller (security invoker) and only the service role may call
-- them: server code (src/lib/attempts.ts) authenticates the student with getUser() and
-- passes the session's user id. Deadlines are always computed and compared with now().
--
-- Scoring itself stays in TypeScript (scoreAttempt) and is a two-step flow:
--   1. close_attempt / close_expired_attempts flip in_progress -> submitted. After that
--      save_answer refuses every write, so the answers read for scoring are final.
--   2. record_score stores points, max_points, passed exactly once (guard: points is null)
--      and releases at once only when the exam set does not hold results.
-- A crash between the two steps leaves a submitted attempt without points; the sweep and
-- every later submit pick it up again.

-- At most one in-progress attempt per student and exam set.
create unique index attempts_one_in_progress_idx
  on public.attempts (student_id, exam_set_id)
  where status = 'in_progress';
create index attempts_in_progress_deadline_idx
  on public.attempts (deadline_at)
  where status = 'in_progress';

-- Students write answers only through server code (an old access token stays valid at
-- PostgREST after a newer login, and option ids must be validated).
drop policy answers_insert_own on public.answers;
drop policy answers_update_own on public.answers;
revoke insert, update on public.answers from authenticated;

-- ---------------------------------------------------------------------------
-- start_attempt: claim one unused grant, create the attempt and store the draw.
-- p_draw: [{"question_id": "...", "option_order": ["b","a",...]}, ...] in paper order.
-- ---------------------------------------------------------------------------
create function public.start_attempt(p_student_id uuid, p_exam_set_id uuid, p_draw jsonb)
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
  v_attempt_id uuid;
begin
  select time_limit_min, question_count into v_time_limit, v_question_count
  from public.exam_sets where id = p_exam_set_id;
  if not found then
    raise exception 'exam_set_not_found';
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
    insert into public.attempts (student_id, exam_set_id, status, started_at, deadline_at, granted_by)
    values (p_student_id, p_exam_set_id, 'in_progress', now(), now() + make_interval(mins => v_time_limit), v_granted_by)
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

-- ---------------------------------------------------------------------------
-- save_answer: only the owning student, only while in progress and before the deadline,
-- only an option id that was shown for that question.
-- ---------------------------------------------------------------------------
create function public.save_answer(p_student_id uuid, p_attempt_id uuid, p_attempt_question_id uuid, p_option_id text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
  v_deadline timestamptz;
  v_option_order text[];
begin
  -- FOR SHARE serialises with close_attempt: once a close commits, this sees 'submitted'.
  select a.status, a.deadline_at, aq.option_order
    into v_status, v_deadline, v_option_order
  from public.attempt_questions aq
  join public.attempts a on a.id = aq.attempt_id
  where aq.id = p_attempt_question_id
    and aq.attempt_id = p_attempt_id
    and a.student_id = p_student_id
  for share of a;
  if not found then
    raise exception 'not_found';
  end if;
  if v_status <> 'in_progress' then
    raise exception 'closed';
  end if;
  if v_deadline <= now() then
    raise exception 'deadline_passed';
  end if;
  if p_option_id is null or not (p_option_id = any (v_option_order)) then
    raise exception 'invalid_option';
  end if;

  insert into public.answers (attempt_question_id, option_id, saved_at)
  values (p_attempt_question_id, p_option_id, now())
  on conflict (attempt_question_id)
  do update set option_id = excluded.option_id, saved_at = excluded.saved_at;
end;
$$;

-- ---------------------------------------------------------------------------
-- close_attempt: in_progress -> submitted. Returns true only for the call that closed it.
-- p_only_if_expired: lazy expiry, closes only when the deadline has passed.
-- submitted_at never lies after the deadline.
-- ---------------------------------------------------------------------------
create function public.close_attempt(p_attempt_id uuid, p_only_if_expired boolean)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid;
begin
  update public.attempts
  set status = 'submitted', submitted_at = least(now(), deadline_at)
  where id = p_attempt_id
    and status = 'in_progress'
    and (not p_only_if_expired or deadline_at <= now())
  returning id into v_id;
  return v_id is not null;
end;
$$;

create function public.close_expired_attempts()
returns setof uuid
language sql
security invoker
set search_path = ''
as $$
  update public.attempts
  set status = 'submitted', submitted_at = deadline_at
  where status = 'in_progress' and deadline_at <= now()
  returning id;
$$;

-- ---------------------------------------------------------------------------
-- record_score: writes the score once. Returns the resulting status ('released' when the
-- exam set does not hold results, else 'submitted'), or null when it was already scored.
-- ---------------------------------------------------------------------------
create function public.record_score(p_attempt_id uuid, p_points integer, p_max_points integer, p_passed boolean)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_status text;
begin
  update public.attempts a
  set points = p_points,
      max_points = p_max_points,
      passed = p_passed,
      status = case when e.hold_result then 'submitted' else 'released' end,
      released_at = case when e.hold_result then null else now() end
  from public.exam_sets e
  where a.id = p_attempt_id
    and e.id = a.exam_set_id
    and a.status = 'submitted'
    and a.points is null
  returning a.status into v_status;
  return v_status;
end;
$$;

-- Database clock for the exam countdown (client clocks are never trusted).
create function public.db_now()
returns timestamptz
language sql
stable
security invoker
set search_path = ''
as $$
  select now();
$$;

revoke all on function
  public.start_attempt(uuid, uuid, jsonb),
  public.save_answer(uuid, uuid, uuid, text),
  public.close_attempt(uuid, boolean),
  public.close_expired_attempts(),
  public.record_score(uuid, integer, integer, boolean),
  public.db_now()
from public, anon, authenticated;
grant execute on function
  public.start_attempt(uuid, uuid, jsonb),
  public.save_answer(uuid, uuid, uuid, text),
  public.close_attempt(uuid, boolean),
  public.close_expired_attempts(),
  public.record_score(uuid, integer, integer, boolean),
  public.db_now()
to service_role;
