import { describe, expect, it } from "vitest";
import { isValidUsername, usernameToEmail } from "./username";

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

describe("isValidUsername", () => {
  it("accepts 3-40 letters, digits, dots, underscores and hyphens", () => {
    for (const u of ["anu", "anu.k", "anu_k-2", "A".repeat(40)]) expect(isValidUsername(u)).toBe(true);
  });

  it("rejects other characters and lengths, and anything usernameToEmail rejects", () => {
    for (const u of ["", "ab", "a".repeat(41), "anu k", "anu@x", "änu", "anu/k", "anu+k"]) expect(isValidUsername(u)).toBe(false);
  });
});
