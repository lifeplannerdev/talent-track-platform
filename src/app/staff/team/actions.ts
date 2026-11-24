"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isUuid } from "@/lib/attempts";
import { requireAdmin } from "@/lib/auth/require-role";
import { isValidUsername } from "@/lib/auth/username";
import { sendAccountInvite } from "@/lib/invites";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAuthUser, existingUsernames } from "@/lib/staff-students";

// Team (trainer) management. Admin only: every action calls requireAdmin() first, so a trainer or
// a student who posts one directly is redirected and nothing runs. profiles are written only with
// the service role (0025). Passwords are generated here, handed to the Auth admin API and never
// logged or returned: a trainer chooses their own through the invite link.

export type TeamResult = { ok: true } | { ok: false; message: string };
/** `invite` "failed": the account exists but the mail did not go out; an admin can resend. */
export type CreateTrainerResult = { ok: true; trainerId: string; invite: "sent" | "failed" } | { ok: false; message: string };
export type ReassignResult = { ok: true; moved: number } | { ok: false; message: string };

// About 100 years: Auth has no "forever", and "none" lifts it again.
const BAN_DURATION = "876000h";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NOT_FOUND = "Trainer not found";

function revalidateTeam() {
  revalidatePath("/staff/team");
  revalidatePath("/staff/students");
  revalidatePath("/staff");
}

