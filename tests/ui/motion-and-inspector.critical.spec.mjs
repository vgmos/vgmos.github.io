import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures.mjs";
import { SITE_URL, pageOverflow, settlePage } from "./site.mjs";

const SAR_PROJECT = "/projects/georgia-tech-noise-shaping-sar-adc/";
test.describe("immediately visible homepage", () => {
  for (const motion of ["no-preference", "reduce"]) {
    test(`all entries are visible with ${motion} motion`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto("/");
      await settlePage(page);
      await expect(page.locator(".home-title")).toHaveText("Tools, projects, and notes");
      await expect(page.locator(".hero-lede")).toContainText("low-noise DC-DC buck converters");
      await expect(page.locator("[data-signal-path], [data-reveal], .page-exit-layer")).toHaveCount(0);
      await expect(page.locator(".list-item")).toHaveCount(8);
      expect(await page.locator(".list-item").evaluateAll(items => items.every(item => {
        const style = getComputedStyle(item);
        return style.visibility === "visible" && style.opacity === "1" && style.transform === "none";
      }))).toBe(true);
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.getByRole("link", {name: "About", exact: true}).click();
      await expect(page).toHaveURL(/\/about\/$/);
      await settlePage(page);
      await page.goBack();
      await settlePage(page);
      await expect(page.locator(".list-item")).toHaveCount(8);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
    });
  }
  test("homepage and original figures remain complete without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({javaScriptEnabled: false});
    const page = await context.newPage();
    await page.goto(new URL("/", SITE_URL).href);
    await expect(page.locator(".list-item")).toHaveCount(8);
    for (const item of await page.locator(".list-item").all()) await expect(item).toBeVisible();
    await expect(page.getByRole("link", {name: "Browse all notes"})).toBeVisible();
    await expect(page.locator("[data-signal-path], [data-reveal]")).toHaveCount(0);
    await page.goto(new URL(SAR_PROJECT, SITE_URL).href);
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
