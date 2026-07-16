import { test, expect } from "./fixtures.mjs";
import { observeRuntimeIssues, settlePage } from "./site.mjs";

const BUCK_LOSS_WORKSPACE = "/tools/buck-losses/?m=2&p=12v-to-3v3-pol&device=epc2090&control=auto-dcm&timing=auto&part=XGL6060-222&i=2";

async function installMotionProbe(page) {
  await page.addInitScript(() => {
    const targetInfo = (element) => ({
      id: element.id || "",
      className: typeof element.className === "string"
        ? element.className
        : element.getAttribute?.("class") || "",
      family: element.closest?.("[data-blx-family]")?.getAttribute("data-blx-family") || "",
      entryField: element.closest?.("[data-blx-entry-field]")?.getAttribute("data-blx-entry-field") || "",
      referenceCard: element.matches?.("[data-blx-reference-card]") || false,
      referenceButton: Boolean(element.closest?.("[data-blx-reference]")),
      copyButton: Boolean(element.closest?.("[data-blx-copy]"))
    });
    const nativeAnimate = Element.prototype.animate;
    window.__opportunityMotion = { waapi: [], css: [] };
    Element.prototype.animate = function animate(keyframes, options) {
      let keyframeText = "";
      try {
        keyframeText = JSON.stringify(keyframes);
      } catch {
        keyframeText = String(keyframes);
      }
      const normalizedOptions = typeof options === "number" ? { duration: options } : { ...(options || {}) };
      window.__opportunityMotion.waapi.push({
        target: targetInfo(this),
        keyframes: keyframeText,
        duration: Number(normalizedOptions.duration || 0),
        delay: Number(normalizedOptions.delay || 0),
        easing: normalizedOptions.easing || ""
      });
      return nativeAnimate.call(this, keyframes, options);
    };
    document.addEventListener("animationstart", (event) => {
      window.__opportunityMotion.css.push({
        name: event.animationName,
        target: targetInfo(event.target)
      });
    });
  });
}

async function clearMotionProbe(page) {
  await page.evaluate(() => {
    window.__opportunityMotion.waapi.length = 0;
    window.__opportunityMotion.css.length = 0;
  });
}

async function readMotionProbe(page) {
  return page.evaluate(() => structuredClone(window.__opportunityMotion));
}

