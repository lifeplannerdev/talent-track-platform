import { describe, expect, it } from "vitest";
import { dayPeriod, firstName, greeting } from "./greeting";

// Times are given in UTC; India (Asia/Kolkata) is UTC+05:30 all year.
const ist = (hh: number, mm = 0) => new Date(Date.UTC(2026, 10, 18, hh, mm) - (5 * 60 + 30) * 60_000);

describe("dayPeriod (India time)", () => {
  it("is morning from 05:00 to 11:59", () => {
    expect(dayPeriod(ist(5))).toBe("morning");
    expect(dayPeriod(ist(11, 59))).toBe("morning");
  });
  it("is afternoon from 12:00 to 16:59", () => {
    expect(dayPeriod(ist(12))).toBe("afternoon");
    expect(dayPeriod(ist(16, 59))).toBe("afternoon");
  });
  it("is evening from 17:00 to 04:59", () => {
    expect(dayPeriod(ist(17))).toBe("evening");
    expect(dayPeriod(ist(23, 30))).toBe("evening");
    expect(dayPeriod(ist(0, 15))).toBe("evening");
    expect(dayPeriod(ist(4, 59))).toBe("evening");
  });
  it("uses India time, not the server clock: 03:00 UTC is 08:30 in Kerala", () => {
    expect(dayPeriod(new Date(Date.UTC(2026, 10, 18, 3, 0)))).toBe("morning");
    // 20:00 UTC is 01:30 the next day in Kerala.
    expect(dayPeriod(new Date(Date.UTC(2026, 10, 18, 20, 0)))).toBe("evening");
  });
});

describe("firstName", () => {
  it("takes the first word of the full name", () => {
    expect(firstName("Anjali Menon", "anjali.m")).toBe("Anjali");
    expect(firstName("  Rahul   K  ", "rahul")).toBe("Rahul");
  });
  it("falls back to the username when there is no full name", () => {
    expect(firstName(null, "demo.student")).toBe("demo.student");
    expect(firstName("   ", "demo.student")).toBe("demo.student");
  });
  it("returns null when neither is usable", () => {
    expect(firstName(null, "")).toBeNull();
    expect(firstName(undefined, undefined)).toBeNull();
  });
});

describe("greeting", () => {
  it("greets by first name", () => {
    expect(greeting({ fullName: "Anjali Menon", username: "anjali" }, ist(9))).toBe("Good morning, Anjali");
    expect(greeting({ fullName: "Anjali Menon", username: "anjali" }, ist(14))).toBe("Good afternoon, Anjali");
    expect(greeting({ fullName: "Anjali Menon", username: "anjali" }, ist(19))).toBe("Good evening, Anjali");
  });
  it("greets without a name when none is known", () => {
    expect(greeting({ fullName: null, username: "" }, ist(9))).toBe("Good morning");
  });
});
