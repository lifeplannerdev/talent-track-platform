import { expect, type Page } from "@playwright/test";

/** The page itself never scrolls sideways (wide tables scroll inside their own frame). */
export async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, "page scrolls horizontally").toBeLessThanOrEqual(clientWidth);
}
