import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures.mjs";
import { SITE_URL, pageOverflow, settlePage } from "./site.mjs";

const SAR_PROJECT = "/projects/georgia-tech-noise-shaping-sar-adc/";
const HERO_LEDE = "I design analog and power ICs at Analog Devices, mostly low-noise DC-DC buck converters for RF, OLED, and automotive systems. This site is a working archive. The tools are small circuit-design calculators. The projects are longer write-ups from my graduate research. The notebook is where the rest goes: technical notes, loose ideas, and things that don’t quite fit on a project page.";

test.describe("homepage motion", () => {
  test("the signal trace and row reveals are finite, stable, and run once per document", async ({ page }) => {
    await page.addInitScript(() => {
      const nativeAnimate = Element.prototype.animate;
      window.__vgmosSignalAnimationCalls = 0;
      Element.prototype.animate = function animate(keyframes, options) {
        if (this.matches?.("[data-signal-path-pulse]")) window.__vgmosSignalAnimationCalls += 1;
        return nativeAnimate.call(this, keyframes, options);
      };
    });

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    await expect(page.locator(".home-title")).toHaveText("Tools, projects, and notes");
    await expect(page.locator(".hero-lede")).toHaveText(HERO_LEDE);

    const signal = page.locator("[data-signal-path]");
    await expect(signal).toHaveAttribute("role", "img");
    await expect(signal).toHaveAttribute("aria-labelledby", "home-signal-title home-signal-description");
    expect(await signal.locator("[data-signal-path-pulse]").evaluate((path) => path.getTotalLength())).toBeGreaterThan(100);
    await expect(signal).toHaveAttribute("data-signal-path-state", "complete");
    expect(await page.evaluate(() => window.__vgmosSignalAnimationCalls)).toBe(1);

    const reveals = page.locator("[data-reveal]");
    expect(await reveals.count()).toBeGreaterThan(4);
    const finalReveal = reveals.last();
    const heightBefore = await page.evaluate(() => document.documentElement.scrollHeight);
    await finalReveal.scrollIntoViewIfNeeded();
    await expect(finalReveal).toHaveAttribute("data-reveal-state", "visible");
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(heightBefore);

    await page.getByRole("link", { name: "About", exact: true }).click();
    await expect(page).toHaveURL(/\/about\/$/);
    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === "/");
    await expect(page.locator("[data-signal-path]")).toHaveAttribute("data-signal-path-state", "complete");
    expect(await page.evaluate(() => window.__vgmosSignalAnimationCalls)).toBe(1);
  });

  test("reduced motion exposes the final homepage immediately", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    await expect(page.locator('[data-reveal-state="pending"]')).toHaveCount(0);
    const reveals = page.locator("[data-reveal]");
    expect(await reveals.count()).toBeGreaterThan(4);
    expect(await reveals.evaluateAll((items) => items.every((item) => {
      const style = getComputedStyle(item);
      return Number(style.opacity) === 1 && style.transform === "none";
    }))).toBe(true);
    await expect(page.locator("[data-signal-path]")).toHaveAttribute("data-signal-path-state", "complete");
    expect(await page.locator("[data-signal-path-pulse]").evaluate((pulse) => Number(getComputedStyle(pulse).opacity))).toBe(0);
  });

  test("the homepage remains complete without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(new URL("/", SITE_URL).href, { waitUntil: "domcontentloaded" });

    await expect(page.locator("[data-reveal]")).not.toHaveCount(0);
    expect(await page.locator("[data-reveal]").evaluateAll((items) => items.every((item) => {
      const style = getComputedStyle(item);
      return style.visibility === "visible" && Number(style.opacity) === 1 && item.getBoundingClientRect().height > 0;
    }))).toBe(true);
    await expect(page.locator("[data-signal-path]")).toBeVisible();
    expect(await page.locator("[data-signal-path-wave]").evaluate((wave) => Number(getComputedStyle(wave).opacity))).toBeGreaterThan(0.5);

    await page.goto(new URL(SAR_PROJECT, SITE_URL).href, { waitUntil: "domcontentloaded" });
    await expect(page.locator("[data-figure-inspect]")).toHaveCount(0);
    await expect(page.locator(".source-figure img")).toHaveCount(2);
    await expect(page.locator(".source-figure img").first()).toBeVisible();

    await context.close();
  });
});

