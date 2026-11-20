import { describe, expect, it } from "vitest";
import { isPublicPath } from "./public-paths";

describe("isPublicPath", () => {
  it("lets anyone open the landing page and the sign-in page", () => {
    expect(isPublicPath("/")).toBe(true);
    expect(isPublicPath("/login")).toBe(true);
  });

  it("keeps every other route behind sign-in", () => {
    for (const path of ["/staff", "/staff/students", "/exam/start", "/consent", "/results/abc", "/login/extra", "/loginx", "/staff/exportpng"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });
});
