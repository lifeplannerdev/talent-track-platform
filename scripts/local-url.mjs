// Local-only guard shared by scripts/demo-seed.mjs and e2e/seed.ts (plain ESM so Node runs it
// directly). Both write test users with the service role, so they refuse any Supabase URL that is
// not the local stack: http, host exactly 127.0.0.1 or localhost, no user or password part.

/** Throws unless url is the local Supabase stack. */
export function assertLocalUrl(url) {
  let parsed;
  try {
    parsed = new URL(url ?? "");
  } catch {
    throw new Error("Refusing to run: only the local Supabase stack is allowed (NEXT_PUBLIC_SUPABASE_URL is not a URL)");
  }
  if (
    parsed.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    throw new Error("Refusing to run: only the local Supabase stack is allowed (http://127.0.0.1 or http://localhost)");
  }
}
