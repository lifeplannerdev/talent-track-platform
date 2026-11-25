import { describe, expect, it } from "vitest";
import {
  chooseMode,
  clampIndex,
  counterText,
  fitPageBox,
  nextIndex,
  prevIndex,
  preloadIndexes,
  spreadStart,
  visibleIndexes,
} from "./reader-model";

describe("chooseMode", () => {
  it("uses a spread only on a wide landscape viewport", () => {
    expect(chooseMode({ width: 1280, height: 800 })).toBe("spread");
    expect(chooseMode({ width: 375, height: 812 })).toBe("single");
    expect(chooseMode({ width: 812, height: 375 })).toBe("single"); // phone on its side: too short
    expect(chooseMode({ width: 1024, height: 1366 })).toBe("single"); // tablet upright
    expect(chooseMode({ width: 1366, height: 1024 })).toBe("spread");
  });
});

describe("fitPageBox", () => {
  it("fits one page of the given ratio into the area", () => {
    const box = fitPageBox({ width: 400, height: 800, ratio: 0.5, mode: "single" });
    expect(box).toEqual({ width: 400, height: 800 });
    const wide = fitPageBox({ width: 1000, height: 400, ratio: 0.5, mode: "single" });
    expect(wide).toEqual({ width: 200, height: 400 });
  });
  it("fits two pages side by side in a spread", () => {
    const box = fitPageBox({ width: 1000, height: 1000, ratio: 0.75, mode: "spread" });
    expect(box.width).toBe(500);
    expect(Math.round(box.height)).toBe(667);
    const short = fitPageBox({ width: 2000, height: 600, ratio: 0.75, mode: "spread" });
    expect(short).toEqual({ width: 450, height: 600 });
  });
  it("never returns a zero or negative box", () => {
    const box = fitPageBox({ width: 0, height: 0, ratio: 0.7, mode: "spread" });
    expect(box.width).toBeGreaterThan(0);
    expect(box.height).toBeGreaterThan(0);
  });
});

describe("spreads and indexes", () => {
  it("a spread starts on an even index, a single page on itself", () => {
    expect(spreadStart(0, "spread")).toBe(0);
    expect(spreadStart(1, "spread")).toBe(0);
    expect(spreadStart(5, "spread")).toBe(4);
    expect(spreadStart(5, "single")).toBe(5);
  });
  it("visible pages follow the mode and the page count", () => {
    expect(visibleIndexes(2, 10, "spread")).toEqual([2, 3]);
    expect(visibleIndexes(3, 10, "spread")).toEqual([2, 3]);
    expect(visibleIndexes(9, 10, "spread")).toEqual([8, 9]);
    expect(visibleIndexes(8, 9, "spread")).toEqual([8]);
    expect(visibleIndexes(4, 10, "single")).toEqual([4]);
  });
  it("clamps into range and tolerates an empty chapter", () => {
    expect(clampIndex(-3, 10)).toBe(0);
    expect(clampIndex(99, 10)).toBe(9);
    expect(clampIndex(4, 0)).toBe(0);
  });
  it("next and previous move by a spread or a page and stop at the ends", () => {
    expect(nextIndex(0, 10, "spread")).toBe(2);
    expect(nextIndex(8, 10, "spread")).toBe(8);
    expect(nextIndex(8, 9, "spread")).toBe(8);
    expect(nextIndex(3, 10, "single")).toBe(4);
    expect(nextIndex(9, 10, "single")).toBe(9);
    expect(prevIndex(2, 10, "spread")).toBe(0);
    expect(prevIndex(0, 10, "spread")).toBe(0);
    expect(prevIndex(3, 10, "single")).toBe(2);
    expect(prevIndex(0, 10, "single")).toBe(0);
  });
  it("keeps the page when the mode changes", () => {
    // single page 5 -> spread (4,5) -> single again shows the left page of the spread, never a different chapter page
    expect(spreadStart(5, "spread")).toBe(4);
    expect(visibleIndexes(5, 10, "spread")).toContain(5);
  });
});

describe("counterText", () => {
  it("counts inside the chapter, from 1", () => {
    expect(counterText(0, 3, "single")).toBe("1 / 3");
    expect(counterText(2, 3, "single")).toBe("3 / 3");
    expect(counterText(2, 10, "spread")).toBe("3\u20134 / 10");
    expect(counterText(8, 9, "spread")).toBe("9 / 9");
    expect(counterText(0, 0, "single")).toBe("0 / 0");
  });
});

describe("preloadIndexes", () => {
  it("covers the current pages and a few ahead and one behind", () => {
    expect(preloadIndexes(4, 10, "single")).toEqual([3, 4, 5, 6, 7]);
    expect(preloadIndexes(0, 10, "single")).toEqual([0, 1, 2, 3]);
    expect(preloadIndexes(8, 10, "spread")).toEqual([6, 7, 8, 9]);
  });
});
