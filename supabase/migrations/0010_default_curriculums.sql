-- The two curriculums every new student gets by track (createStudent, Task 8):
--   track 'nursing' -> Pflege Ausbildung (position 1) and Life in Germany (position 2)
--   track 'other'   -> Life in Germany
-- createStudent looks them up by name. Deterministic ids; existing rows with these names win.

insert into public.curriculums (id, name)
values
  ('00000000-0000-4000-8000-00000000c001', 'Pflege Ausbildung'),
  ('00000000-0000-4000-8000-00000000c002', 'Life in Germany')
on conflict (name) do nothing;
