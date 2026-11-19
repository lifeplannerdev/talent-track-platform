// A submitted attempt whose score is not recorded yet (an interrupted submit) shows "being
// calculated" and no numbers; there is no awaiting-review state any more (spec change 1).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalculatingResult } from "./calculating";

function text(html: string) {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
}

const html = renderToStaticMarkup(
  <CalculatingResult
    result={{
      status: "submitted",
      id: "11111111-1111-4111-8111-111111111111",
      curriculumName: "Pflege Ausbildung",
      examSetName: "Set A",
      submittedAt: "2026-11-19T10:00:00Z",
    }}
  />,
);

describe("CalculatingResult", () => {
  it("says the result is being calculated and offers to check again", () => {
    expect(html).toContain('data-testid="result-status"');
    expect(text(html)).toContain("Your result is being calculated, please check again in a moment.");
    expect(html).toContain('href="/results/11111111-1111-4111-8111-111111111111"');
  });

  it("shows no numbers and no review or release copy", () => {
    expect(text(html)).not.toMatch(/\d+(\.\d)?%|points|pass mark/i);
    expect(text(html)).not.toMatch(/review|releas|awaiting|waiting/i);
  });
});
