// listResults pages through every attempt (fetchAll, 1000 rows a page). Paging must use an order
// that cannot change between pages (id), else an attempt submitted meanwhile moves across a page
// boundary and is skipped or listed twice. The display order is applied after collection.
// A fake query builder sorts by whatever .order() calls it gets and lets the test change a row
// between the two page requests.
import { describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  status: "in_progress" | "submitted" | "released";
  started_at: string;
  submitted_at: string | null;
  deadline_at: string;
  released_at: string | null;
  points: number | null;
  max_points: number | null;
  passed: boolean | null;
  student: { full_name: string; username: string; batch: string | null };
  exam_sets: { name: string; curriculum_id: string; curriculums: { name: string } };
};

const db = vi.hoisted(() => ({ rows: [] as Row[], pageCalls: 0, onFirstPage: () => {} }));

function builder(table: string) {
  const orders: { col: keyof Row; ascending: boolean; nullsFirst: boolean }[] = [];
  let range: [number, number] = [0, 999];
  const b = {
    select: () => b,
    in: () => b,
    eq: () => b,
    not: () => b,
    order: (col: keyof Row, opts?: { ascending?: boolean; nullsFirst?: boolean }) => {
      orders.push({ col, ascending: opts?.ascending ?? true, nullsFirst: opts?.nullsFirst ?? false });
      return b;
    },
    range: (from: number, to: number) => {
      range = [from, to];
      return b;
    },
    overrideTypes: () => b,
    then: (resolve: (v: { data: unknown[]; error: null }) => void) => {
      if (table !== "attempts") return resolve({ data: [], error: null });
      const sorted = [...db.rows].sort((x, y) => {
        for (const o of orders) {
          const a = x[o.col] as string | null;
          const c = y[o.col] as string | null;
          if (a === c) continue;
          if (a === null) return o.nullsFirst ? -1 : 1;
          if (c === null) return o.nullsFirst ? 1 : -1;
          return (a < c ? -1 : 1) * (o.ascending ? 1 : -1);
        }
        return 0;
      });
      const page = sorted.slice(range[0], range[1] + 1);
      db.pageCalls += 1;
      if (db.pageCalls === 1) db.onFirstPage();
      resolve({ data: page.map((r) => ({ ...r })), error: null });
    },
  };
  return b;
}

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (t: string) => builder(t) }) }));

const { listResults } = await import("./review");

const pad = (n: number) => String(n).padStart(6, "0");
function row(n: number, submittedAt: string | null): Row {
  return {
    id: `00000000-0000-4000-8000-${pad(n).padStart(12, "0")}`,
    status: submittedAt ? "released" : "in_progress",
    started_at: `2026-01-01T00:00:00.${pad(n)}Z`,
    submitted_at: submittedAt,
    deadline_at: "2026-01-02T00:00:00Z",
    released_at: submittedAt,
    points: submittedAt ? 1 : null,
    max_points: submittedAt ? 2 : null,
    passed: submittedAt ? false : null,
    student: { full_name: `S ${n}`, username: `s${n}`, batch: null },
    exam_sets: { name: "Set", curriculum_id: "c", curriculums: { name: "C" } },
  };
}

describe("listResults paging", () => {
  it("lists every attempt exactly once when one is submitted between two page requests, newest first", async () => {
    // 1200 attempts in progress (running ones are listed first, newest start first) and 300 scored.
    // After the first page, a running attempt from page 1 is submitted: in the display order it
    // moves behind every running attempt, onto page 2, and everything after it shifts up one.
    db.rows = [
      ...Array.from({ length: 1200 }, (_, i) => row(i + 1, null)),
      ...Array.from({ length: 300 }, (_, i) => row(2000 + i, `2026-02-01T00:00:00.${pad(i)}Z`)),
    ];
    const moved = db.rows.find((r) => r.student.username === "s1190")!;
    db.pageCalls = 0;
    db.onFirstPage = () => {
      moved.status = "released";
      moved.submitted_at = "2026-03-01T00:00:00Z";
      moved.released_at = moved.submitted_at;
      moved.points = 1;
      moved.max_points = 2;
      moved.passed = false;
    };

    const { rows } = await listResults({});
    const ids = rows.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(1500);
    // Display order after collection: the 1199 running attempts, then the newest submission.
    expect(rows.slice(0, 1199).every((r) => r.status === "in_progress")).toBe(true);
    expect(rows[1199].id).toBe(moved.id);
  });

  it("puts running attempts first, then by submission time (newest first), then by start, then id", async () => {
    db.rows = [row(1, "2026-02-01T00:00:00Z"), row(2, null), row(3, "2026-02-02T00:00:00Z")];
    db.pageCalls = 0;
    db.onFirstPage = () => {};
    const { rows } = await listResults({});
    expect(rows.map((r) => r.studentName)).toEqual(["S 2", "S 3", "S 1"]);
  });
});
