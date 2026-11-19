// Spec change 1: marks are shown immediately, so no student-facing source may still promise a
// review or a release by the trainer, or keep an awaiting-review state.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(process.cwd(), "src", "app", "(student)");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

const FORBIDDEN = [
  /awaiting review/i,
  /awaiting release/i,
  /trainer will release/i,
  /releases? it/i,
  /before it is\s+released/i,
  /AwaitingReview/,
  /awaiting-review/,
  /waiting for (your )?(trainer|review)/i,
];

describe("student area copy", () => {
  it("has sources to check", () => {
    expect(sources(ROOT).length).toBeGreaterThan(5);
  });

  for (const file of sources(ROOT)) {
    it(`${file.slice(ROOT.length + 1)} has no review or release promise`, () => {
      const src = readFileSync(file, "utf8");
      for (const pattern of FORBIDDEN) expect(src, String(pattern)).not.toMatch(pattern);
    });
  }
});
