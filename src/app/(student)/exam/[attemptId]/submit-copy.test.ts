// Submit dialog copy: answered count, no changes afterwards, and the result shows at once.
import { describe, expect, it } from "vitest";
import { submitDialogText } from "./submit-copy";

describe("submitDialogText", () => {
  it("says how many questions are answered and that the result is shown right away", () => {
    const t = submitDialogText(3, 5, false);
    expect(t).toContain("You answered 3 of 5 questions.");
    expect(t).toContain("You cannot change your answers after submitting.");
    expect(t).toMatch(/result is shown right after you submit/i);
    expect(t).not.toMatch(/still being saved/);
  });

  it("mentions answers still being saved", () => {
    expect(submitDialogText(5, 5, true)).toMatch(/Some answers are still being saved; they will be sent first\./);
  });

  it("never mentions review or release", () => {
    expect(submitDialogText(1, 2, true)).not.toMatch(/review|releas|trainer/i);
  });
});
