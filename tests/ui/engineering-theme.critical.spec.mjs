import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./fixtures.mjs";
import {
  BUCK_LOSS_V2_ROUTE,
  LT83402_PROJECT_ROUTE,
  pageOverflow,
  setStoredTheme,
  settleVisualPage,
} from "./site.mjs";

const pages = [
  ["home", "/"],
  ["about", "/about/"],
  ["notebook", "/writing/"],
  ["note", "/2026/06/12/a-working-notebook.html"],
  ["project", "/projects/georgia-tech-noise-shaping-sar-adc/"],
  ["led", "/projects/georgia-tech-led-driver-dimming/"],
  ["y-flash", "/projects/technion-y-flash/"],
  ["op-amp", "/projects/bits-gmid-op-amp/"],
  ["ceeri", "/projects/bits-ceeri-image-processing/"],
  ["lt83402", LT83402_PROJECT_ROUTE],
  ["converter", "/tools/buck-converter/"],
  ["loss-entry", "/tools/buck-losses/"],
  ["loss-workspace", BUCK_LOSS_V2_ROUTE],
];

for (const theme of ["light", "dark"]) {
  for (const width of [1440, 1000, 768, 390, 320, 640]) {
    test(`${theme} engineering theme at ${width}px`, async ({
      page,
    }, testInfo) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width, height: width === 640 ? 450 : 900 });
      await setStoredTheme(page, theme);
      const fonts = [];
      page.on("request", (request) => {
        if (request.resourceType() === "font") fonts.push(request.url());
      });
      for (const [name, route] of pages) {
        await page.goto(route);
        await settleVisualPage(page);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        if (name === "converter") {
          await expect(page.locator(".bc-schematic-reference a")).toHaveCSS("text-decoration-line", "underline");
        }
        if (name === "ceeri") {
          const table = page.getByRole("region", { name: "Reported Jetson TX1 operation timings" });
          await expect(table.getByRole("columnheader")).toHaveCount(4);
          await expect(table.locator("tbody tr")).toHaveCount(4);
          await expect(table.getByRole("columnheader", { name: "GPU time (ms)" })).toBeVisible();
          await expect(table.getByRole("row", { name: "Canny filtering 9 10 0.9×", exact: true })).toBeVisible();
          if (width <= 390) {
            await table.focus();
            const before = await table.evaluate(el => el.scrollLeft);
            await page.keyboard.press("ArrowRight");
            await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(before);
          }
        }
        if (name === "op-amp") {
          await expect(page.locator("h1")).toHaveText("gm/ID Op-Amp Sizing");
          await expect(page.locator(".project-body")).toContainText("sized single-stage OTA");
        }
        const styles = await page.evaluate(() => {
          const style = (element) => {
            const s = getComputedStyle(element);
            return {
              family: s.fontFamily,
              size: s.fontSize,
              line: s.lineHeight,
              weight: s.fontWeight,
              numbers: s.fontVariantNumeric,
            };
          };
          const visible = (selector) =>
            [...document.querySelectorAll(selector)].filter(
              (el) => el.getClientRects().length,
            );
          return {
            heading: style(document.querySelector("h1")),
            entries: visible(".list-item h3").map(style),
            metadata: visible(".item-meta, .item-date, .post-meta").map(style),
            inputs: visible(
              'input[type="number"], input[type="text"], select',
            ).map(style),
            metrics: visible(
              ".bc-v, .blx-efficiency-value, .blx-summary-metric strong",
            ).map(style),
            inter: document.fonts.check("400 16px Inter"),
            mono: document.fonts.check('400 14px "IBM Plex Mono"'),
          };
        });
        expect(styles.heading, `${name} heading`).toMatchObject({
          size: width <= 700 ? "32px" : "40px",
          line: width <= 700 ? "40px" : "48px",
          weight: "600",
        });
        expect(styles.heading.family).toContain("Inter");
        for (const s of styles.entries)
          expect(s).toMatchObject({
            size: "20px",
            line: "28px",
            weight: "500",
          });
        for (const s of styles.metadata) {
          expect(s).toMatchObject({
            size: "14px",
            line: "20px",
            weight: "400",
          });
          expect(s.family).toContain("IBM Plex Mono");
        }
        for (const s of styles.inputs) {
          expect(s.size, `${name} input`).toBe("16px");
          expect(s.family).toContain("Inter");
        }
        for (const s of styles.metrics)
          expect(s.numbers, `${name} numeric alignment`).toContain(
            "tabular-nums",
          );
        if (name === "loss-workspace") {
          const result = page.locator(".blx-primary-result");
          const value = result.locator(".blx-efficiency-value");
          await expect(value.locator(".blx-term-trigger")).toHaveCSS("font-size", "14px");
          const valueBox = await value.boundingBox();
          const metricsBox = await result.locator(".blx-summary-metrics").boundingBox();
          expect(valueBox.y + valueBox.height).toBeLessThanOrEqual(metricsBox.y);
          for (const metric of await result.locator(".blx-summary-metric strong").all()) {
            await expect(metric).toHaveCSS("white-space", "nowrap");
            const box = await metric.boundingBox();
            expect(box.height).toBeLessThanOrEqual(28);
            expect(box.x + box.width).toBeLessThanOrEqual(metricsBox.x + metricsBox.width + 1);
          }
          if (process.env.THEME_REVIEW_DIR && width <= 390) {
            await mkdir(process.env.THEME_REVIEW_DIR, { recursive: true });
            await result.screenshot({path: path.join(process.env.THEME_REVIEW_DIR,
              `${testInfo.project.name}-loss-summary-${theme}-${width}.png`)});
          }
        }
        expect(styles.inter).toBe(true);
        // A font used only by metadata should not be fetched on a page without metadata.
        if (styles.metadata.length) expect(styles.mono).toBe(true);
        const overflow = await pageOverflow(page);
        expect(
          overflow.scrollWidth,
          `${name}: ${JSON.stringify(overflow.offenders)}`,
        ).toBeLessThanOrEqual(width + 1);
        // Optional review captures never replace expected screenshots.
        if (
          process.env.THEME_REVIEW_DIR &&
          [1440, 1000, 390, 320].includes(width)
        ) {
          const dir = path.resolve(process.env.THEME_REVIEW_DIR);
          await mkdir(dir, { recursive: true });
          await page.evaluate(() => {
            document.activeElement?.blur();
            document.querySelectorAll(".project-table").forEach(table => { table.scrollLeft = 0; });
            window.scrollTo({ top: 0, behavior: "instant" });
          });
          await page.screenshot({
            path: path.join(
              dir,
              `${testInfo.project.name}-${name}-${theme}-${width}.png`,
            ),
            fullPage: true,
            animations: "disabled",
          });
        }
      }
      expect(fonts.length).toBeGreaterThan(0);
      expect(
        fonts.every(
          (url) => new URL(url).origin === new URL(page.url()).origin,
        ),
      ).toBe(true);
    });
  }
}

