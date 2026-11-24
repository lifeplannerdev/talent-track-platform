// TEST-ONLY credentials for the local Supabase stack. Never use outside local development.
// Spec change 1: every curriculum is its own exam (any order) with 2 attempts per student by
// default, each attempt on a different exam set; results are shown at once; staff give extra attempts.
export const STAFF = { email: "e2e-staff@example.test", password: "e2e-staff-pass-1", fullName: "E2E Staff" };
export const STUDENT_NEW = { username: "e2e.new", password: "e2e-new-pass-1", fullName: "E2E New Student" };
export const STUDENT_CONSENTED = { username: "e2e.done", password: "e2e-done-pass-1", fullName: "E2E Consented Student" };
// STUDENT_NEW: A passed (position 1), B ready (one exam set, position 2), C without exam sets (position 3).
export const NEW_CURRICULUM_PASSED = "E2E Curriculum A";
export const NEW_CURRICULUM_READY = "E2E Curriculum B";
export const NEW_CURRICULUM_EMPTY = "E2E Curriculum C";
// STUDENT_EXAM: two independent curriculums with two exam sets of 3 questions each.
// EXAM_CURRICULUM has a 60% pass mark (2 of 3 = 66.7% passes); EXAM_CURRICULUM_TWO the 90% default.
export const STUDENT_EXAM = { username: "e2e.exam", password: "e2e-exam-pass-1", fullName: "E2E Exam Student" };
export const EXAM_CURRICULUM = "E2E Exam Curriculum";
export const EXAM_CURRICULUM_TWO = "E2E Exam Curriculum Two";
// STUDENT_EXAM_OPEN: one curriculum with one exam set of 3 questions, 90% default pass mark.
export const STUDENT_EXAM_OPEN = { username: "e2e.examopen", password: "e2e-examopen-pass-1", fullName: "E2E Open Exam Student" };
export const EXAM_CURRICULUM_OPEN = "E2E Exam Curriculum Open";
// STUDENT_BLOCK: BLOCK_CURRICULUM has two exam sets of 2 questions and a 100% pass mark (the student
// answers "Ja", the key is "Nein", so every attempt fails); BLOCK_OTHER_CURRICULUM stays independent.
export const STUDENT_BLOCK = { username: "e2e.block", password: "e2e-block-pass-1", fullName: "E2E Blocked Student" };
export const BLOCK_CURRICULUM = "E2E Blocking Curriculum";
export const BLOCK_OTHER_CURRICULUM = "E2E Blocking Other Curriculum";
// Staff management: a student created through the UI, and the curriculum/exam set staff create.
export const STUDENT_CREATED = { username: "e2e.t8nurse", password: "e2e-t8nurse-pass-1", fullName: "E2E Neue Pflegeschülerin" };
export const STAFF_CURRICULUM = "E2E Staff Curriculum";
export const STAFF_EXAM_SET = "E2E Staff Set";
// Full flow: a nursing student and an exam set created through the staff UI.
export const STUDENT_FLOW = { username: "e2e.flownurse", password: "e2e-flownurse-pass-1", fullName: "E2E Jürgen Fluss" };
export const FLOW_CURRICULUM = "E2E Flow Curriculum";
export const FLOW_EXAM_SET = "E2E Flow Prüfung";
// Roles (v2 phase 1): two trainers, each with one student, so scope can be checked in both directions.
// STUDENT_OF_ONE belongs to TRAINER_ONE (with a contact email), STUDENT_OF_TWO to TRAINER_TWO.
export const TRAINER_ONE = { username: "e2e.trainer1", email: "e2e-trainer1@example.test", password: "e2e-trainer1-pass-1", fullName: "E2E Trainer One" };
export const TRAINER_TWO = { username: "e2e.trainer2", email: "e2e-trainer2@example.test", password: "e2e-trainer2-pass-1", fullName: "E2E Trainer Two" };
export const STUDENT_OF_ONE = { username: "e2e.ofone", password: "e2e-ofone-pass-1", fullName: "E2E Student Of One", contactEmail: "ofone@example.test" };
export const STUDENT_OF_TWO = { username: "e2e.oftwo", password: "e2e-oftwo-pass-1", fullName: "E2E Student Of Two", contactEmail: "oftwo@example.test" };
// A student a trainer adds through the form (deleted again by the spec).
export const STUDENT_BY_TRAINER = { username: "e2e.bytrainer", password: "e2e-bytrainer-pass-1", fullName: "E2E Von Trainer", contactEmail: "bytrainer@example.test" };
// A trainer an admin adds through the Team page (deleted again by the spec).
export const TRAINER_ADDED = { username: "e2e.trainer3", email: "e2e-trainer3@example.test", fullName: "E2E Trainer Three" };
