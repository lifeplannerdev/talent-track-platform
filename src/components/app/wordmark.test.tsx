// The name lockup: one blue T shared by "Talent" and "Track", "Platform" beside or below it.
// The visual parts are hidden from assistive technology; the full name is read once, as plain text.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NameLockup, PoweredBy, Wordmark } from "./wordmark";

const visible = (html: string) => html.replace(/<span class="sr-only">[^<]*<\/span>/g, "");

describe("NameLockup", () => {
  it("reads as the full name once, for screen readers and text search", () => {
    const html = renderToStaticMarkup(<NameLockup />);
    expect(html.match(/Talent Track Platform/g)).toHaveLength(1);
    expect(html).toMatch(/<span class="sr-only">Talent Track Platform<\/span>/);
  });

  it("draws one T, then alent and rack, then Platform, and hides that drawing from assistive technology", () => {
    const html = renderToStaticMarkup(<NameLockup />);
    const drawn = visible(html);
    expect(drawn).toMatch(/aria-hidden="true"/);
    const order = ["T</span>", "alent</span>", "rack</span>", "Platform</span>"].map((s) => drawn.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // The shared T appears once, never as the start of two separate words.
    expect(drawn).not.toContain("Talent</span>");
    expect(drawn).not.toContain("Track</span>");
  });

  it("is never translated", () => {
    expect(renderToStaticMarkup(<NameLockup />)).toContain('translate="no"');
  });

  it("stacks Platform under the T for big placements", () => {
    const html = renderToStaticMarkup(<NameLockup layout="stacked" />);
    expect(html).toContain("flex-col");
  });
});

describe("Wordmark", () => {
  it("is the lockup with no separate logo square (the T is the mark)", () => {
    const html = renderToStaticMarkup(<Wordmark />);
    expect(html).toContain("alent");
    expect(html).not.toContain("<svg");
    expect(html.match(/Talent Track Platform/g)).toHaveLength(1);
  });

  it("has a smaller compact size for footers", () => {
    const big = renderToStaticMarkup(<Wordmark />);
    const small = renderToStaticMarkup(<Wordmark compact />);
    expect(small).not.toEqual(big);
  });
});

describe("PoweredBy", () => {
  it("writes the letters exactly as given, with the final dot", () => {
    const html = renderToStaticMarkup(<PoweredBy />);
    expect(html).toMatch(/>F\.L\.A\.G\.<\/span>/);
    expect(html).not.toMatch(/F\.L\.A\.G[^.]/);
  });
});
