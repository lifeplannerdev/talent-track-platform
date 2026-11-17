-- Security review S1: public.student_questions (0001) ran with the view owner's rights and let a
-- signed-in student read stem_en and the English option text of their own in-progress paper
-- through PostgREST, although the exam is German only. The app never used it: students get their
-- paper from server code (getAttemptForStudent, service role, German text only) and their
-- result from student_attempts. Dropping the view also drops its grants.
drop view if exists public.student_questions;
