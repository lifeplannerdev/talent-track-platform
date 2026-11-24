// One-off: creates a staff account (the first one in production, or any later one) with the
// Auth admin API. Public sign-up is off, so this is how the first admin gets in; after that
// admins add trainers in the app (Team) too. The on_auth_user_created trigger builds the profile
// from app_metadata { role, username, full_name }. STAFF_ROLE is "admin" (default) or "trainer".
//
// Run (Node 22.18+ runs TypeScript directly), with the values in the environment, never as
// arguments (they would land in shell history):
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... STAFF_EMAIL=... STAFF_USERNAME=... \
//   STAFF_FULL_NAME=... STAFF_PASSWORD=... [STAFF_ROLE=admin|trainer] node scripts/create-staff.ts
// The password and the service role key are never printed. Staff sign in with the email.
import { createClient } from "@supabase/supabase-js";
import { pathToFileURL } from "node:url";

type Env = Record<string, string | undefined>;

export type StaffUser = {
  email: string;
  password: string;
  email_confirm: true;
  app_metadata: { role: "admin" | "trainer"; username: string; full_name: string };
};

export type StaffAccount =
  | { ok: true; url: string; serviceRoleKey: string; user: StaffUser }
  | { ok: false; errors: string[] };

const MIN_PASSWORD = 12;

/** Checks the environment and builds the createUser payload. Errors never contain the password. */
export function staffAccountFromEnv(env: Env): StaffAccount {
  const errors: string[] = [];
  const need = (name: string) => {
    const v = env[name] ?? "";
    if (!v) errors.push(`${name} is required`);
    return v;
  };
  const url = need("SUPABASE_URL");
  const serviceRoleKey = need("SUPABASE_SERVICE_ROLE_KEY");
  const email = need("STAFF_EMAIL").trim().toLowerCase();
  const username = need("STAFF_USERNAME").trim();
  const fullName = need("STAFF_FULL_NAME").trim();
  const password = need("STAFF_PASSWORD");

  const roleValue = env.STAFF_ROLE ?? "";
  const role = roleValue === "" ? "admin" : roleValue;
  if (role !== "admin" && role !== "trainer") errors.push("STAFF_ROLE must be admin or trainer");

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("STAFF_EMAIL must be an email address");
  if (username && !/^[a-z0-9._-]+$/.test(username)) errors.push("STAFF_USERNAME may only contain a-z, 0-9, dot, dash and underscore");
  if (password) {
    if (password.trim() !== password) errors.push("STAFF_PASSWORD must not start or end with a space");
    else if (password.length < MIN_PASSWORD) errors.push(`STAFF_PASSWORD must be at least ${MIN_PASSWORD} characters`);
  }
  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    url,
    serviceRoleKey,
    user: { email, password, email_confirm: true, app_metadata: { role: role as "admin" | "trainer", username, full_name: fullName } },
  };
}

type Admin = {
  createUser: (
    user: StaffUser,
  ) => Promise<{ data: { user: { id: string } | null }; error: { message: string; code?: string } | null }>;
};

/** Creates the account. Returns the process exit code. Logs only the user id or an error code. */
export async function createStaff(env: Env, admin?: Admin, log: (line: string) => void = console.log): Promise<number> {
  const account = staffAccountFromEnv(env);
  if (!account.ok) {
    for (const e of account.errors) log(`error: ${e}`);
    return 1;
  }
  const api: Admin =
    admin ??
    createClient(account.url, account.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }).auth.admin;
  const { data, error } = await api.createUser(account.user);
  if (error || !data.user) {
    log(`error: the staff account could not be created (${error?.code ?? "unknown"})`);
    return 1;
  }
  log(`Created ${account.user.app_metadata.role} account ${account.user.app_metadata.username} <${account.user.email}> (id ${data.user.id}).`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createStaff(process.env).then((code) => process.exit(code));
}
