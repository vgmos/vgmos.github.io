import path from "node:path";
import { mkdir } from "node:fs/promises";
import { test, expect } from "./fixtures.mjs";
import { settlePage, pageOverflow } from "./site.mjs";

async function atCycle(page, cycle) {
  await page.locator("#bc-anim-position").evaluate((input, value) => {
    input.value = String(value * 100);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, cycle);
  return page
    .locator("#bc-anim-schematic")
    .evaluate((svg) => ({ ...svg.dataset }));
}

async function capture(page, testInfo, name) {
  if (!process.env.THEME_REVIEW_DIR) return;
  const dir = path.resolve(process.env.THEME_REVIEW_DIR);
  await mkdir(dir, { recursive: true });
  await page
    .locator(".bc-schematic")
    .screenshot({
      path: path.join(dir, `${testInfo.project.name}-schematic-${name}.png`),
    });
}

test("ideal switch states, current continuity and capacitor current use the computed waveform", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/tools/buck-converter/");
  await settlePage(page);
  await expect(page.getByRole("button", { name: "Play cycle" })).toBeVisible();
  const on = await atCycle(page, 0.05);
  const ripple = ((12 - 3.3) * (3.3 / 12)) / (2e6 * 2.2e-6);
  const expected = 2 - ripple / 2 + (((12 - 3.3) / 2.2e-6) * 0.05) / 2e6;
  expect(+on.inductorCurrent).toBeCloseTo(expected, 8);
  expect(+on.capacitorCurrent).toBeCloseTo(+on.inductorCurrent - 2, 8);
  expect(on).toMatchObject({
    highClosed: "true",
    lowClosed: "false",
    phase: "on",
  });
  await expect(page.locator("#bc-anim-cap")).toContainText("discharging");
  await capture(page, info, "energizing");

  const before = await atCycle(page, 0.274);
  const after = await atCycle(page, 0.276);
  expect(+before.inductorCurrent).toBeCloseTo(+after.inductorCurrent, 2);
  expect(after).toMatchObject({
    highClosed: "false",
    lowClosed: "true",
    phase: "off",
  });
  await expect(page.locator("#bc-anim-cap")).toContainText("charging");
  await capture(page, info, "depleting");

  await page.locator("#num-iload").fill("0.05");
  await page.locator("#num-iload").press("Tab");
  const reverse = await atCycle(page, 0.02);
  expect(+reverse.inductorCurrent).toBeLessThan(0);
  expect(reverse).toMatchObject({ highClosed: "true", lowClosed: "false" });
  await expect(page.locator("#bc-il-arrow")).toHaveAttribute(
    "transform",
    "rotate(180 374 50)",
  );
  await capture(page, info, "reverse-ccm");

  await page.getByRole("button", { name: "Enable DCM", exact: true }).click();
  const idle = await atCycle(page, 0.9);
  expect(idle).toMatchObject({
    highClosed: "false",
    lowClosed: "false",
    phase: "idle",
  });
  expect(+idle.inductorCurrent).toBeCloseTo(0, 10);
  expect(+idle.capacitorCurrent).toBeCloseTo(-0.05, 10);
  await expect(page.locator("#bc-path-high, #bc-path-low").first()).toHaveCSS(
    "opacity",
    "0",
  );
  await expect(page.locator("#bc-path-low")).toHaveCSS("opacity", "0");
  await expect(page.locator("#bc-anim-desc")).toContainText(
    "capacitor supplies the load",
  );
  await capture(page, info, "dcm-idle");

  await page.locator("#num-csw").fill("100");
  await page.locator("#num-csw").press("Tab");
  const ringing = await atCycle(page, 0.9);
  expect(ringing).toMatchObject({
    highClosed: "false",
    lowClosed: "false",
    phase: "idle",
  });
  expect(Number.isFinite(+ringing.inductorCurrent)).toBe(true);
  await expect(page.locator("#bc-anim-desc")).toContainText("optional C");
  await expect(page.locator("#bc-anim-desc")).toContainText(
    "omitted from this ideal schematic",
  );
  await capture(page, info, "csw-idle");
});

test("play, pause and keyboard inspection share one cycle position", async ({
  page,
}) => {
  await page.goto("/tools/buck-converter/");
  await settlePage(page);
  const slider = page.getByRole("slider", { name: "Switching cycle position" });
  await slider.focus();
  await slider.press("Home");
  await expect(slider).toHaveValue("0");
  await slider.press("ArrowRight");
  await expect(slider).toHaveValue("0.1");
  await page.getByRole("button", { name: "Play cycle" }).click();
  await expect.poll(() => slider.inputValue()).not.toBe("0.1");
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = await slider.inputValue();
  await page.waitForTimeout(150);
  await expect(slider).toHaveValue(paused);
  const marker = await page
    .locator("#bc-cycle-head")
    .evaluate((el) => parseFloat(el.style.left));
  expect(marker).toBeCloseTo(+paused, 0);
  const cursors = await page
    .locator(".bc-playback-cursor")
    .evaluateAll((lines) => lines.map((line) => +line.getAttribute("x1")));
  expect(cursors).toHaveLength(3);
  for (const x of cursors)
    expect(x).toBeCloseTo(8 + (+paused / 100 / 3) * (680 - 8 - 76), 0);
  await page.getByRole("link", { name: "About", exact: true }).click();
  await expect(page).toHaveURL(/\/about\/$/);
  await settlePage(page);
  await page.goBack();
  await expect(page).toHaveURL(/\/tools\/buck-converter\//);
  await settlePage(page);
  await expect(page.getByRole("button", { name: "Play cycle" })).toBeVisible();
});

test("reduced motion advances intervals without playback; mobile schematic stays inspectable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto("/tools/buck-converter/");
    await settlePage(page);
    await page.getByRole("button", { name: "Next interval" }).click();
    await expect(page.locator("#bc-anim-schematic")).toHaveAttribute(
      "data-phase",
      "off",
    );
    const viewport = page.getByRole("region", {
      name: /Ideal-switch buck schematic/,
    });
    await viewport.focus();
    await viewport.press("ArrowRight");
    await expect
      .poll(() => viewport.evaluate((el) => el.scrollLeft))
      .toBeGreaterThan(0);
    expect(
      await page
        .locator("#bc-anim-schematic")
        .evaluate((el) => el.getBoundingClientRect().width),
    ).toBeGreaterThanOrEqual(540);
    expect((await pageOverflow(page)).scrollWidth).toBeLessThanOrEqual(
      width + 1,
    );
    await expect(page.locator("#out-d")).not.toHaveText("—");
  }
});
