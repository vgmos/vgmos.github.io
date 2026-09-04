import { mkdir } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "./fixtures.mjs";
import { observeRuntimeIssues, settlePage, BUCK_LOSS_V2_ROUTE } from "./site.mjs";

test("rapid tabs and references leave no faded panels or stale chart paths", async ({ page }) => {
  const issues = observeRuntimeIssues(page);
  await page.goto(BUCK_LOSS_V2_ROUTE);
  await settlePage(page);
  for (let i = 0; i < 8; i++) {
    const view = i % 2 ? "point" : "load";
    await page.locator(`[data-blx-view="${view}"]`).click({ noWaitAfter: true });
    const panel = page.locator(`[data-blx-view-panel="${view}"]`);
    await expect(panel).toBeVisible();
    await expect(panel).toHaveCSS("opacity", "1");
    await expect(page.locator("[data-blx-view-panel]:visible")).toHaveCount(1);
    expect(await panel.evaluate(el => ({ height: el.style.height, position: el.style.position, transform: el.style.transform }))).toEqual({ height: "", position: "", transform: "" });
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  }
  await page.locator('[data-blx-view-panel="point"] [data-blx-reference]').click();
  await page.locator('[data-blx-view="load"]').click();
  await expect(page.locator(".blx-chart-reference-line").first()).toBeVisible();
  await page.locator('[data-blx-view-panel="load"] [data-blx-reference]').click();
  await expect(page.locator(".blx-chart-reference-line")).toHaveCount(0);
  expect(issues).toEqual([]);
});

test("repeated figure inspection clears content and restores keyboard focus", async ({ page }) => {
  const issues = observeRuntimeIssues(page);
  await page.goto("/projects/georgia-tech-noise-shaping-sar-adc/");
  await settlePage(page);
  const trigger = page.locator("[data-figure-inspect]").first();
  const dialog = page.locator("[data-figure-inspector]");
  for (let i = 0; i < 5; i++) {
    await trigger.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("img")).toHaveCount(1);
    await expect(page.locator(".figure-inspector__flight")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(dialog.locator("img")).toHaveCount(0);
    await expect(trigger).toBeFocused();
    await expect(page.locator("html")).not.toHaveClass(/has-modal-dialog/);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
  }
  expect(issues).toEqual([]);
});

test("selected device is compact with optional source conditions", async ({ page }, testInfo) => {
  await page.goto(BUCK_LOSS_V2_ROUTE.replace("device=epc2090", "device=infineon-bsc010n04ls6-4v5"));
  await settlePage(page);
  const card = page.locator(".blx-v2-device-note");
  const details = card.locator("details");
  await expect(card.locator("strong")).toHaveText("BSC010N04LS6");
  await expect(card.locator("[data-blx-device-summary]")).toHaveText("40 V MOSFET · high-side and low-side");
  await expect(details).not.toHaveAttribute("open", "");
  await expect(card.getByRole("link", { name: "Datasheet", exact: true })).toBeVisible();
  await expect(card.getByRole("button", { name: "Change device" })).toBeVisible();
  expect((await card.boundingBox()).height).toBeLessThan(210);
  await expect(page.locator("[data-blx-estimate-limit]")).toBeVisible();
  await expect(page.locator(".blx-v2-confidence")).toHaveCount(0);
  await details.locator("summary").click();
  await expect(details).toContainText("QGS2 is estimated as QGS − QG(th)");
  await expect(details.getByRole("link", { name: "SPICE model", exact: true })).toBeVisible();
  await details.locator("summary").click();
  await page.locator("#blx-v2-vout").fill("13");
  await page.locator("#blx-v2-vout").press("Tab");
  await expect(page.locator("[data-blx-estimate-limit]")).toBeHidden();
  await expect(page.locator("[data-blx-estimate-limit]")).toBeEmpty();
  await page.locator("#blx-v2-vout").fill("3.3");
  await page.locator("#blx-v2-vout").press("Tab");
  await expect(page.locator("[data-blx-estimate-limit]")).toBeVisible();
  if (process.env.THEME_REVIEW_DIR) {
    await mkdir(process.env.THEME_REVIEW_DIR, { recursive: true });
    await page.screenshot({ path: path.join(process.env.THEME_REVIEW_DIR, `${testInfo.project.name}-infineon-desktop.png`), fullPage: true });
    await page.setViewportSize({ width: 320, height: 844 });
    await page.locator("[data-blx-input-open]").click();
    await page.screenshot({ path: path.join(process.env.THEME_REVIEW_DIR, `${testInfo.project.name}-infineon-320.png`) });
  }
});
