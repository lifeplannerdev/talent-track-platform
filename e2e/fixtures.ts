// TEST-ONLY credentials for the local Supabase stack. Never use outside local development.
export const STAFF = { email: "e2e-staff@example.test", password: "e2e-staff-pass-1", fullName: "E2E Staff" };
export const STUDENT_NEW = { username: "e2e.new", password: "e2e-new-pass-1", fullName: "E2E New Student" };
export const STUDENT_CONSENTED = { username: "e2e.done", password: "e2e-done-pass-1", fullName: "E2E Consented Student" };
// Next open exam for STUDENT_NEW: lowest position with status open.
export const NEXT_CURRICULUM = "E2E Curriculum B";
