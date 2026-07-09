import { test, expect } from "./fixtures.mjs";
import { CRITICAL_VISUAL_ROUTES, setStoredTheme, settleVisualPage } from "./site.mjs";

const VISUAL_VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 }
];

test.describe("approved Chromium visual baselines", () => {
  test.skip(
    process.env.PLAYWRIGHT_LIVE === "1",
    "Live audits collect failure screenshots but compare approved visual baselines only in local and PR builds."
  );

  for (const route of CRITICAL_VISUAL_ROUTES) {
    for (const theme of ["light", "dark"]) {
      for (const viewport of VISUAL_VIEWPORTS) {
        test(`${route.name} is visually stable in ${theme} at ${viewport.name}`, async ({ page }) => {
          await page.setViewportSize({ width: viewport.width, height: viewport.height });
          await page.emulateMedia({ reducedMotion: "reduce" });
          await setStoredTheme(page, theme);
          await page.goto(route.path, { waitUntil: "domcontentloaded" });
          await settleVisualPage(page);
          await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

          await expect(page).toHaveScreenshot(`${route.name}-${theme}-${viewport.name}.png`, {
            fullPage: true
          });
        });
      }
    }
  }
});