test("classic scrollbars do not reserve inline space in article tables", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["/projects/georgia-tech-noise-shaping-sar-adc/", "/projects/bits-ceeri-image-processing/"]) {
      await page.goto(route);
      await settleVisualPage(page);
      // A non-overlay scrollbar reproduces the CI runner's reserved gutter.
      await page.addStyleTag({ content: ".project-table::-webkit-scrollbar { width: 15px; height: 15px; }" });
      for (const table of await page.locator(".project-table").all()) {
        const size = await table.evaluate(el => ({
          width: el.getBoundingClientRect().width,
          available: el.clientWidth,
          content: el.scrollWidth,
        }));
        expect(size.available).toBeCloseTo(size.width, 0);
        if (size.content > size.available + 1) {
          await table.focus();
          await table.press("ArrowRight");
          await expect.poll(() => table.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
        }
      }
      expect((await pageOverflow(page)).scrollWidth).toBeLessThanOrEqual(width + 1);
    }
  }
});

test("forced colors retain visible controls, content and keyboard focus", async ({
  page,
}) => {
  await page.emulateMedia({ forcedColors: "active", reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ["/", "/tools/buck-converter/", BUCK_LOSS_V2_ROUTE]) {
    await page.goto(route);
    await settleVisualPage(page);
    const toggle = page.getByRole("button", { name: /Switch to .* mode/ });
    await toggle.focus();
    expect(
      await toggle.evaluate((el) => getComputedStyle(el).outlineStyle),
    ).not.toBe("none");
    await expect(page.locator("h1")).toBeVisible();
    expect((await pageOverflow(page)).scrollWidth).toBeLessThanOrEqual(391);
  }
});
