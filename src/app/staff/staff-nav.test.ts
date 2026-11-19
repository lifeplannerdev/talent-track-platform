import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/staff" }));

import { STAFF_LINKS } from "./staff-nav";

describe("staff navigation", () => {
  it("names the sections after spec change 1: Attempts and Extra attempts, no review, results or grants", () => {
    expect(STAFF_LINKS.map((l) => [l.href, l.label])).toEqual([
      ["/staff", "Dashboard"],
      ["/staff/review", "Attempts"],
      ["/staff/blocked", "Blocked"],
      ["/staff/grants", "Extra attempts"],
      ["/staff/students", "Students"],
      ["/staff/curriculums", "Curriculums"],
      ["/staff/questions", "Questions"],
    ]);
  });
});
