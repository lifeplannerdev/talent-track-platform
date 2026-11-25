import { describe, expect, it } from "vitest";
import { decideImageError, RETRY_COOLDOWN_MS } from "./retry-policy";

describe("decideImageError", () => {
  const first = {};
  const fresh = {};

  it("refreshes on the first failure", () => {
    const d = decideImageError(null, 1000, first);
    expect(d.action).toBe("refresh");
    expect(d.state).toEqual({ startedAt: 1000, pagesToken: first });
  });

  it("ignores failures that arrive while the refresh is in flight", () => {
    const started = decideImageError(null, 1000, first).state;
    expect(decideImageError(started, 1100, first).action).toBe("ignore");
    expect(decideImageError(started, 1200, first).action).toBe("ignore");
  });

  it("reports a failure after the fresh pages arrived, without refreshing again", () => {
    const started = decideImageError(null, 1000, first).state;
    expect(decideImageError(started, 2000, fresh).action).toBe("broken");
    expect(decideImageError(started, 2000 + RETRY_COOLDOWN_MS - 3000, fresh).action).toBe("broken");
  });

  it("may refresh again once the cooldown has passed", () => {
    const started = decideImageError(null, 1000, first).state;
    const d = decideImageError(started, 1000 + RETRY_COOLDOWN_MS, fresh);
    expect(d.action).toBe("refresh");
    expect(d.state).toEqual({ startedAt: 1000 + RETRY_COOLDOWN_MS, pagesToken: fresh });
  });
});
