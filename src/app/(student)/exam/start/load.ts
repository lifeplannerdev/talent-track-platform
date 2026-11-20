import "server-only";
import { getExamStartState } from "@/lib/exam-start";
import { listStudentResults } from "@/lib/results";

/**
 * Data for the student start page. getExamStartState settles the attempts first (lazy expiry,
 * scoring); the results are read only afterwards, so both show the same, healed state.
 */
export async function loadStartPage(studentId: string) {
  const cards = await getExamStartState(studentId);
  const results = await listStudentResults(studentId);
  return { cards, results };
}