test.describe("purposeful tool motion", () => {
  test("guided presets acknowledge only fields whose exact values changed", async ({ page }) => {
    const issues = observeRuntimeIssues(page);
    await installMotionProbe(page);
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.getByRole("button", { name: "Start guided setup" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set circuit conditions");

    await clearMotionProbe(page);
    const busPreset = page.locator('[data-blx-entry-preset="48v-to-12v-bus"]');
    await busPreset.click();

    await expect(page.locator("#blx-entry-vin")).toHaveValue("48");
    await expect(page.locator("#blx-entry-vout")).toHaveValue("12");
    await expect(page.locator("#blx-entry-ioutMax")).toHaveValue("3.5");
    await expect(page.locator("#blx-entry-fsw")).toHaveValue("400");
    await expect(page.locator("#blx-entry-cursor")).toHaveValue("3");
    await expect(busPreset).toBeFocused();

    let motion = await readMotionProbe(page);
    let fieldCalls = motion.waapi.filter((call) => call.target.entryField);
    expect(fieldCalls.map((call) => call.target.entryField).sort()).toEqual([
      "cursor",
      "fsw",
      "ioutMax",
      "vin",
      "vout"
    ]);
    expect(new Set(fieldCalls.map((call) => call.duration))).toEqual(new Set([160]));
    expect(fieldCalls.map((call) => call.delay).sort((left, right) => left - right)).toEqual([0, 30, 60, 90, 120]);
    expect(fieldCalls.every((call) => call.keyframes.includes("translateY(2px)"))).toBe(true);

    await page.waitForTimeout(320);
    expect(await page.locator("[data-blx-entry-field]").evaluateAll((fields) => (
      fields.every((field) => field.getAnimations().length === 0)
    ))).toBe(true);
    await clearMotionProbe(page);
    await busPreset.click();
    motion = await readMotionProbe(page);
    expect(motion.waapi.filter((call) => call.target.entryField)).toEqual([]);

    await page.locator("#blx-entry-vin").fill("36");
    await clearMotionProbe(page);
    await busPreset.click();
    await expect(page.locator("#blx-entry-vin")).toHaveValue("48");
    motion = await readMotionProbe(page);
    fieldCalls = motion.waapi.filter((call) => call.target.entryField);
    expect(fieldCalls.map((call) => call.target.entryField)).toEqual(["vin"]);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.locator("#blx-entry-vin").fill("36");
    await clearMotionProbe(page);
    await busPreset.click();
    await expect(page.locator("#blx-entry-vin")).toHaveValue("48");
    motion = await readMotionProbe(page);
    expect(motion.waapi.filter((call) => call.target.entryField)).toEqual([]);
    expect(issues).toEqual([]);
  });

  test("Buck Converter commit cues settle final surfaces but skip direct manipulation", async ({ page }) => {
    const issues = observeRuntimeIssues(page);
    await installMotionProbe(page);
    await page.goto("/tools/buck-converter/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    await clearMotionProbe(page);
    const busPreset = page.locator('button[data-preset="bus"]');
    await busPreset.click();
    await expect(page.locator("#num-vin")).toHaveValue("48");
    await expect(page.locator("#num-vout")).toHaveValue("12");
    await expect.poll(async () => (await readMotionProbe(page)).css.filter((call) => call.name === "bcCommitSettle").length).toBe(3);
    let motion = await readMotionProbe(page);
    expect(motion.css.filter((call) => call.name === "bcCommitSettle").map((call) => call.target.className)).toEqual(expect.arrayContaining([
      expect.stringContaining("bc-results"),
      expect.stringContaining("bc-schematic--animated"),
      expect.stringContaining("bc-scope")
    ]));

    await page.waitForTimeout(240);
    await expect(page.locator(".bc-commit-settle")).toHaveCount(0);
    await clearMotionProbe(page);
    await busPreset.click();
    await page.waitForTimeout(40);
    motion = await readMotionProbe(page);
    expect(motion.css.filter((call) => call.name === "bcCommitSettle")).toEqual([]);

    await page.locator("#num-vin").fill("24");
    await page.locator("#num-vin").press("Tab");
    await page.waitForTimeout(40);
    await expect(page.locator("#num-vin")).toHaveValue("24");
    motion = await readMotionProbe(page);
    expect(motion.css.filter((call) => call.name === "bcCommitSettle")).toEqual([]);

    await clearMotionProbe(page);
    await page.locator('button[data-mode="design"]').click();
    await expect(page.locator('button[data-mode="design"]')).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await readMotionProbe(page)).css.filter((call) => call.name === "bcCommitSettle").length).toBe(3);

    await page.waitForTimeout(240);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await clearMotionProbe(page);
    await page.locator('button[data-preset="core"]').click();
    await expect(page.locator("#num-vin")).toHaveValue("5");
    await expect(page.locator("#num-vout")).toHaveValue("1.8");
    await page.waitForTimeout(40);
    motion = await readMotionProbe(page);
    expect(motion.css.filter((call) => call.name === "bcCommitSettle")).toEqual([]);
    await expect(page.locator(".bc-commit-settle")).toHaveCount(0);
    expect(issues).toEqual([]);
  });

  test("workspace disclosure, reference, and copy cues remain finite and reversible", async ({ page }) => {
    const issues = observeRuntimeIssues(page);
    await installMotionProbe(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BUCK_LOSS_WORKSPACE, { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const family = page.locator('[data-blx-family="magnetics"]');
    const familySummary = family.locator("summary");
    await familySummary.scrollIntoViewIfNeeded();
    await clearMotionProbe(page);
    await familySummary.click();
    await expect(family).toHaveClass(/is-open/);
    await expect(familySummary).toBeFocused();
    await expect.poll(async () => (await readMotionProbe(page)).css.filter((call) => call.name === "blx-v2-family-disclose").length).toBe(1);

    let motion = await readMotionProbe(page);
    const familyFlips = motion.waapi.filter((call) => call.target.family && call.duration === 220);
    expect(familyFlips.length).toBeGreaterThan(0);
    expect(familyFlips.some((call) => {
      const match = call.keyframes.match(/translate\((-?[\d.]+)px,\s*(-?[\d.]+)px\)/);
      return match && Math.abs(Number(match[1])) > 0.5;
    }), "at least one grid sibling should glide across columns instead of teleporting").toBe(true);
    const expandedWidths = await family.evaluate((row) => ({
      row: Math.round(row.getBoundingClientRect().width),
      list: Math.round(row.parentElement.getBoundingClientRect().width)
    }));
    expect(expandedWidths.row).toBe(expandedWidths.list);

    await page.waitForTimeout(260);
    expect(await page.locator("[data-blx-family]").evaluateAll((families) => (
      families.every((row) => row.getAnimations({ subtree: true }).length === 0)
    ))).toBe(true);
    await clearMotionProbe(page);
    await familySummary.click();
    await expect(family).not.toHaveClass(/is-open/);
    motion = await readMotionProbe(page);
    expect(motion.css.filter((call) => call.name === "blx-v2-family-disclose"), "closing keeps native details semantics without a sluggish exit").toEqual([]);
    expect(motion.waapi.filter((call) => call.target.family && call.duration === 220).length).toBeGreaterThan(0);

    const referenceButton = page.locator('[data-blx-view-panel="point"] [data-blx-reference]:visible');
    const referenceCard = page.locator("[data-blx-reference-card]");
    await referenceButton.scrollIntoViewIfNeeded();
    await clearMotionProbe(page);
    await referenceButton.click();
    await expect(referenceButton).toHaveAttribute("data-active", "true");
    await expect(referenceButton).toContainText("Clear reference");
    await expect(referenceCard).toBeVisible();
    await expect(referenceCard).toContainText("Held reference");
    motion = await readMotionProbe(page);
    expect(motion.waapi.some((call) => call.target.referenceCard && call.duration === 220)).toBe(true);
    expect(motion.waapi.some((call) => call.target.referenceButton && call.duration === 140)).toBe(true);

    await page.waitForTimeout(240);
    await clearMotionProbe(page);
    await referenceButton.click();
    await expect(referenceButton).toHaveAttribute("data-active", "false");
    await expect(referenceCard).toHaveAttribute("aria-hidden", "true");
    motion = await readMotionProbe(page);
    expect(motion.waapi.some((call) => call.target.referenceCard && call.duration === 140)).toBe(true);
    expect(motion.waapi.some((call) => call.target.referenceButton && call.duration === 140)).toBe(true);
    await expect(referenceCard).toBeHidden();
    await expect(referenceCard).toBeEmpty();

    const copyButton = page.locator('[data-blx-view-panel="point"] [data-blx-copy]:visible');
    await clearMotionProbe(page);
    await copyButton.click();
    await expect(copyButton).toHaveText("Copied");
    await expect(page.locator("[data-blx-live]")).toHaveText("Link copied to clipboard.");
    await expect.poll(async () => (await readMotionProbe(page)).css.filter((call) => call.name === "blx-value-fluid-swap" && call.target.copyButton).length).toBe(1);
    expect(await copyButton.evaluate((button) => button.getBoundingClientRect().width)).toBeGreaterThanOrEqual(92);
    await expect(copyButton).toHaveText("Copy link", { timeout: 1800 });
    await expect(copyButton.locator("[data-blx-copy-label]")).not.toHaveClass(/blx-value-swap/);
    expect(await copyButton.evaluate((button) => button.getAnimations({ subtree: true }).length)).toBe(0);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await settlePage(page);
    const reducedFamily = page.locator('[data-blx-family="magnetics"]');
    await reducedFamily.locator("summary").scrollIntoViewIfNeeded();
    await clearMotionProbe(page);
    await reducedFamily.locator("summary").click();
    await expect(reducedFamily).toHaveClass(/is-open/);
    motion = await readMotionProbe(page);
    expect(motion.waapi.filter((call) => call.target.family)).toEqual([]);
    expect(motion.css.filter((call) => call.name === "blx-v2-family-disclose")).toEqual([]);

    const reducedReference = page.locator('[data-blx-view-panel="point"] [data-blx-reference]:visible');
    await clearMotionProbe(page);
    await reducedReference.click();
    await expect(page.locator("[data-blx-reference-card]")).toBeVisible();
    motion = await readMotionProbe(page);
    expect(motion.waapi.filter((call) => call.target.referenceCard || call.target.referenceButton)).toEqual([]);

    const reducedCopy = page.locator('[data-blx-view-panel="point"] [data-blx-copy]:visible');
    await clearMotionProbe(page);
    await reducedCopy.click();
    await expect(reducedCopy).toHaveText("Copied");
    motion = await readMotionProbe(page);
    expect(motion.css.filter((call) => call.name === "blx-value-fluid-swap")).toEqual([]);
    expect(issues).toEqual([]);
  });

  test("mobile disclosure reveals detail without sliding rows across it", async ({ page }) => {
    const issues = observeRuntimeIssues(page);
    await installMotionProbe(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BUCK_LOSS_WORKSPACE, { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const family = page.locator('[data-blx-family="magnetics"]');
    await family.locator("summary").scrollIntoViewIfNeeded();
    await clearMotionProbe(page);
    await family.locator("summary").click();
    await expect(family).toHaveClass(/is-open/);
    await page.waitForTimeout(70);

    const overlap = await family.evaluate((row) => {
      const body = row.querySelector(".blx-v2-atomic-list").getBoundingClientRect();
      const followingRows = [];
      for (let sibling = row.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
        followingRows.push(sibling.getBoundingClientRect());
      }
      return followingRows.some((rect) => (
        rect.left < body.right - 0.5
        && rect.right > body.left + 0.5
        && rect.top < body.bottom - 0.5
        && rect.bottom > body.top + 0.5
      ));
    });
    expect(overlap, "following loss rows must not cross the disclosed detail").toBe(false);

    const motion = await readMotionProbe(page);
    expect(motion.css.filter((call) => call.name === "blx-v2-family-disclose").length).toBe(1);
    expect(motion.waapi.filter((call) => call.target.family)).toEqual([]);
    expect(issues).toEqual([]);
  });
});
