-- Security review L1: staff-session write limits, part 2 (same style as 0023).
--
-- profiles: rows are created by the on_auth_user_created trigger (Auth admin API) and consent is
-- written with the service role; no staff-session code writes profiles. A staff token could
-- still INSERT or UPDATE any column (role, id) through profiles_staff_insert/update, for example
-- making a student staff. authenticated keeps SELECT only; the two staff write policies go.
-- curriculums: staff edit name and max_attempts (saveCurriculum) and insert new ones.
-- questions: staff edit topic, difficulty, stem_de, stem_en, options, correct_option_id, points
-- and status (saveQuestion, setQuestionStatus) and insert (form, CSV import); a question never
-- moves to another exam set. UPDATE becomes column-level; INSERT and SELECT are unchanged.
-- The service role is unaffected.

revoke insert, update on public.profiles from authenticated;
drop policy if exists profiles_staff_insert on public.profiles;
drop policy if exists profiles_staff_update on public.profiles;

revoke update on public.curriculums from authenticated;
grant update (name, max_attempts) on public.curriculums to authenticated;

revoke update on public.questions from authenticated;
grant update (topic, difficulty, stem_de, stem_en, options, correct_option_id, points, status)
  on public.questions to authenticated;
