import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/staff" }));

import { STAFF_NAV, visibleNav } from "./staff-nav";

describe("staff navigation", () => {
  it("names the sections after spec change 1: Attempts and Extra attempts, no review, results or grants", () => {
    expect(STAFF_NAV.map((l) => [l.href, l.label])).toEqual([
      ["/staff", "Dashboard"],
      ["/staff/review", "Attempts"],
      ["/staff/blocked", "Blocked"],
      ["/staff/grants", "Extra attempts"],
      ["/staff/students", "Students"],
      ["/staff/curriculums", "Curriculums"],
      ["/staff/questions", "Questions"],
    ]);
  });

  it("shows an admin every section", () => {
    expect(visibleNav("admin")).toHaveLength(STAFF_NAV.length);
  });

  it("hides the admin-only sections (Curriculums, Questions) from a trainer", () => {
    expect(visibleNav("trainer").map((l) => l.label)).toEqual([
      "Dashboard", "Attempts", "Blocked", "Extra attempts", "Students",
    ]);
  });
});
