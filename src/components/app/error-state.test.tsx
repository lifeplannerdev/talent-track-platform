// The route error state. Student error boundaries replace the page (and its header, where the
// skip-link target normally sits), so there the error state is the skip-link target itself.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ErrorState } from "./error-state";

describe("ErrorState", () => {
  it("can be the skip-link target (student pages, which lose their header on an error)", () => {
    const html = renderToStaticMarkup(
      <ErrorState title="Oops" onRetry={() => {}} skipTarget>
        <p>Try again.</p>
      </ErrorState>,
    );
    expect(html).toMatch(/<main[^>]*id="main-content"[^>]*tabindex="-1"/);
  });

  it("has no id by default (staff pages keep their target in the shared header)", () => {
    const html = renderToStaticMarkup(
      <ErrorState title="Oops" onRetry={() => {}}>
        <p>Try again.</p>
      </ErrorState>,
    );
    expect(html).not.toContain("main-content");
  });
});
