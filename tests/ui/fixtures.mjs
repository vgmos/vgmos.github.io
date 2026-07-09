import { test as base, expect } from "@playwright/test";
import { LIVE_COMMIT, SITE_URL } from "./site.mjs";

export const test = base.extend({
  auditMetadata: [
    async ({ page, browserName }, use, testInfo) => {
      testInfo.annotations.push(
        { type: "site", description: SITE_URL },
        { type: "live-commit", description: LIVE_COMMIT },
        { type: "browser", description: browserName }
      );

      await use();

      let rendered = {};
      try {
        rendered = await page.evaluate(() => ({
          url: window.location.href,
          theme: document.documentElement.getAttribute("data-theme"),
          reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          viewport: { width: window.innerWidth, height: window.innerHeight }
        }));
      } catch {
        rendered = { url: "page unavailable" };
      }

      await testInfo.attach("audit-environment", {
        body: Buffer.from(JSON.stringify({
          auditDate: new Date().toISOString(),
          browser: browserName,
          liveCommit: LIVE_COMMIT,
          siteURL: SITE_URL,
          ...rendered
        }, null, 2)),
        contentType: "application/json"
      });
    },
    { auto: true }
  ]
});

export { expect };
