import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ExtraAttemptsFields } from "./extra-attempts-fields";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("ExtraAttemptsFields", () => {
  const base = { idPrefix: "x", count: "1", onCount: () => {}, repeats: false, onRepeats: () => {}, repeatsLocked: false };

  it("asks for a number of extra attempts from 1 to 10, with a visible label", () => {
    const html = renderToStaticMarkup(<ExtraAttemptsFields {...base} />);
    expect(html).toMatch(/<label[^>]*for="x-count"[^>]*>Number of extra attempts<\/label>/);
    const input = html.match(/<input[^>]*id="x-count"[^>]*>/)?.[0] ?? "";
    expect(input).toContain('type="number"');
    expect(input).toContain('min="1"');
    expect(input).toContain('max="10"');
    expect(input).toContain('value="1"');
  });

  it("has an Allow repeating exam sets switch with helper text", () => {
    const html = renderToStaticMarkup(<ExtraAttemptsFields {...base} />);
    expect(html).toContain('role="switch"');
    expect(html).toContain('aria-checked="false"');
    const t = text(html);
    expect(t).toContain("Allow repeating exam sets");
    expect(t).toContain("exam sets this student already had");
    // Repeats are only saved by giving attempts (n is 1..10): the hint says so.
    expect(t).toContain("Repeats are saved together with at least one extra attempt.");
  });

  it("shows repeats as on and fixed when they are already allowed for this student", () => {
    const html = renderToStaticMarkup(<ExtraAttemptsFields {...base} repeats repeatsLocked />);
    expect(html).toContain('aria-checked="true"');
    expect(html).toMatch(/role="switch"[^>]*(aria-disabled="true"|data-disabled)/);
    expect(text(html)).toContain("Already allowed for this student.");
  });

  it("shows a count error next to the field", () => {
    const html = renderToStaticMarkup(<ExtraAttemptsFields {...base} count="12" countError="Give from 1 to 10 extra attempts." />);
    expect(html).toMatch(/<input[^>]*aria-invalid="true"/);
    expect(text(html)).toContain("Give from 1 to 10 extra attempts.");
  });
});
