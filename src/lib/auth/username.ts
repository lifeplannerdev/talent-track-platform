export const STUDENT_EMAIL_DOMAIN = "students.talenttrack.internal";

/** Maps a student username to the internal email used by Supabase Auth. */
export function usernameToEmail(username: string): string {
  const name = username.trim().toLowerCase();
  if (name.length === 0) {
    throw new Error("Username is required");
  }
  if (/[\s@]/.test(name)) {
    throw new Error("Username must not contain spaces or @");
  }
  return `${name}@${STUDENT_EMAIL_DOMAIN}`;
}
