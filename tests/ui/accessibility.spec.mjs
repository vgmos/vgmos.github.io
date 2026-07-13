import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures.mjs";
import {
  AUDIT_ROUTES,
  BUCK_LOSS_V2_ROUTE,
  CRITICAL_VISUAL_ROUTES,
  pageOverflow,
  setStoredTheme,
  settlePage
} from "./site.mjs";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function auditRoute(page, route, theme, testInfo) {
  await setStoredTheme(page, theme);
  await page.goto(route, { waitUntil: "domcontentloaded" });
  await settlePage(page);
  await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  await testInfo.attach(`axe-${theme}-${route.replace(/\W+/g, "-") || "home"}`, {
    body: Buffer.from(JSON.stringify(results, null, 2)),
    contentType: "application/json"
  });

  const severe = results.violations
    .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      help: violation.help,
      targets: violation.nodes.flatMap((node) => node.target)
    }));
  expect(severe, `${route} (${theme}) has serious or critical axe violations`).toEqual([]);
}

test.describe("automated accessibility", () => {
  for (const route of AUDIT_ROUTES) {
    test(`${route} has no serious or critical WCAG violations in light theme`, async ({ page }, testInfo) => {
      await auditRoute(page, route, "light", testInfo);
    });
  }

  for (const route of CRITICAL_VISUAL_ROUTES) {
    test(`${route.path} has no serious or critical WCAG violations in dark theme`, async ({ page }, testInfo) => {
      await auditRoute(page, route.path, "dark", testInfo);
    });
  }

  test("the loss-entry gateway and guided form have accessible contracts", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    let results = await new AxeBuilder({ page }).include("#buck-loss-explorer").withTags(WCAG_TAGS).analyze();
    let severe = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
    expect(severe).toEqual([]);

    await page.getByRole("button", { name: "Start guided setup" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set circuit conditions");
    results = await new AxeBuilder({ page }).include("#buck-loss-explorer").withTags(WCAG_TAGS).analyze();
    severe = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
    expect(severe).toEqual([]);
  });

  test("the recovery device chooser retains an accessible dialog contract", async ({ page }) => {
    await page.goto("/tools/buck-losses/?m=2&p=12v-to-3v3-pol&device=not-real&i=2", { waitUntil: "domcontentloaded" });
    const chooser = page.locator("[data-blx-device-dialog]");
    await expect(chooser).toBeVisible();
    await expect(chooser).toHaveAttribute("aria-labelledby", "blx-device-dialog-title");
    const results = await new AxeBuilder({ page }).include("[data-blx-device-dialog]").withTags(WCAG_TAGS).analyze();
    const severe = results.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
    expect(severe).toEqual([]);
  });

  test("the read-only legacy viewer has no serious or critical WCAG violations", async ({ page }, testInfo) => {
    await auditRoute(page, "/tools/buck-losses/?p=12v-to-3v3-pol&i=2", "light", testInfo);
  });
});

test.describe("keyboard and assistive-technology contracts", () => {
  for (const theme of ["light", "dark"]) {
    test(`global focus treatment and skip link are visible in ${theme} theme`, async ({ page }) => {
      await setStoredTheme(page, theme);
      await page.goto("/", { waitUntil: "domcontentloaded" });
      await settlePage(page);

      const skipLink = page.locator('a[href="#main-content"]');
      await page.keyboard.press("Tab");
      await expect(skipLink).toBeFocused();
      await expect(skipLink).toBeVisible();

      const themeToggle = page.locator(".theme-toggle");
      await themeToggle.focus();
      await expect(themeToggle).toBeFocused();
      const treatment = await themeToggle.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          outlineStyle: style.outlineStyle,
          outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
          boxShadow: style.boxShadow
        };
      });
      const hasVisibleFocus = (
        treatment.outlineStyle !== "none" && treatment.outlineWidth >= 1
      ) || treatment.boxShadow !== "none";
      expect(hasVisibleFocus, `theme toggle focus style: ${JSON.stringify(treatment)}`).toBe(true);
    });
  }

  test("the converter animation is silent and its waveform probe is keyboard operable", async ({ page }) => {
    await page.goto("/tools/buck-converter/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const animatedStatus = page.locator(".bc-anim-status");
    const liveMode = await animatedStatus.getAttribute("aria-live");
    expect([null, "off"], "autonomous animation must not continuously announce").toContain(liveMode);

    const probe = page.locator("#bc-probe-slider");
    await expect(probe).toHaveAttribute("type", "range");
    await expect(probe).toHaveAttribute("aria-valuetext", /\S+/);
    await probe.focus();
    const before = await probe.inputValue();
    const readoutBefore = await page.locator("#bc-probe-readout").textContent();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => probe.inputValue()).not.toBe(before);
    await expect.poll(() => page.locator("#bc-probe-readout").textContent()).not.toBe(readoutBefore);

    for (const waveform of ["#p-vsw", "#p-il", "#p-vout"]) {
      await expect(page.locator(waveform)).toHaveAttribute("aria-label", /\S+/);
    }
  });

  test("the loss plot exposes its cursor slider outside image semantics", async ({ page }) => {
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const slider = page.locator("[data-blx-cursor-rail]");
    await expect(slider).toHaveAttribute("role", "slider");
    await expect(slider).toHaveAttribute("tabindex", "0");
    expect(await slider.evaluate((element) => Boolean(element.closest('[role="img"]')))).toBe(false);

    await slider.focus();
    const before = await slider.getAttribute("aria-valuenow");
    const readoutBefore = await page.locator('[data-blx-out="current"]').textContent();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => slider.getAttribute("aria-valuenow")).not.toBe(before);
    await expect.poll(() => page.locator('[data-blx-out="current"]').textContent()).not.toBe(readoutBefore);
  });
});

test.describe("touch targets and zoom reflow", () => {
  for (const route of ["/tools/buck-converter/", BUCK_LOSS_V2_ROUTE]) {
    test(`${route} provides usable touch targets at 390px`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await settlePage(page);

      const undersized = await page.locator("main button, main input:not([type=hidden]), main summary, main [role=slider]")
        .evaluateAll((elements) => elements.flatMap((element) => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0) return [];
          if (element.closest('[hidden], [aria-hidden="true"]')) return [];
          return rect.width >= 24 && rect.height >= 24 ? [] : [{
            tag: element.tagName.toLowerCase(),
            id: element.id,
            className: element.className?.baseVal ?? element.className ?? "",
            width: rect.width,
            height: rect.height,
            label: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 40)
          }];
        }));
      expect(undersized, "visible tool controls need at least a 24x24 CSS pixel target").toEqual([]);

      const primarySelector = route.includes("buck-converter")
        ? ".bc-presets button, .bc-segmented button, .bc-dcm-toggle"
        : ".blx-presets button, .blx-actions button, .blx-copy button";
      const undersizedPrimary = await page.locator(primarySelector).evaluateAll((elements) => elements.flatMap((element) => {
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height) return [];
        return rect.height >= 40 ? [] : [{ label: element.textContent?.trim(), height: rect.height }];
      }));
      expect(undersizedPrimary, "primary touch controls should be approximately 44px tall").toEqual([]);
    });
  }

  test("critical content reflows at the equivalent of 200% desktop zoom", async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 450 });
    for (const route of CRITICAL_VISUAL_ROUTES) {
      await page.goto(route.path, { waitUntil: "domcontentloaded" });
      await settlePage(page);
      const overflow = await pageOverflow(page);
      expect.soft(
        overflow.scrollWidth,
        `${route.path} overflows the 640 CSS-pixel viewport: ${JSON.stringify(overflow.offenders)}`
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  });
});