test.describe("project figure inspector", () => {
  test("preserves figure content, traps focus, closes with Escape, and restores focus", async ({ page }) => {
    await page.goto(SAR_PROJECT, { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const triggers = page.locator("[data-figure-inspect]");
    await expect(triggers).toHaveCount(2);
    const trigger = triggers.first();
    const sourceImage = trigger.locator("img");
    const sourceAlt = await sourceImage.getAttribute("alt");
    const sourceSrc = await sourceImage.getAttribute("src");
    await trigger.scrollIntoViewIfNeeded();
    const scrollBefore = await page.evaluate(() => window.scrollY);

    await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    await expect(trigger).toHaveAccessibleName("Inspect figure: Third-order EF loop model in Simulink");
    await trigger.focus();
    await page.keyboard.press("Enter");

    const dialog = page.locator("[data-figure-inspector]");
    const close = page.locator("[data-figure-inspector-close]");
    await expect(dialog).toBeVisible();
    await expect(dialog).toHaveAttribute("open", "");
    await expect(dialog).toHaveAttribute("aria-labelledby", "figure-inspector-title");
    expect(await dialog.evaluate((element) => element.matches(":modal"))).toBe(true);
    await expect(close).toBeFocused();
    await expect(dialog.locator("[data-figure-inspector-image]")).toHaveAttribute("alt", sourceAlt);
    await expect(dialog.locator("[data-figure-inspector-image]")).toHaveAttribute("src", sourceSrc);
    await expect(dialog.locator("[data-figure-inspector-caption]")).toContainText("Third-order EF loop model in Simulink");
    await expect(dialog).toHaveAttribute("data-figure-inspector-state", "open");

    for (let index = 0; index < 3; index += 1) {
      await page.keyboard.press("Tab");
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    }

    const axe = await new AxeBuilder({ page }).include("[data-figure-inspector]").analyze();
    const severe = axe.violations.filter((violation) => ["critical", "serious"].includes(violation.impact));
    expect(severe).toEqual([]);

    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(scrollBefore);

    await trigger.click();
    await expect(dialog).toBeVisible();
    await close.click();
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
    await expect(page.locator(".figure-inspector__flight")).toHaveCount(0);
  });

  test("fits the mobile viewport with a usable close target", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(SAR_PROJECT, { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const triggers = page.locator("[data-figure-inspect]");
    await expect(triggers).toHaveCount(2);
    await triggers.first().click();

    const dialog = page.locator("[data-figure-inspector]");
    const close = page.locator("[data-figure-inspector-close]");
    await expect(dialog).toHaveAttribute("data-figure-inspector-state", "open");
    const geometry = await dialog.evaluate((element) => {
      const dialogRect = element.getBoundingClientRect();
      const closeRect = element.querySelector("[data-figure-inspector-close]").getBoundingClientRect();
      const imageRect = element.querySelector("[data-figure-inspector-image]").getBoundingClientRect();
      return {
        dialog: dialogRect.toJSON(),
        close: closeRect.toJSON(),
        image: imageRect.toJSON(),
        viewport: { width: window.innerWidth, height: window.innerHeight }
      };
    });

    expect(geometry.dialog.left).toBeGreaterThanOrEqual(0);
    expect(geometry.dialog.right).toBeLessThanOrEqual(geometry.viewport.width);
    expect(geometry.dialog.top).toBeGreaterThanOrEqual(0);
    expect(geometry.dialog.bottom).toBeLessThanOrEqual(geometry.viewport.height);
    expect(geometry.close.width).toBeGreaterThanOrEqual(44);
    expect(geometry.close.height).toBeGreaterThanOrEqual(44);
    expect(geometry.image.width).toBeGreaterThan(0);

    const overflow = await pageOverflow(page);
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    await close.click();
    await expect(dialog).not.toBeVisible();
  });

  test("soft navigation tears down both open and closing inspectors", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.getByRole("link", { name: "High-Order Noise-Shaping SAR ADC", exact: true }).click();
    await expect(page).toHaveURL((url) => url.pathname === SAR_PROJECT);

    let triggers = page.locator("[data-figure-inspect]");
    await expect(triggers).toHaveCount(2);
    await triggers.first().click();
    const dialog = page.locator("[data-figure-inspector]");
    await expect(dialog).toBeVisible();

    await page.goBack();
    await expect(page).toHaveURL((url) => url.pathname === "/");
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("body > main.page-content")).toBeFocused();

    await page.goForward();
    await expect(page).toHaveURL((url) => url.pathname === SAR_PROJECT);
    triggers = page.locator("[data-figure-inspect]");
    await expect(triggers).toHaveCount(2);
    await triggers.first().click();
    await page.locator("[data-figure-inspector-close]").click();
    await page.goBack();

    await expect(page).toHaveURL((url) => url.pathname === "/");
    await expect(dialog).not.toBeVisible();
    await expect(page.locator(".figure-inspector__flight")).toHaveCount(0);
    await expect(page.locator("[data-figure-inspector]")).toHaveCount(1);
  });

  test("reduced motion opens and closes without transient flight layers", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(SAR_PROJECT, { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const triggers = page.locator("[data-figure-inspect]");
    await expect(triggers).toHaveCount(2);
    const trigger = triggers.first();
    await trigger.click();

    const dialog = page.locator("[data-figure-inspector]");
    await expect(dialog).toHaveAttribute("data-figure-inspector-state", "open");
    await expect(page.locator(".figure-inspector__flight")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();
  });
});
