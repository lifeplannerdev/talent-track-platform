"use server";

import { redirect } from "next/navigation";
import { requireStudentWithConsent } from "@/lib/auth/require-role";
import {
  AttemptError,
  getAttemptStatus,
  isUuid,
  saveAnswer,
  StartError,
  startAttempt,
  submitAttempt,
  type AttemptErrorCode,
} from "@/lib/attempts";
import { getExamStartState } from "@/lib/exam-start";

// Every action authenticates itself (requireStudentWithConsent calls getUser and refuses a
// student without consent) and uses the session's user id. Ids from the client are only used together with that id.

/**
 * Starts (or resumes) the student's exam in one assigned curriculum. The exam set is chosen on
 * the server (startAttempt). On a refusal the start page shows why (?error=<code>).
 */
export async function startExam(curriculumId: string): Promise<void> {
  const profile = await requireStudentWithConsent();
  if (!isUuid(curriculumId)) redirect("/exam/start?error=not_open");

  let attemptId: string;
  try {
    ({ attemptId } = await startAttempt(profile.id, curriculumId));
  } catch (e) {
    if (e instanceof StartError) {
      // A second click or tab lost the race: go to the attempt that won.
      if (e.code === "in_progress") {
        const card = (await getExamStartState(profile.id)).find((c) => c.curriculumId === curriculumId);
        if (card?.kind === "in_progress" && card.attemptId) redirect(`/exam/${card.attemptId}`);
      }
      redirect(`/exam/start?error=${e.code}`);
    }
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

/**
 * Submits the student's own attempt (also used by the client when the timer runs out); it is
 * scored and released at once, so the student goes straight to the result.
 */
export async function submitExam(attemptId: string): Promise<void> {
  const profile = await requireStudentWithConsent();
  const status = await getAttemptStatus(profile.id, attemptId);
  if (!status) redirect("/exam/start");
  // Idempotent: also finishes scoring if an earlier submit was interrupted.
  if (status !== "released") await submitAttempt(attemptId);
  redirect(`/results/${attemptId}`);
}
