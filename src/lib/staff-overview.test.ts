// Pure counting logic of the staff overview on fixed input (no database).
import { describe, expect, it } from "vitest";
import { blockedFrom, extraAttemptCandidatesFrom, summarizeDashboard, type OverviewInput } from "./staff-overview-core";

const person = (n: string) => ({ full_name: `Student ${n}`, username: `s${n}`, batch: `B${n}` });
const asg = (s: string, c: string, status: "open" | "passed" | "blocked", max = 2, extra = 0, allowRepeats = false) => ({
  student_id: s,
  curriculum_id: c,
  status,
  extra_attempts: extra,
  allow_repeats: allowRepeats,
  student: person(s),
  curriculums: { name: `Curriculum ${c}`, max_attempts: max },
});
const set = (id: string, c: string, created: string) => ({ id, name: `Set ${id}`, curriculum_id: c, created_at: created });
const att = (
  id: string,
  s: string,
  e: string,
  status: "in_progress" | "submitted" | "released",
  points: number | null,
  max: number | null,
  at: string | null,
) => ({ id, student_id: s, exam_set_id: e, status, points, max_points: max, submitted_at: at });

// c1 has exam sets e1, e1b (2 attempts allowed); c2 has e2 only; c3 has e3 only (1 attempt allowed).
// s1: open in c1 (in progress on e1), blocked in c2 and c3. s2: blocked in c1 after two fails.
// s3: passed c1. s4: open in c2, used e2 once (1 of 2): no exam set left. s5: open in c1, nothing yet.
// s6: open in c1 but both attempts used and failed (legacy state): counts as blocked.
// s7: open in c2 with e2 used but allow_repeats: not short.
const input: OverviewInput = {
  assignments: [
    asg("1", "c1", "open"),
    asg("1", "c2", "blocked"),
    asg("1", "c3", "blocked", 1),
    asg("2", "c1", "blocked"),
    asg("3", "c1", "passed"),
    asg("4", "c2", "open"),
    asg("5", "c1", "open"),
    asg("6", "c1", "open"),
    asg("7", "c2", "open", 2, 0, true),
  ],
  examSets: [set("e1", "c1", "2026-01-01"), set("e1b", "c1", "2026-01-02"), set("e2", "c2", "2026-01-01"), set("e3", "c3", "2026-01-01")],
  attempts: [
    att("a1", "1", "e2", "released", 1, 3, "2026-02-01T10:00:00Z"),
    att("a2", "2", "e1", "released", 0, 2, "2026-01-15T10:00:00Z"),
    att("a3", "2", "e1b", "released", 1, 2, "2026-02-02T10:00:00Z"),
    att("a4", "4", "e2", "released", 2, 3, "2026-02-03T10:00:00Z"),
    att("a5", "1", "e1", "in_progress", null, null, null),
    att("a6", "1", "e3", "released", 0, 4, "2026-02-04T10:00:00Z"),
    att("a7", "3", "e1", "released", 2, 2, "2026-01-10T10:00:00Z"),
    att("a8", "6", "e1", "released", 0, 2, "2026-01-05T10:00:00Z"),
    att("a9", "6", "e1b", "released", 0, 2, "2026-01-06T10:00:00Z"),
    att("a10", "7", "e2", "released", 0, 2, "2026-01-07T10:00:00Z"),
  ],
};

describe("summarizeDashboard", () => {
  it("counts distinct students per status (open with no attempts left counts as blocked) and students short of exam sets", () => {
    const d = summarizeDashboard({ ...input, studentTotal: 8 });
    expect(d.studentTotal).toBe(8);
    expect(d.byStatus).toEqual({ open: 4, passed: 1, blocked: 3 });
    expect(d.blockedTotal).toBe(3);
    expect(d.examSetsShort).toBe(1);
    expect(d).not.toHaveProperty("awaitingReview");
  });

  it("previews each blocked student once (their latest blocked curriculum), matching the total", () => {
    const d = summarizeDashboard({ ...input, studentTotal: 8 });
    expect(d.blockedPreview.map((b) => [b.studentId, b.curriculumId])).toEqual([
      ["1", "c3"],
      ["2", "c1"],
      ["6", "c1"],
    ]);
    expect(d.blockedPreview).toHaveLength(d.blockedTotal);
  });

  it("caps the preview at five students", () => {
    const many: OverviewInput = {
      ...input,
      assignments: Array.from({ length: 7 }, (_, i) => asg(`x${i}`, "c1", "blocked")),
      attempts: [],
    };
    const d = summarizeDashboard({ ...many, studentTotal: 7 });
    expect(d.blockedTotal).toBe(7);
    expect(d.blockedPreview).toHaveLength(5);
  });
});

describe("blockedFrom", () => {
  it("lists every blocked assignment, latest failure first, with the per-curriculum allowance and last score", () => {
    const rows = blockedFrom(input);
    expect(rows.map((r) => [r.studentId, r.curriculumId])).toEqual([
      ["1", "c3"],
      ["2", "c1"],
      ["1", "c2"],
      ["6", "c1"],
    ]);
    expect(rows[1]).toEqual({
      studentId: "2",
      studentName: "Student 2",
      batch: "B2",
      curriculumId: "c1",
      curriculumName: "Curriculum c1",
      attemptsUsed: 2,
      allowance: 2,
      examSetsLeft: 0,
      lastExamSetName: "Set e1b",
      lastPoints: 1,
      lastMaxPoints: 2,
      lastAttemptAt: "2026-02-02T10:00:00Z",
    });
    expect(rows[2]).toMatchObject({ attemptsUsed: 1, allowance: 2, examSetsLeft: 0 });
  });

  it("an open curriculum with no attempts left is not blocked while an attempt is in progress or being calculated", () => {
    const busy: OverviewInput = {
      ...input,
      assignments: [asg("8", "c3", "open", 1)],
      attempts: [att("b1", "8", "e3", "submitted", null, null, "2026-03-01T10:00:00Z")],
    };
    expect(blockedFrom(busy)).toEqual([]);
  });
});

describe("extraAttemptCandidatesFrom", () => {
  it("lists blocked students and open ones with attempts left but no unused exam set (repeats not allowed)", () => {
    const rows = extraAttemptCandidatesFrom(input);
    expect(rows.map((r) => [r.studentId, r.curriculumId, r.reason])).toEqual([
      ["1", "c2", "blocked"],
      ["1", "c3", "blocked"],
      ["2", "c1", "blocked"],
      ["4", "c2", "no_exam_sets_left"],
      ["6", "c1", "blocked"],
    ]);
    expect(rows[3]).toEqual({
      studentId: "4",
      studentName: "Student 4",
      batch: "B4",
      curriculumId: "c2",
      curriculumName: "Curriculum c2",
      reason: "no_exam_sets_left",
      attemptsUsed: 1,
      allowance: 2,
      examSetsLeft: 0,
      allowRepeats: false,
    });
  });
});
