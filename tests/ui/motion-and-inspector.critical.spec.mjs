import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures.mjs";
import { LT83402_PROJECT_ROUTE, SITE_URL, pageOverflow, settlePage } from "./site.mjs";

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
      await expect(page.locator(".list-item")).toHaveCount(9);
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
      await expect(page.locator(".list-item")).toHaveCount(9);
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBe(height);
    });
  }
  test("homepage and original figures remain complete without JavaScript", async ({ browser }) => {
    const context = await browser.newContext({javaScriptEnabled: false});
    const page = await context.newPage();
    await page.goto(new URL("/", SITE_URL).href);
    await expect(page.locator(".list-item")).toHaveCount(9);
    for (const item of await page.locator(".list-item").all()) await expect(item).toBeVisible();
    await expect(page.getByRole("link", {name: "Browse all notes"})).toBeVisible();
    await expect(page.locator("[data-signal-path], [data-reveal]")).toHaveCount(0);
    await page.goto(new URL(SAR_PROJECT, SITE_URL).href);
    await expect(page.locator("[data-figure-inspect]")).toHaveCount(0);
    await expect(page.locator(".source-figure img")).toHaveCount(2);
    await expect(page.locator(".source-figure img").first()).toBeVisible();
    await page.goto(new URL(LT83402_PROJECT_ROUTE, SITE_URL).href);
    await expect(page.locator("[data-figure-inspect]")).toHaveCount(0);
    await expect(page.locator(".source-figure img")).toHaveCount(6);
    await expect(page.locator(".source-figure figcaption a")).toHaveCount(6);
    await context.close();
  });
});

test.describe("project figure inspector", () => {
  test("LT83402 figures preserve public sources and the comparison keeps its conditions", async ({ page }) => {
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto(LT83402_PROJECT_ROUTE);
      await settlePage(page);
      await expect(page.locator("h1")).toHaveText("LT83402: 42 V Low-Noise Buck Regulator");
      await expect(page.locator(".project-facts")).toHaveCount(0);
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute("content", "https://vgmos.github.io/assets/projects/lt83402/lt83402-package.png");
      const triggers = page.locator("[data-figure-inspect]");
      await expect(triggers).toHaveCount(6);
      const figureSources = [
        "https://www.analog.com/en/products/lt83402.html",
        ...[38, 11].map(number => `https://www.analog.com/media/en/technical-documentation/data-sheets/lt83401-lt83402.pdf#page=${number}`),
        "https://www.analog.com/media/en/technical-documentation/data-sheets/lt83203-lt83205.pdf#page=11",
        "https://www.analog.com/media/en/technical-documentation/data-sheets/lt83401-lt83402.pdf#page=16",
        "https://www.analog.com/media/en/technical-documentation/data-sheets/lt83203-lt83205.pdf#page=16",
      ];
      for (const [index, sourceURL] of figureSources.entries()) {
        const trigger = triggers.nth(index);
        const source = await trigger.locator("img").getAttribute("src");
        await trigger.focus();
        await expect(trigger.locator(".figure-inspect__hint")).toHaveText("Inspect figure");
        const clearance = await trigger.evaluate(element => {
          const image = element.querySelector("img").getBoundingClientRect();
          const hint = element.querySelector(".figure-inspect__hint").getBoundingClientRect();
          return { gap: hint.top - image.bottom, height: hint.height, right: hint.right - image.right };
        });
        expect(clearance.gap, "Inspection control must not cover any image data").toBeGreaterThanOrEqual(7.5);
        expect(clearance.height).toBeGreaterThanOrEqual(44);
        expect(clearance.right).toBeLessThanOrEqual(0.5);
        await page.keyboard.press("Enter");
        const dialog = page.locator("[data-figure-inspector]");
        await expect(dialog).toBeVisible();
        await expect(dialog.locator("img")).toHaveAttribute("src", source);
        await expect(dialog.locator("[data-figure-inspector-caption] a")).toHaveAttribute("href", sourceURL);
        await page.keyboard.press("Shift+Tab");
        expect(await dialog.evaluate(el => el.contains(document.activeElement))).toBe(true);
        await page.keyboard.press("Escape");
        await expect(dialog).toBeHidden();
        await expect(trigger).toBeFocused();
      }
      const comparison = page.getByRole("region", { name: "Published LT83402 and LT83205 noise at 2 MHz" });
      await expect(comparison.getByRole("columnheader")).toHaveCount(3);
      for (const row of [
        "Noise at 0 A 3.31 µV RMS 4.42 µV RMS",
        "Noise at 1 A 3.32 µV RMS 4.51 µV RMS",
        "Noise at rated load 2.80 µV RMS at 2.5 A 5.64 µV RMS at 5 A",
        "Input / output 12 V / 3.3 V 12 V / 1 V",
        "Switching frequency 2 MHz 2 MHz",
        "Inductor / nominal output capacitance 2.2 µH / 88 µF 0.47 µH / 183.4 µF",
        "SET capacitor 1 µF 2.2 µF",
      ]) await expect(comparison.getByRole("row", { name: row, exact: true })).toBeVisible();
      await expect(comparison).not.toContainText("1.93");
      await expect(comparison).not.toContainText("6 MHz");
      await expect(page.locator(".project-body")).toContainText("prevent a like-for-like noise ranking");
      await expect(page.locator(".project-body")).toContainText("neither figure specifies switching frequency");
      if (width <= 390) {
        await comparison.focus();
        await comparison.press("ArrowRight");
        await expect.poll(() => comparison.evaluate(el => el.scrollLeft)).toBeGreaterThan(0);
      }
      expect((await pageOverflow(page)).scrollWidth).toBeLessThanOrEqual(width + 1);
    }
  });

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
