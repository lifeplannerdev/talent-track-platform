// The curriculum settings form (name and attempts per student), rendered to static HTML.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ saveCurriculum: async () => ({ ok: true }) }));

const { CurriculumSettingsForm } = await import("./curriculum-settings-form");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("CurriculumSettingsForm", () => {
  it("has a labelled Attempts per student field with the current value", () => {
    const html = renderToStaticMarkup(<CurriculumSettingsForm id="c1" name="Pflege" maxAttempts={2} />);
    expect(html).toMatch(/<label[^>]*for="curriculum-attempts-c1"[^>]*>Attempts per student<\/label>/);
    expect(html).toMatch(/<input[^>]*id="curriculum-attempts-c1"[^>]*value="2"/);
  });

  it("says that lowering or raising the attempts does not unblock students who are already blocked", () => {
    const t = text(renderToStaticMarkup(<CurriculumSettingsForm id="c1" name="Pflege" maxAttempts={2} />));
    expect(t).toContain("Students who are already blocked stay blocked until you give them extra attempts.");
  });
});
