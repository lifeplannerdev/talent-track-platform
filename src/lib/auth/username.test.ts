import { describe, expect, it } from "vitest";
import { usernameToEmail } from "./username";

describe("usernameToEmail", () => {
  it("lowercases, trims and maps to the internal student domain", () => {
    expect(usernameToEmail("  Anu.K ")).toBe(
      "anu.k@students.talenttrack.internal",
    );
  });

  it("throws when the username contains inner whitespace", () => {
    expect(() => usernameToEmail("anu k")).toThrow();
  });

  it("throws when the username is empty", () => {
    expect(() => usernameToEmail("   ")).toThrow();
  });

  it("throws when the username contains an at sign", () => {
    expect(() => usernameToEmail("anu@example.com")).toThrow();
  });
});
