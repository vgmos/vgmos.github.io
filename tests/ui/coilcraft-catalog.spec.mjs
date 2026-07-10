import AxeBuilder from "@axe-core/playwright";
import { test, expect } from "./fixtures.mjs";
import { observeRuntimeIssues, pageOverflow, settlePage } from "./site.mjs";

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

async function openInductorPanel(page, { requireReady = true } = {}) {
  if (requireReady) {
    await expect(page.locator("[data-blx-catalog]")).toHaveAttribute("data-catalog-state", "ready");
  }
  const panel = page.locator(".blx-advanced details", { has: page.getByText("Inductor & capacitors") });
  if ((await panel.getAttribute("data-open")) !== "true") {
    await panel.locator("summary").click();
  }
  await expect(panel).toHaveAttribute("data-open", "true");
  return panel;
}

test.describe("Coilcraft inductor catalog", () => {
  test("dropdown loads all 33 catalog parts grouped by series", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await openInductorPanel(page);

    const select = page.locator("[data-blx-catalog-part]");
    await expect(select.locator("option")).toHaveCount(34); // 33 parts + Custom
    await expect(select.locator("optgroup")).toHaveCount(2);
    await expect(select.locator('optgroup[label="XEL4030"] option')).toHaveCount(13);
    await expect(select.locator('optgroup[label="XGL6060"] option')).toHaveCount(20);
    await expect(select.locator("option").first()).toHaveText("Custom / manual");
  });

  test("selecting XGL6060-222 populates L, DCR, and 20% Isat with datasheet metadata", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await openInductorPanel(page);

    await page.locator("[data-blx-catalog-part]").selectOption("XGL6060-222");
    await expect(page.locator("#blx-num-l")).toHaveValue("2.2");
    await expect(page.locator("#blx-num-dcr")).toHaveValue("4.3");
    await expect(page.locator("#blx-num-isat")).toHaveValue("12.1");

    const meta = page.locator("[data-blx-catalog-meta]");
    await expect(meta).toBeVisible();
    await expect(meta).toContainText("XGL6060-222");
    await expect(meta).toContainText("12.1 A");
    await expect(meta).toContainText("20% drop");
    await expect(meta.locator("a")).toHaveAttribute("href", /coilcraft\.com/);
  });

  test("selecting XEL4030-201 falls back to the published 30% Isat rating", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await openInductorPanel(page);

    await page.locator("[data-blx-catalog-part]").selectOption("XEL4030-201");
    await expect(page.locator("#blx-num-l")).toHaveValue("0.2");
    await expect(page.locator("#blx-num-dcr")).toHaveValue("2.15");
    await expect(page.locator("#blx-num-isat")).toHaveValue("22");
    await expect(page.locator("[data-blx-catalog-meta]")).toContainText("30% drop");
  });

  test("switching the DCR assumption updates the DCR input", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await openInductorPanel(page);

    const dcrSelect = page.locator("[data-blx-catalog-dcr]");
    await expect(dcrSelect).toBeDisabled();
    await page.locator("[data-blx-catalog-part]").selectOption("XGL6060-222");
    await expect(dcrSelect).toBeEnabled();
    await expect(page.locator("#blx-num-dcr")).toHaveValue("4.3");

    await dcrSelect.selectOption("max");
    await expect(page.locator("#blx-num-dcr")).toHaveValue("4.8");
    await expect(page.locator("[data-blx-catalog-meta]")).toContainText("max DCR 4.8");

    await dcrSelect.selectOption("typ");
    await expect(page.locator("#blx-num-dcr")).toHaveValue("4.3");
  });

  test("a manual inductance edit returns the selector to Custom / manual", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await openInductorPanel(page);

    const select = page.locator("[data-blx-catalog-part]");
    await select.selectOption("XGL6060-222");
    await expect(page.locator("[data-blx-catalog-meta]")).toBeVisible();

    await page.locator("#blx-num-l").fill("3.3");
    await page.locator("#blx-num-l").press("Tab");
    await expect(select).toHaveValue("");
    await expect(page.locator("[data-blx-catalog-meta]")).toBeHidden();
    await expect(page.locator("[data-blx-catalog-dcr]")).toBeDisabled();
    await expect(page.locator("#blx-num-l")).toHaveValue("3.3");
  });

  test("a catalog load failure keeps the manual workflow and stays quiet", async ({ page }) => {
    const issues = observeRuntimeIssues(page);
    await page.route("**/coilcraft-inductors.v1.json*", (route) => route.fulfill({ status: 500, body: "nope" }));
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    await expect(page.locator("[data-blx-catalog]")).toHaveAttribute("data-catalog-state", "error");
    await openInductorPanel(page, { requireReady: false });
    await expect(page.locator("[data-blx-catalog-message]")).toBeVisible();
    await expect(page.locator("[data-blx-catalog-part]")).toBeDisabled();

    // The manual model still works.
    await expect(page.locator('[data-blx-out="efficiency"]')).not.toHaveText("—");
    await page.locator("#blx-num-vin").fill("24");
    await page.locator("#blx-num-vin").press("Tab");
    await expect(page.locator('[data-blx-out="efficiency"]')).not.toHaveText("—");

    const toolText = await page.locator(".blx-page").innerText();
    expect(toolText).not.toMatch(/\b(?:NaN|Infinity)\b/);
    // The browser logs the deliberate 500 for the catalog request; the tool
    // itself must raise nothing else (no uncaught errors, no failed asset loads).
    const unexpected = issues.filter((issue) => !/Failed to load resource/.test(issue));
    expect(unexpected, unexpected.join("\n")).toEqual([]);
  });

  test("the catalog picker introduces no console errors or serious a11y violations", async ({ page }, testInfo) => {
    const issues = observeRuntimeIssues(page);
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await openInductorPanel(page);
    await page.locator("[data-blx-catalog-part]").selectOption("XGL6060-222");
    await expect(page.locator("[data-blx-catalog-meta]")).toBeVisible();

    const results = await new AxeBuilder({ page }).include(".blx-catalog").withTags(WCAG_TAGS).analyze();
    await testInfo.attach("axe-coilcraft-catalog", {
      body: Buffer.from(JSON.stringify(results, null, 2)),
      contentType: "application/json"
    });
    const severe = results.violations
      .filter((violation) => violation.impact === "critical" || violation.impact === "serious")
      .map((violation) => ({ id: violation.id, help: violation.help, targets: violation.nodes.flatMap((node) => node.target) }));
    expect(severe).toEqual([]);
    expect(issues, issues.join("\n")).toEqual([]);
  });

  test("the open catalog panel does not overflow at desktop or 390px width", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await openInductorPanel(page);
    await page.locator("[data-blx-catalog-part]").selectOption("XGL6060-473");

    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 900 });
      const overflow = await pageOverflow(page);
      expect(overflow.scrollWidth, `${width}px offenders: ${JSON.stringify(overflow.offenders)}`)
        .toBeLessThanOrEqual(overflow.clientWidth + 1);
    }
  });
});
