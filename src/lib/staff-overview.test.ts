// Pure counting logic of the staff overview on fixed input (no database).
import { describe, expect, it } from "vitest";
import { blockedFrom, grantableFrom, summarizeDashboard, type OverviewInput } from "./staff-overview-core";

const person = (n: string) => ({ full_name: `Student ${n}`, username: `s${n}`, batch: `B${n}` });
const asg = (s: string, c: string, status: "open" | "passed" | "blocked") => ({
  student_id: s,
  curriculum_id: c,
  status,
  student: person(s),
  curriculums: { name: `Curriculum ${c}` },
});
const set = (id: string, c: string, max: number, created: string) => ({
  id,
  name: `Set ${id}`,
  curriculum_id: c,
  max_attempts: max,
  created_at: created,
});
const att = (
  id: string,
  s: string,
  e: string,
  status: "in_progress" | "submitted" | "released",
  points: number | null,
  max: number | null,
  at: string | null,
) => ({ id, student_id: s, exam_set_id: e, status, points, max_points: max, submitted_at: at });

// s1: open in c1 (in progress on e1), blocked in c2 and c3. s2: blocked in c1. s3: passed c1.
// s4: open in c2 with a held result. s5: open in c1, nothing yet. c1 has two exam sets.
const input: OverviewInput = {
  assignments: [
    asg("1", "c1", "open"),
    asg("1", "c2", "blocked"),
    asg("1", "c3", "blocked"),
    asg("2", "c1", "blocked"),
    asg("3", "c1", "passed"),
    asg("4", "c2", "open"),
    asg("5", "c1", "open"),
  ],
  examSets: [set("e1", "c1", 2, "2026-01-01"), set("e1b", "c1", 1, "2026-01-02"), set("e2", "c2", 1, "2026-01-01"), set("e3", "c3", 1, "2026-01-01")],
  attempts: [
    att("a1", "1", "e2", "released", 1, 3, "2026-02-01T10:00:00Z"),
    att("a2", "2", "e1", "released", 0, 2, "2026-01-15T10:00:00Z"),
    att("a3", "2", "e1", "released", 1, 2, "2026-02-02T10:00:00Z"),
    att("a4", "4", "e2", "submitted", 2, 3, "2026-02-03T10:00:00Z"),
    att("a5", "1", "e1", "in_progress", null, null, null),
    att("a6", "1", "e3", "released", 0, 4, "2026-02-04T10:00:00Z"),
    att("a7", "3", "e1", "released", 2, 2, "2026-01-10T10:00:00Z"),
  ],
  grants: [],
};

describe("summarizeDashboard", () => {
  it("counts distinct students per status, held attempts and blocked students exactly", () => {
    const d = summarizeDashboard({ ...input, studentTotal: 6 });
    expect(d.studentTotal).toBe(6);
    expect(d.byStatus).toEqual({ open: 3, passed: 1, blocked: 2 });
    expect(d.awaitingReview).toBe(1);
    expect(d.blockedTotal).toBe(2);
  });

  it("previews each blocked student once (their latest blocked curriculum), matching the total", () => {
    const d = summarizeDashboard({ ...input, studentTotal: 6 });
    expect(d.blockedPreview.map((b) => [b.studentId, b.curriculumId])).toEqual([
      ["1", "c3"],
      ["2", "c1"],
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
  it("lists every blocked assignment, latest failure first, with attempts used and last score", () => {
    const rows = blockedFrom(input);
    expect(rows.map((r) => [r.studentId, r.curriculumId])).toEqual([
      ["1", "c3"],
      ["2", "c1"],
      ["1", "c2"],
    ]);
    expect(rows[1]).toMatchObject({
      examSetId: "e1",
      attemptsUsed: 2,
      maxAttempts: 2,
      lastPoints: 1,
      lastMaxPoints: 2,
      batch: "B2",
      studentName: "Student 2",
    });
  });
});

describe("grantableFrom", () => {
  it("hides a whole curriculum while any attempt in it is in progress or held", () => {
    const rows = grantableFrom(input);
    // s1 (in progress on e1 hides e1b too) and s4 (held on e2) are hidden; s5 gets both c1 sets.
    expect(rows.map((r) => [r.studentId, r.examSetId])).toEqual([
      ["5", "e1"],
      ["5", "e1b"],
    ]);
  });

  it("hides an exam set that already has an unused grant", () => {
    const rows = grantableFrom({ ...input, grants: [{ student_id: "5", exam_set_id: "e1" }] });
    expect(rows.map((r) => [r.studentId, r.examSetId])).toEqual([["5", "e1b"]]);
  });
});
