import { test, expect } from "./fixtures.mjs";
import { BUCK_LOSS_V2_ROUTE, pageOverflow, settlePage } from "./site.mjs";

const ASYMMETRIC_ROUTE = `${BUCK_LOSS_V2_ROUTE}&tdhl=7&tdlh=1`;

async function waveformView(page) {
  return page.evaluate(() => ({ ...document.querySelector("#buck-loss-explorer").blxV2State.waveformView }));
}

async function dispatchWheel(waveform, options) {
  return waveform.evaluate((element, init) => {
    const rect = element.getBoundingClientRect();
    const event = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(rect.left + rect.width * (init.unitX ?? 0.5)),
      clientY: rect.top + rect.height * 0.5,
      deltaX: init.deltaX ?? 0,
      deltaY: init.deltaY ?? 0,
      ctrlKey: init.ctrlKey ?? false,
      metaKey: init.metaKey ?? false
    });
    const accepted = element.dispatchEvent(event);
    return { accepted, defaultPrevented: event.defaultPrevented };
  }, options);
}

test.describe("Buck loss switching-edge viewer", () => {
  test("calculated ringing responds to explicit parasitics without changing loss or URL state", async ({ page }) => {
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect.poll(() => new URL(page.url()).searchParams.get("rdc")).toBe("4.3");
    const url = page.url();
    const loss = await page.locator('[data-blx-out="loss"]').textContent();
    const ringing = page.locator('[data-blx-waveform-trace="switch-node-ringing"]');
    const status = page.locator("[data-blx-waveform-ringing-status]");
    const originalPath = await ringing.getAttribute("d");
    const originalStatus = await status.textContent();

    await page.locator("[data-blx-waveform-ringing-model] summary").click();
    await expect(page.locator("[data-blx-waveform-ringing-source]")).toContainText("EPC2090 datasheet COSS typical at 50 V");
    await page.locator('[data-blx-waveform-ringing-input="loopInductanceNh"]').fill("4");
    await expect(status).not.toHaveText(originalStatus || "");
    await expect(ringing).not.toHaveAttribute("d", originalPath || "");
    expect(page.url()).toBe(url);
    await expect(page.locator('[data-blx-out="loss"]')).toHaveText(loss || "");
  });

  test("edge presets, anchored zoom, persistent probe, reset, and page scrolling work together", async ({ page }) => {
    await page.goto(ASYMMETRIC_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const root = page.locator("#buck-loss-explorer");
    const waveform = page.locator("[data-blx-waveform-diagram]");
    const status = page.locator("[data-blx-waveform-view-status]");
    await page.waitForTimeout(250);
    const initialView = await waveformView(page);
    const initialUrl = page.url();
    const initialOutputs = await root.locator('[data-blx-out="efficiency"], [data-blx-out="loss"]').allTextContents();

    expect(initialView.mode).toBe("full");
    expect(initialView.startPhase).toBeLessThan(0);
    expect(initialView.endPhase - initialView.startPhase).toBeCloseTo(1, 10);
    await expect(waveform.locator("[data-blx-waveform-edge-flag]:visible")).toHaveCount(2);
    await expect(waveform.locator(".blx-waveform-tick-label").first()).toContainText("-");
    await expect(page.locator('[data-blx-waveform-action="zoom-out"]')).toBeDisabled();
    await expect(page.locator('[data-blx-waveform-action="pan-left"]')).toBeDisabled();
    await expect(page.locator('[data-blx-waveform-action="pan-right"]')).toBeDisabled();

    await waveform.scrollIntoViewIfNeeded();
    await page.evaluate(() => window.scrollBy(0, -120));
    const scrollBefore = await page.evaluate(() => window.scrollY);
    const plotBox = await waveform.boundingBox();
    await page.mouse.move(plotBox.x + plotBox.width * 0.5, plotBox.y + plotBox.height * 0.5);
    await page.mouse.wheel(0, 220);
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(scrollBefore);

    await page.locator('[data-blx-waveform-edge-flag="rising"]').click();
    await expect.poll(() => waveformView(page).then((view) => view.mode)).toBe("rising");
    await page.waitForTimeout(180);
    await expect(status).toContainText("Rising edge");
    await expect(waveform.locator(".blx-waveform-dead-label")).toContainText("1 ns");
    expect(await waveform.locator('[data-blx-waveform-trace="inductor-current"]').evaluate((path) => path.getBBox().height)).toBeGreaterThan(75);
    const risingStates = await waveform.evaluate((element) => element.blxWaveformController.geometry.segments
      .filter((segment) => segment.visibleEndPhase - segment.visibleStartPhase > 1e-12)
      .map((segment) => segment.state)
      .filter((value, index, values) => value !== values[index - 1]));
    expect(risingStates.join(">")).toContain("low-side>dead-time>high-side");

    const box = await waveform.boundingBox();
    await waveform.click({ position: { x: box.width * 0.58, y: 165 } });
    const pinnedProbe = (await waveformView(page)).probePhase;
    const anchorBefore = await waveform.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.blxWaveformController.phaseFromClientX(Math.round(rect.left + rect.width * 0.72));
    });
    const modifiedWheel = await dispatchWheel(waveform, { deltaY: -180, ctrlKey: true, unitX: 0.72 });
    expect(modifiedWheel.defaultPrevented).toBe(true);
    await expect.poll(() => waveformView(page).then((view) => view.mode)).toBe("custom");
    const anchorAfter = await waveform.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return element.blxWaveformController.phaseFromClientX(Math.round(rect.left + rect.width * 0.72));
    });
    expect(anchorAfter).toBeCloseTo(anchorBefore, 7);
    expect((await waveformView(page)).probePhase).toBeCloseTo(pinnedProbe, 12);
    await expect(page.locator("[data-blx-waveform-mode][aria-pressed=true]")).toHaveCount(0);
    const ordinaryWheel = await dispatchWheel(waveform, { deltaY: 180, unitX: 0.5 });
    expect(ordinaryWheel.defaultPrevented).toBe(false);
    expect(ordinaryWheel.accepted).toBe(true);

    await page.locator('[data-blx-waveform-mode="falling"]').click();
    await expect.poll(() => waveformView(page).then((view) => view.mode)).toBe("falling");
    await page.waitForTimeout(180);
    await expect(status).toContainText("Falling edge");
    await expect(waveform.locator(".blx-waveform-dead-label")).toContainText("7 ns");
    const fallingStates = await waveform.evaluate((element) => element.blxWaveformController.geometry.segments
      .filter((segment) => segment.visibleEndPhase - segment.visibleStartPhase > 1e-12)
      .map((segment) => segment.state)
      .filter((value, index, values) => value !== values[index - 1]));
    expect(fallingStates.join(">")).toContain("high-side>dead-time>low-side");
    expect((await waveformView(page)).probePhase).toBeCloseTo(pinnedProbe, 12);
    await expect(status).toContainText("pinned time outside view");
    await expect(page.locator("[data-blx-waveform-probe-chevron]")).toHaveCount(0);
    expect(await waveform.locator('[data-blx-waveform-trace="inductor-current"]').evaluate((path) => path.getBBox().height)).toBeGreaterThan(75);

    const probe = page.locator("[data-blx-waveform-probe]");
    await probe.evaluate((input) => {
      input.value = "500";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const sliderView = await waveformView(page);
    expect(sliderView.probePhase).toBeGreaterThan(sliderView.startPhase);
    expect(sliderView.probePhase).toBeLessThan(sliderView.endPhase);
    await expect(status).not.toContainText("pinned time outside view");

    await waveform.dblclick({ position: { x: box.width * 0.5, y: 170 } });
    await expect.poll(() => waveformView(page).then((view) => view.mode)).toBe("full");
    await page.waitForTimeout(180);
    const reset = await waveformView(page);
    expect(reset.startPhase).toBeCloseTo(initialView.startPhase, 10);
    expect(reset.endPhase).toBeCloseTo(initialView.endPhase, 10);
    await expect(status).toContainText("Full cycle");
    expect(page.url()).toBe(initialUrl);
    expect(await root.locator('[data-blx-out="efficiency"], [data-blx-out="loss"]').allTextContents()).toEqual(initialOutputs);
  });

  test("marquee, escape, pan accelerators, and overview brush obey their bounds", async ({ page, browserName }) => {
    await page.goto(ASYMMETRIC_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const waveform = page.locator("[data-blx-waveform-diagram]");
    const selection = page.locator("[data-blx-waveform-selection]");
    await waveform.scrollIntoViewIfNeeded();
    const box = await waveform.boundingBox();
    const y = box.y + 165;
    const initial = await waveformView(page);

    await page.mouse.move(box.x + box.width * 0.28, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.48, y, { steps: 3 });
    await expect(selection).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(selection).toBeHidden();
    await page.mouse.up();
    const afterEscape = await waveformView(page);
    expect(afterEscape.startPhase).toBeCloseTo(initial.startPhase, 12);
    expect(afterEscape.endPhase).toBeCloseTo(initial.endPhase, 12);

    const probeBefore = afterEscape.probePhase;
    await page.mouse.move(box.x + box.width * 0.7, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.7 + 3, y);
    await page.mouse.up();
    expect((await waveformView(page)).probePhase).not.toBeCloseTo(probeBefore, 6);
    expect((await waveformView(page)).mode).toBe("full");

    await page.mouse.move(box.x + box.width * 0.3, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.62, y, { steps: 4 });
    await page.mouse.up();
    const marqueeView = await waveformView(page);
    expect(marqueeView.mode).toBe("custom");
    expect(marqueeView.endPhase - marqueeView.startPhase).toBeLessThan(0.4);

    const brush = page.locator('[data-blx-overview-brush="body"]');
    let brushBox = await brush.boundingBox();
    const beforeBrushPan = await waveformView(page);
    await page.mouse.move(brushBox.x + brushBox.width / 2, brushBox.y + brushBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(brushBox.x + brushBox.width / 2 + 25, brushBox.y + brushBox.height / 2);
    await page.mouse.up();
    await expect.poll(() => waveformView(page).then((view) => view.startPhase)).not.toBeCloseTo(beforeBrushPan.startPhase, 6);

    const endHandle = page.locator('[data-blx-overview-brush="end"]');
    const handleBox = await endHandle.boundingBox();
    const spanBeforeResize = (await waveformView(page)).endPhase - (await waveformView(page)).startPhase;
    await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox.x - 25, handleBox.y + handleBox.height / 2);
    await page.mouse.up();
    const spanAfterResize = (await waveformView(page)).endPhase - (await waveformView(page)).startPhase;
    expect(spanAfterResize).toBeLessThan(spanBeforeResize);

    const beforeShiftPan = await waveformView(page);
    await page.keyboard.down("Shift");
    await page.mouse.move(box.x + box.width * 0.55, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.48, y);
    await page.mouse.up();
    await page.keyboard.up("Shift");
    expect((await waveformView(page)).startPhase).not.toBeCloseTo(beforeShiftPan.startPhase, 6);

    for (let index = 0; index < 12; index += 1) {
      await dispatchWheel(waveform, { deltaY: -1000, ctrlKey: true, unitX: 0.5 });
    }
    await expect.poll(() => waveformView(page).then((view) => view.endPhase - view.startPhase)).toBeCloseTo(0.001, 8);
    await expect(page.locator('[data-blx-waveform-action="zoom-in"]')).toBeDisabled();
    brushBox = await brush.boundingBox();
    expect(brushBox.width).toBeGreaterThanOrEqual(7.9);

    await page.mouse.move(brushBox.x + brushBox.width / 2, brushBox.y + brushBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(1, brushBox.y + brushBox.height / 2);
    await page.mouse.up();
    await expect(page.locator('[data-blx-waveform-action="pan-left"]')).toBeDisabled();

    if (browserName === "chromium") {
      const beforeMiddlePan = await waveformView(page);
      await page.mouse.move(box.x + box.width * 0.5, y);
      await page.mouse.down({ button: "middle" });
      await page.mouse.move(box.x + box.width * 0.42, y);
      await page.mouse.up({ button: "middle" });
      expect((await waveformView(page)).startPhase).not.toBeCloseTo(beforeMiddlePan.startPhase, 7);
    }
  });

  test("touch scrubbing preserves vertical page gestures and narrow layouts", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const waveform = page.locator("[data-blx-waveform-diagram]");

    const targetSizes = await page.locator(".blx-waveform-toolbar button").evaluateAll((buttons) => buttons.map((button) => {
      const rect = button.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    }));
    expect(targetSizes.every(({ width, height }) => width >= 40 && height >= 40)).toBe(true);
    await expect(waveform).toHaveCSS("touch-action", "pan-y");

    const horizontal = await waveform.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const make = (type, init) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 41, isPrimary: true, button: 0, ...init });
      element.dispatchEvent(make("pointerdown", { clientX: rect.left + 90, clientY: rect.top + 150 }));
      const move = make("pointermove", { clientX: rect.left + 150, clientY: rect.top + 152 });
      const accepted = element.dispatchEvent(move);
      element.dispatchEvent(make("pointerup", { clientX: rect.left + 150, clientY: rect.top + 152 }));
      return { accepted, defaultPrevented: move.defaultPrevented };
    });
    expect(horizontal.defaultPrevented).toBe(true);
    expect(horizontal.accepted).toBe(false);
    expect(await page.evaluate(() => Number.isFinite(document.querySelector("#buck-loss-explorer").blxV2State.waveformGhostPhase))).toBe(true);

    const probeBefore = (await waveformView(page)).probePhase;
    await waveform.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const make = (type) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 42, isPrimary: true, button: 0, clientX: rect.left + rect.width * 0.8, clientY: rect.top + 150 });
      element.dispatchEvent(make("pointerdown"));
      element.dispatchEvent(make("pointerup"));
    });
    expect((await waveformView(page)).probePhase).not.toBeCloseTo(probeBefore, 6);

    const vertical = await waveform.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const make = (type, init) => new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: "touch", pointerId: 43, isPrimary: true, button: 0, ...init });
      element.dispatchEvent(make("pointerdown", { clientX: rect.left + 120, clientY: rect.top + 120 }));
      const move = make("pointermove", { clientX: rect.left + 122, clientY: rect.top + 180 });
      const accepted = element.dispatchEvent(move);
      element.dispatchEvent(make("pointercancel", { clientX: rect.left + 122, clientY: rect.top + 180 }));
      return { accepted, defaultPrevented: move.defaultPrevented };
    });
    expect(vertical.defaultPrevented).toBe(false);
    expect(vertical.accepted).toBe(true);

    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 568 });
      await page.waitForTimeout(50);
      const overflow = await pageOverflow(page);
      expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(overflow.clientWidth + 1);
      expect((await waveform.boundingBox()).width).toBeLessThanOrEqual(width);
    }
  });

  test("reduced motion and degenerate waveform states remain explicit", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const status = page.locator("[data-blx-waveform-view-status]");
    await expect(status).toHaveAttribute("aria-live", "polite");
    await page.locator('[data-blx-waveform-mode="rising"]').click();
    expect((await waveformView(page)).mode).toBe("rising");
    expect(await page.evaluate(() => document.querySelector("#buck-loss-explorer").blxV2State.waveformAnimation)).toBeNull();
    await expect(page.locator('[data-blx-waveform-trace="switch-node-ringing"]')).not.toHaveAttribute("hidden", "");
    await expect(page.locator("[data-blx-waveform-ringing-status]")).toContainText("MHz");

    await page.locator("#blx-v2-vin").fill("2");
    await page.locator("#blx-v2-vin").press("Tab");
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-mode", "invalid");
    expect(await waveformView(page)).toEqual({ mode: "full", startPhase: null, endPhase: null, probePhase: 0.32 });
    await page.locator("#blx-v2-vin").fill("12");
    await page.locator("#blx-v2-vin").press("Tab");
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-mode", "ccm");
    const recoveredView = await waveformView(page);
    expect(recoveredView.mode).toBe("full");
    expect(recoveredView.endPhase - recoveredView.startPhase).toBeCloseTo(1, 10);

    await page.goto(`${BUCK_LOSS_V2_ROUTE.replace("&i=2", "&i=0.1")}`, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-mode", "dcm");
    await expect(page.locator('[data-blx-waveform-trace="switch-node-ringing"]')).toHaveAttribute("hidden", "");
    await expect(page.locator(".blx-waveform-unresolved-label")).toContainText("unresolved DCM commutation");

    await page.goto(`${BUCK_LOSS_V2_ROUTE.replace("&i=2", "&i=0")}`, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(page.locator('[data-blx-waveform-mode="rising"]')).toBeDisabled();
    await expect(page.locator('[data-blx-waveform-mode="falling"]')).toBeDisabled();
    await expect(page.locator("[data-blx-waveform-edge-flag]:visible")).toHaveCount(0);
  });
});
