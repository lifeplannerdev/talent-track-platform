// TEST-ONLY credentials for the local Supabase stack. Never use outside local development.
export const STAFF = { email: "e2e-staff@example.test", password: "e2e-staff-pass-1", fullName: "E2E Staff" };
export const STUDENT_NEW = { username: "e2e.new", password: "e2e-new-pass-1", fullName: "E2E New Student" };
export const STUDENT_CONSENTED = { username: "e2e.done", password: "e2e-done-pass-1", fullName: "E2E Consented Student" };
// Next open exam for STUDENT_NEW: lowest position with status open.
export const NEXT_CURRICULUM = "E2E Curriculum B";
// Exam takers (Task 5): one held-result exam set, one released at once.
export const STUDENT_EXAM = { username: "e2e.exam", password: "e2e-exam-pass-1", fullName: "E2E Exam Student" };
export const STUDENT_EXAM_OPEN = { username: "e2e.examopen", password: "e2e-examopen-pass-1", fullName: "E2E Open Exam Student" };
export const EXAM_CURRICULUM_HELD = "E2E Exam Curriculum Held";
export const EXAM_CURRICULUM_OPEN = "E2E Exam Curriculum Open";
// Blocking (Task 7): a held exam set with 2 attempts and 6 questions (2 per paper), no grant at first.
export const STUDENT_BLOCK = { username: "e2e.block", password: "e2e-block-pass-1", fullName: "E2E Blocked Student" };
export const BLOCK_CURRICULUM = "E2E Blocking Curriculum";
// Staff management (Task 8): a student created through the UI, and the curriculum/exam set staff create.
export const STUDENT_CREATED = { username: "e2e.t8nurse", password: "e2e-t8nurse-pass-1", fullName: "E2E Neue Pflegeschülerin" };
export const STAFF_CURRICULUM = "E2E Staff Curriculum";
export const STAFF_EXAM_SET = "E2E Staff Set";
// Full flow (Task 9): a nursing student and an exam set created through the staff UI.
export const STUDENT_FLOW = { username: "e2e.flownurse", password: "e2e-flownurse-pass-1", fullName: "E2E Jürgen Fluss" };
export const FLOW_CURRICULUM = "E2E Flow Curriculum";
export const FLOW_EXAM_SET = "E2E Flow Prüfung";