function asText(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The id when `id` is a trainer profile (any active state), else null. */
async function findTrainer(admin: SupabaseClient, id: unknown): Promise<{ id: string; active: boolean } | null> {
  if (!isUuid(id)) return null;
  const { data } = await admin.from("profiles").select("id, active").eq("id", id).eq("role", "trainer").maybeSingle<{ id: string; active: boolean }>();
  return data ?? null;
}

async function countStudents(admin: SupabaseClient, trainerId: string): Promise<number> {
  const { count, error } = await admin
    .from("profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "student")
    .eq("trainer_id", trainerId);
  if (error) throw new Error(`Could not count students: ${error.message}`);
  return count ?? 0;
}

export async function createTrainer(input: { email: string; username: string; fullName: string }): Promise<CreateTrainerResult> {
  await requireAdmin();
  const email = asText(input?.email).trim().toLowerCase();
  const username = asText(input?.username).trim().toLowerCase();
  const fullName = asText(input?.fullName).trim();
  if (!EMAIL.test(email)) return { ok: false, message: "Enter a valid email address. The trainer signs in with it." };
  if (!isValidUsername(username)) return { ok: false, message: "Username: use 3-40 characters: letters, digits, dot, underscore or hyphen." };
  if (!fullName || fullName.length > 120) return { ok: false, message: "Enter the trainer's full name (up to 120 characters)." };

  const admin = createAdminClient();
  if ((await existingUsernames(admin, [username])).has(username)) {
    return { ok: false, message: `Username "${username}" is already taken` };
  }
  // One-time password nobody ever sees: the trainer sets their own through the invite link.
  const created = await createAuthUser(admin, {
    email,
    password: randomBytes(32).toString("base64url"),
    appMetadata: { role: "trainer", username, full_name: fullName },
  });
  if (!created.ok) {
    if (created.error?.code === "email_exists") return { ok: false, message: "An account with this email already exists" };
    if ((await existingUsernames(admin, [username])).has(username)) return { ok: false, message: `Username "${username}" is already taken` };
    console.error("createTrainer: createUser failed", created.error?.code ?? "unknown", created.error?.status ?? "");
    return { ok: false, message: "The trainer could not be created. Please try again." };
  }
  revalidateTeam();
  const invite = await sendAccountInvite(created.id);
  return { ok: true, trainerId: created.id, invite };
}

/** Mails the trainer a fresh set-password link (each call makes a new one). */
export async function resendTrainerInvite(trainerId: string): Promise<TeamResult> {
  await requireAdmin();
  const trainer = await findTrainer(createAdminClient(), trainerId);
  if (!trainer) return { ok: false, message: NOT_FOUND };
  if (!trainer.active) return { ok: false, message: "This trainer is deactivated. Reactivate them before sending an invite." };
  if ((await sendAccountInvite(trainer.id)) === "sent") return { ok: true };
  return { ok: false, message: "The invite could not be sent. Please try again." };
}

/**
 * Deactivates or reactivates a trainer. Deactivating is refused while the trainer has students
 * (reassign them first). Order: profiles.active=false first (every policy and requireRole treat
 * the account as gone at once), then the Auth ban (no new password sign-in), then
 * revoke_user_sessions (live sessions end). A failure part-way therefore leaves the account
 * inactive, never banned-but-active; retrying finishes the job. Reactivating lifts the ban first
 * and sets active last, for the same reason.
 */
export async function setTrainerActive(trainerId: string, active: boolean): Promise<TeamResult> {
  await requireAdmin();
  const admin = createAdminClient();
  const trainer = await findTrainer(admin, trainerId);
  if (!trainer) return { ok: false, message: NOT_FOUND };

  if (active) {
    const { error: unban } = await admin.auth.admin.updateUserById(trainer.id, { ban_duration: "none" });
    if (unban) {
      console.error("setTrainerActive: lifting the ban failed", unban.code ?? unban.status ?? "unknown");
      return { ok: false, message: "The trainer could not be reactivated. Please try again." };
    }
    const { error } = await admin.from("profiles").update({ active: true }).eq("id", trainer.id).eq("role", "trainer");
    if (error) {
      console.error("setTrainerActive: activating failed", error.code ?? "unknown");
      return { ok: false, message: "The trainer could not be reactivated. Please try again." };
    }
    revalidateTeam();
    return { ok: true };
  }

  const students = await countStudents(admin, trainer.id);
  if (students > 0) {
    return {
      ok: false,
      message: `This trainer still has ${students} student${students === 1 ? "" : "s"}. Reassign them to another trainer first.`,
    };
  }
  const { error: flagError } = await admin.from("profiles").update({ active: false }).eq("id", trainer.id).eq("role", "trainer");
  if (flagError) {
    console.error("setTrainerActive: deactivating failed", flagError.code ?? "unknown");
    return { ok: false, message: "The trainer could not be deactivated. Please try again." };
  }
  // A student could have been assigned between the check and the flag: undo rather than orphan them.
  const late = await countStudents(admin, trainer.id);
  if (late > 0) {
    const { error: undoError } = await admin.from("profiles").update({ active: true }).eq("id", trainer.id).eq("role", "trainer");
    if (undoError) {
      console.error("setTrainerActive: undoing the deactivation failed", undoError.code ?? "unknown");
      revalidateTeam();
      return {
        ok: false,
        message:
          "A student was just assigned to this trainer, and the trainer is marked inactive but has students. Reactivate the trainer or reassign the students, then try again.",
      };
    }
    return { ok: false, message: "A student was just assigned to this trainer. Reassign them first." };
  }
  const { error: banError } = await admin.auth.admin.updateUserById(trainer.id, { ban_duration: BAN_DURATION });
  if (banError) {
    console.error("setTrainerActive: ban failed", banError.code ?? banError.status ?? "unknown");
    revalidateTeam();
    return { ok: false, message: "The trainer is marked inactive, but sign-in could not be blocked. Try Deactivate again." };
  }
  const { error: revokeError } = await admin.rpc("revoke_user_sessions", { p_user_id: trainer.id });
  revalidateTeam();
  if (revokeError) {
    console.error("setTrainerActive: revoke_user_sessions failed", revokeError.code ?? "unknown");
    return { ok: false, message: "The trainer is deactivated and blocked, but their open sessions could not be ended. Try Deactivate again." };
  }
  return { ok: true };
}

/** Moves every student of one trainer to another (active) trainer in a single update. */
export async function reassignStudents(input: { fromTrainerId: string; toTrainerId: string }): Promise<ReassignResult> {
  await requireAdmin();
  const admin = createAdminClient();
  const from = await findTrainer(admin, input?.fromTrainerId);
  const to = await findTrainer(admin, input?.toTrainerId);
  if (!from || !to) return { ok: false, message: NOT_FOUND };
  if (from.id === to.id) return { ok: false, message: "Choose a different trainer to move the students to." };
  if (!to.active) return { ok: false, message: "Choose an active trainer to move the students to." };

  const { data, error } = await admin
    .from("profiles")
    .update({ trainer_id: to.id })
    .eq("role", "student")
    .eq("trainer_id", from.id)
    .select("id");
  if (error) {
    console.error("reassignStudents failed", error.code ?? "unknown");
    return { ok: false, message: "The students could not be reassigned. Please try again." };
  }
  revalidateTeam();
  return { ok: true, moved: data?.length ?? 0 };
}
