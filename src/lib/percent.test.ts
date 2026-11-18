import { describe, expect, it } from "vitest";
import { DEFAULT_PASS_MARK_PERCENT, formatPercent, meetsPassMark, percentValue } from "./percent";

describe("DEFAULT_PASS_MARK_PERCENT", () => {
  it("is the standard pass mark of 90%", () => {
    expect(DEFAULT_PASS_MARK_PERCENT).toBe(90);
  });
});

describe("meetsPassMark (exact integer comparison, no float rounding)", () => {
  it("passes exactly at the pass mark", () => {
    expect(meetsPassMark(9, 10, 90)).toBe(true);
    expect(meetsPassMark(18, 20, 90)).toBe(true);
    expect(meetsPassMark(27, 30, 90)).toBe(true);
  });
  it("fails just below the pass mark, even when the rounded percent would reach it", () => {
    expect(meetsPassMark(17, 19, 90)).toBe(false); // 89.47%
    expect(meetsPassMark(224, 250, 90)).toBe(false); // 89.6%
    expect(meetsPassMark(1799, 2000, 90)).toBe(false); // 89.95%
  });
  it("handles cases where float division is inexact", () => {
    // 0.7 * 100 and 7 / 10 are not exact in binary floating point.
    expect(meetsPassMark(7, 10, 70)).toBe(true);
    expect(meetsPassMark(57, 100, 57)).toBe(true);
    expect(meetsPassMark(29, 50, 58)).toBe(true);
  });
  it("treats 0 and 100 as edges", () => {
    expect(meetsPassMark(0, 10, 0)).toBe(true);
    expect(meetsPassMark(10, 10, 100)).toBe(true);
    expect(meetsPassMark(9, 10, 100)).toBe(false);
  });
  it("never passes an empty paper", () => {
    expect(meetsPassMark(0, 0, 0)).toBe(false);
  });
});

describe("formatPercent", () => {
  it("shows whole percentages without decimals", () => {
    expect(formatPercent(23, 25)).toBe("92%");
    expect(formatPercent(9, 10)).toBe("90%");
    expect(formatPercent(25, 25)).toBe("100%");
    expect(formatPercent(0, 25)).toBe("0%");
  });
  it("shows one decimal when the percentage is not whole", () => {
    expect(formatPercent(2, 3)).toBe("66.7%");
    expect(formatPercent(1, 3)).toBe("33.3%");
    expect(formatPercent(17, 19)).toBe("89.5%");
    expect(formatPercent(224, 250)).toBe("89.6%");
  });
  it("never rounds up to a whole number, so a fail never reads as the pass mark", () => {
    expect(formatPercent(1799, 2000)).toBe("89.9%"); // 89.95%, not "90%"
    expect(formatPercent(1999, 2000)).toBe("99.9%"); // 99.95%, not "100%"
  });
  it("may round down to a whole number (never crosses a pass mark upwards)", () => {
    expect(formatPercent(2251, 2500)).toBe("90%"); // 90.04%
  });
  it("shows 0% for an empty paper", () => {
    expect(formatPercent(0, 0)).toBe("0%");
  });
});

describe("percentValue", () => {
  it("returns the share as a number for bars", () => {
    expect(percentValue(23, 25)).toBe(92);
    expect(percentValue(0, 0)).toBe(0);
    expect(percentValue(1, 3)).toBeCloseTo(33.333, 2);
  });
});
