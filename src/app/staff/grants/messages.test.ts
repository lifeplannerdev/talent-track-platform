import { describe, expect, it } from "vitest";
import { grantMessage } from "./messages";

describe("grantMessage", () => {
  it("words the shortfall with singular and plural", () => {
    expect(grantMessage({ ok: false, error: "shortfall", unseenAvailable: 1, needed: 2 })).toBe(
      "Only 1 unseen question left, 2 needed",
    );
    expect(grantMessage({ ok: false, error: "shortfall", unseenAvailable: 0, needed: 2 })).toBe(
      "Only 0 unseen questions left, 2 needed",
    );
    expect(grantMessage({ ok: false, error: "shortfall", unseenAvailable: 3, needed: 5 })).toBe(
      "Only 3 unseen questions left, 5 needed",
    );
  });

  it("explains a held result", () => {
    expect(grantMessage({ ok: false, error: "result_pending" })).toMatch(/result .* awaiting release/i);
  });

  it("falls back to a generic message", () => {
    expect(grantMessage({ ok: false, error: "failed" })).toBe("The attempt could not be granted. Please try again.");
  });
});
