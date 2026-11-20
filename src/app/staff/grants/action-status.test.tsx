// The page-level success message for extra attempts: polite (the outer role="status" region
// governs, the alert inside must not be assertive) and re-announced even when the same text
// comes twice (each success replaces the node).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ActionStatusView, nextActionStatus } from "./action-status";

describe("nextActionStatus", () => {
  it("gives every success a new announcement id, also for an identical message", () => {
    const first = nextActionStatus(null, "Gave Asha Nair 1 extra attempt for Pflege.");
    const second = nextActionStatus(first, "Gave Asha Nair 1 extra attempt for Pflege.");
    expect(second.message).toBe(first.message);
    expect(second.id).not.toBe(first.id);
  });
});

describe("ActionStatusView", () => {
  it("renders the message in a polite status region without an assertive alert role inside", () => {
    const html = renderToStaticMarkup(<ActionStatusView status={{ id: 3, message: "Gave Asha 1 extra attempt." }} />);
    expect(html).toMatch(/^<div[^>]*role="status"/);
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('data-announcement="3"');
    expect(html).toContain("Gave Asha 1 extra attempt.");
  });

  it("is an empty polite region before any success", () => {
    const html = renderToStaticMarkup(<ActionStatusView status={null} />);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("grant-success");
  });
});
