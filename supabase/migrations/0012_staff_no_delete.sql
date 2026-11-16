-- Staff manage students, curriculums and exam sets but may not delete them through their own
-- session. The foreign keys from attempts (and assignments, grants, questions) cascade, and a
-- cascade runs without RLS, so one staff delete through PostgREST could erase attempts, answers
-- and the scoring snapshot. Removing records stays a service-role operation (the Auth admin API
-- for students). The app never deletes these rows with a staff session.

drop policy profiles_staff_all on public.profiles;
create policy profiles_staff_select on public.profiles
  for select to authenticated
  using ((select private.is_staff()));
create policy profiles_staff_insert on public.profiles
  for insert to authenticated
  with check ((select private.is_staff()));
create policy profiles_staff_update on public.profiles
  for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

drop policy curriculums_staff_all on public.curriculums;
create policy curriculums_staff_select on public.curriculums
  for select to authenticated
  using ((select private.is_staff()));
create policy curriculums_staff_insert on public.curriculums
  for insert to authenticated
  with check ((select private.is_staff()));
create policy curriculums_staff_update on public.curriculums
  for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));

drop policy exam_sets_staff_all on public.exam_sets;
create policy exam_sets_staff_select on public.exam_sets
  for select to authenticated
  using ((select private.is_staff()));
create policy exam_sets_staff_insert on public.exam_sets
  for insert to authenticated
  with check ((select private.is_staff()));
create policy exam_sets_staff_update on public.exam_sets
  for update to authenticated
  using ((select private.is_staff())) with check ((select private.is_staff()));
