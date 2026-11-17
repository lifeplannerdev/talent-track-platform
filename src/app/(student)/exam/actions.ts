"use server";

import { redirect } from "next/navigation";
import { requireStudentWithConsent } from "@/lib/auth/require-role";
import {
  AttemptError,
  getAttemptStatus,
  isUuid,
  saveAnswer,
  startAttempt,
  submitAttempt,
  type AttemptErrorCode,
} from "@/lib/attempts";
import { getExamStartState } from "@/lib/exam-start";

// Every action authenticates itself (requireStudentWithConsent calls getUser and refuses a
// student without consent) and uses the session's user id. Ids from the client are only used together with that id.

/** Starts (or resumes) the student's next exam. The exam set is chosen on the server. */
export async function startExam(): Promise<void> {
  const profile = await requireStudentWithConsent();
  const state = await getExamStartState(profile.id);
  if (state.kind === "in_progress") redirect(`/exam/${state.attemptId}`);
  if (state.kind !== "ready") redirect("/exam/start");

  let attemptId: string;
  try {
    ({ attemptId } = await startAttempt(profile.id, state.examSet.id));
  } catch (e) {
    if (e instanceof AttemptError) redirect(`/exam/start?error=${e.code}`);
    throw e;
  }
  redirect(`/exam/${attemptId}`);
}

export type SaveResult = { ok: true } | { ok: false; code: AttemptErrorCode | "invalid_request" };

export async function saveAnswerAction(
  attemptId: string,
  attemptQuestionId: string,
  optionId: string,
): Promise<SaveResult> {
  const profile = await requireStudentWithConsent();
  if (!isUuid(attemptId) || !isUuid(attemptQuestionId) || typeof optionId !== "string" || optionId.length > 64) {
    return { ok: false, code: "invalid_request" };
  }
  try {
    await saveAnswer(profile.id, attemptId, attemptQuestionId, optionId);
    return { ok: true };
  } catch (e) {
    if (e instanceof AttemptError) return { ok: false, code: e.code };
    throw e;
  }
}

/** Submits the student's own attempt (also used by the client when the timer runs out). */
export async function submitExam(attemptId: string): Promise<void> {
  const profile = await requireStudentWithConsent();
  const status = await getAttemptStatus(profile.id, attemptId);
  if (!status) redirect("/exam/start");
  // Idempotent: also finishes scoring if an earlier submit was interrupted.
  if (status !== "released") await submitAttempt(attemptId);
  redirect(`/results/${attemptId}`);
}
