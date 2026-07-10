import { test, expect } from "./fixtures.mjs";
import { BUCK_LOSS_V2_ROUTE, pageOverflow, settlePage } from "./site.mjs";

test.describe("global navigation", () => {
  test("soft navigation keeps metadata, theme, focus, and history coherent", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const initialTheme = await page.locator("html").getAttribute("data-theme");
    await page.locator(".theme-toggle").click();
    const selectedTheme = initialTheme === "dark" ? "light" : "dark";
    await expect(page.locator("html")).toHaveAttribute("data-theme", selectedTheme);

    await page.locator(".site-nav .page-link--about").click();
    await expect(page).toHaveURL(/\/about\/$/);
    await expect(page.locator("body > main.page-content")).toBeFocused();
    await expect(page).toHaveTitle(/About/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/about\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", selectedTheme);
    await expect(page.locator(".site-nav .page-link--about")).toHaveClass(/page-link--active/);
    await page.waitForTimeout(400);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Tools, projects, and notes" })).toBeVisible();
    await expect(page.locator("body > main.page-content")).toBeFocused();
    await expect(page.locator("html")).toHaveAttribute("data-theme", selectedTheme);
    await page.waitForTimeout(400);

    await page.goForward();
    await expect(page).toHaveURL(/\/about\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();
    await expect(page.locator("body > main.page-content")).toBeFocused();
    await expect(page.locator(".site-nav .page-link--about")).toHaveClass(/page-link--active/);
  });

  test("tool boundaries use native navigation while retaining theme and parent context", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const initialTheme = await page.locator("html").getAttribute("data-theme");
    await page.locator(".theme-toggle").click();
    const selectedTheme = initialTheme === "dark" ? "light" : "dark";

    await page.evaluate(() => { window.__documentBoundaryMarker = "home"; });
    await page.getByRole("link", { name: "Buck Converter Tool", exact: true }).click();
    await expect(page).toHaveURL(/\/tools\/buck-converter\/$/);
    expect(await page.evaluate(() => window.__documentBoundaryMarker)).toBeUndefined();
    await expect(page).toHaveTitle(/Buck Converter Tool/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/tools\/buck-converter\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", selectedTheme);
    await expect(page.locator(".site-nav .page-link--tools")).toHaveClass(/page-link--active/);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", selectedTheme);
    await page.goForward();
    await expect(page).toHaveURL(/\/tools\/buck-converter\/$/);
    await expect(page.locator(".site-nav .page-link--tools")).toHaveClass(/page-link--active/);
  });

  test("back navigation restores the saved home-page scroll position", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await page.waitForTimeout(350);
    const savedScroll = await page.evaluate(() => window.scrollY);
    expect(savedScroll).toBeGreaterThan(100);

    await page.getByRole("link", { name: "A Working Notebook", exact: true }).click();
    await expect(page).toHaveURL(/\/2026\/06\/12\/a-working-notebook\.html$/);
    await expect(page.locator("body > main.page-content")).toBeFocused();
    await page.waitForTimeout(400);
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Tools, projects, and notes" })).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(savedScroll - 30);
  });

  test("direct section URLs scroll and expose the matching active navigation item", async ({ page }) => {
    await page.goto("/#projects", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(page.locator("#projects")).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100);
    await expect(page.locator(".site-nav .page-link--projects")).toHaveClass(/page-link--active/);
  });

  test("the 320px header keeps inline navigation and the theme control reachable", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    await expect(page.locator(".site-title")).toBeVisible();
    await expect(page.locator(".theme-toggle")).toBeVisible();
    const links = page.locator(".site-nav .page-link");
    await expect(links).toHaveCount(4);
    for (let index = 0; index < 4; index += 1) await expect(links.nth(index)).toBeVisible();
    const headerGeometry = await page.locator(".site-title, .site-nav .page-link, .theme-toggle").evaluateAll((elements) => {
      const boxes = elements.map((element) => ({
        label: element.textContent?.trim() || element.getAttribute("aria-label"),
        href: element.getAttribute("href"),
        rect: element.getBoundingClientRect().toJSON()
      }));
      const overlaps = [];
      for (let left = 0; left < boxes.length; left += 1) {
        for (let right = left + 1; right < boxes.length; right += 1) {
          const a = boxes[left].rect;
          const b = boxes[right].rect;
          if (a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top) {
            overlaps.push([boxes[left].label, boxes[right].label]);
          }
        }
      }
      return { boxes, overlaps, viewportWidth: window.innerWidth };
    });
    expect(new Set(headerGeometry.boxes.filter((box) => box.href).map((box) => box.href)).size).toBe(5);
    expect(headerGeometry.overlaps).toEqual([]);
    for (const box of headerGeometry.boxes) {
      expect.soft(box.rect.left, `${box.label} starts outside the viewport`).toBeGreaterThanOrEqual(0);
      expect.soft(box.rect.right, `${box.label} ends outside the viewport`).toBeLessThanOrEqual(headerGeometry.viewportWidth);
    }

    const overflow = await pageOverflow(page);
    expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(overflow.clientWidth + 1);
  });
});

test.describe("Buck Converter Tool", () => {
  test("presets, synchronized inputs, design mode, DCM, duty, and keyboard probe respond", async ({ page }) => {
    await page.goto("/tools/buck-converter/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    await expect(page.locator("#out-d")).not.toHaveText("—");
    const vinRangeBefore = await page.locator("#sl-vin").inputValue();
    await page.locator("#num-vin").fill("24");
    await page.locator("#num-vin").press("Tab");
    await expect(page.locator("#num-vin")).toHaveValue("24");
    await expect.poll(() => page.locator("#sl-vin").inputValue()).not.toBe(vinRangeBefore);

    await page.locator('button[data-preset="bus"]').click();
    await expect(page.locator("#num-vin")).toHaveValue("48");
    await expect(page.locator("#num-vout")).toHaveValue("12");

    await page.locator('button[data-mode="design"]').click();
    await expect(page.locator('button[data-mode="design"]')).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator('[data-mode-field="design"]').first()).toBeVisible();
    await expect(page.locator("#out-design-l")).not.toHaveText("—");
    await expect(page.locator("#out-design-c")).not.toHaveText("—");

    await page.locator("#bc-dcm-toggle").click();
    await expect(page.locator("#bc-dcm-toggle")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#bc-dcm-options")).toHaveAttribute("aria-hidden", "false");

    await page.locator('button[data-mode="analyze"]').click();
    await page.locator("#bc-dcm-toggle").click();
    await page.locator("#bc-duty-slider").fill("50");
    await expect(page.locator("#bc-duty-slider")).toHaveAttribute("aria-valuetext", /50\.0%/);
    await expect(page.locator("#num-vout")).toHaveValue("24");

    const probe = page.locator("#bc-probe-slider");
    await expect(probe).toHaveAttribute("type", "range");
    await expect(probe).toHaveAttribute("aria-valuetext", /\S+/);
    await probe.focus();
    const probeBefore = await probe.inputValue();
    const readoutBefore = await page.locator("#bc-probe-readout").textContent();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => probe.inputValue()).not.toBe(probeBefore);
    await expect.poll(() => page.locator("#bc-probe-readout").textContent()).not.toBe(readoutBefore);

    const toolText = await page.locator(".bc-page").innerText();
    expect(toolText).not.toMatch(/\b(?:NaN|Infinity)\b/);
  });

  test("reduced motion freezes autonomous status changes without disabling calculations", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/tools/buck-converter/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const phase = page.locator("#bc-anim-phase");
    const before = await phase.textContent();
    await page.waitForTimeout(350);
    await expect(phase).toHaveText(before || "");
    await expect(page.locator("#out-d")).not.toHaveText("—");
    const liveMode = await page.locator(".bc-anim-status").getAttribute("aria-live");
    expect([null, "off"]).toContain(liveMode);
  });
});

test.describe("Buck Converter Loss Explorer v2", () => {
  test("a bare first visit requires and remembers an explicit device choice", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    const chooser = page.locator("[data-blx-device-dialog]");
    await expect(chooser).toBeVisible();
    await expect(chooser).toHaveAttribute("aria-labelledby", "blx-device-dialog-title");
    await expect(chooser).toContainText("Choose a switch technology");
    const epc = page.locator('[data-blx-device-choice="epc2090"]');
    await expect(epc).toBeFocused();
    await epc.click();
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-status", "ready");
    await expect(page).toHaveURL(/m=2/);
    await expect(page).toHaveURL(/device=epc2090/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("buck-loss-v2-device"))).toBe("epc2090");

    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(chooser).toHaveCount(0);
    await expect(page.locator("[data-blx-device-label]")).toHaveText("EPC2090 GaN");
    await expect(page.locator("[data-blx-device-source]")).toHaveAttribute("href", /EPC2090_datasheet\.pdf/);
    await expect(page).toHaveURL(/m=2/);

    const preset = page.locator('[data-blx-preset="12v-to-3v3-pol"]');
    await expect(preset).toHaveAttribute("aria-pressed", "true");
    await page.locator("[data-blx-change-device]").click();
    await page.locator('[data-blx-device-choice="silicon-30v"]').click();
    await expect(page.locator("#blx-v2-vin")).toHaveValue("12");
    await expect(preset).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("[data-blx-device-source]")).toBeHidden();

    await page.goto("/tools/buck-losses/?m=2&p=12v-to-3v3-pol&device=not-real&i=2", { waitUntil: "domcontentloaded" });
    const recoveryChooser = page.locator("[data-blx-device-dialog]");
    await expect(recoveryChooser).toBeVisible();
    await page.locator('[data-blx-device-choice="silicon-60v"]').click();
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-status", "ready");
    await expect(page.locator("[data-blx-device-label]")).toHaveText("Silicon teaching · 60 V");
    await expect(page).toHaveURL(/device=silicon-60v/);
  });

  test("presets, keyboard cursor, equation details, URL state, copy, and related navigation work", async ({ page }) => {
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const root = page.locator("#buck-loss-explorer");
    await expect(root).toHaveAttribute("data-blx-status", "ready");
    await expect(root).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("[data-blx-catalog]")).toHaveAttribute("data-catalog-state", "ready");
    await expect(root).toHaveAttribute("data-blx-model", "2");
    await expect(page.locator('[data-blx-out="efficiency"]')).not.toHaveText("—");
    await expect(page.locator("[data-blx-family]")).toHaveCount(8);
    await expect(page.locator(".blx-operating-metric")).toHaveCount(6);
    await expect(page.locator("[data-blx-result-badges]")).toContainText("Total");
    await expect(page.locator(".blx-controls [data-blx-v2-input]")).toHaveCount(5);
    await expect(page.locator("[data-blx-v2-group]")).toHaveCount(6);
    await expect(page.locator("[data-blx-presets] button")).toHaveCount(3);
    await expect(page.locator("[data-blx-try]")).toHaveCount(0);
    await expect(page.locator(".blx-page")).not.toContainText("Light-load sensitive");

    await page.locator('[data-blx-preset="48v-to-12v-bus"]').click();
    await expect(page.locator("#blx-v2-vin")).toHaveValue("48");
    await expect(page).toHaveURL(/m=2/);
    await expect(page).toHaveURL(/p=48v-to-12v-bus/);

    const cursor = page.locator("[data-blx-cursor-rail]");
    await cursor.focus();
    const cursorBefore = await cursor.getAttribute("aria-valuenow");
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => cursor.getAttribute("aria-valuenow")).not.toBe(cursorBefore);

    const pointTab = page.locator('[data-blx-view="point"]');
    const loadTab = page.locator('[data-blx-view="load"]');
    await loadTab.click();
    await loadTab.press("ArrowLeft");
    await expect(pointTab).toHaveAttribute("aria-selected", "true");
    await expect(pointTab).toBeFocused();
    await pointTab.press("ArrowRight");
    await expect(loadTab).toHaveAttribute("aria-selected", "true");
    await expect(loadTab).toBeFocused();
    await pointTab.click();

    const conduction = page.locator('[data-blx-family="mosfetConduction"]');
    await conduction.locator("summary").click();
    await expect(conduction).toContainText("Eq. 4.21");
    await expect(conduction).toContainText("printed p. 182");
    await expect(conduction).toContainText("PDF p. 196");
    await expect(conduction).toContainText("datasheet");
    const controller = page.locator('[data-blx-family="controllerBias"]');
    await controller.locator("summary").click();
    await expect(controller).toContainText("Printed p. 236");
    await expect(controller).toContainText("PDF p. 250");

    const stateURL = page.url();
    const vinBeforeReload = await page.locator("#blx-v2-vin").inputValue();
    await page.reload({ waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(page).toHaveURL(stateURL);
    await expect(page.locator("#blx-v2-vin")).toHaveValue(vinBeforeReload);

    const copyButton = page.locator('[data-blx-view-panel="point"] [data-blx-copy]');
    await copyButton.click();
    await expect(copyButton).toHaveText("Copied");
    await page.getByRole("link", { name: "Buck Converter Ripple Tool" }).click();
    await expect(page).toHaveURL(/\/tools\/buck-converter\/$/);
  });

  test("automatic DCM, held references, technology switching, and chart pinning stay connected", async ({ page }) => {
    await page.goto(BUCK_LOSS_V2_ROUTE.replace(/i=2$/, "i=0.05"), { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const root = page.locator("#buck-loss-explorer");
    await expect(root).toHaveAttribute("data-blx-mode", "dcm");
    await expect(page.locator('[data-blx-out="regime"]')).toHaveText("DCM");
    await expect(page.locator("[data-blx-operating-metrics]")).toContainText("Zero-current window");

    const reference = page.locator('[data-blx-view-panel="point"] [data-blx-reference]');
    await reference.click();
    await expect(reference).toHaveText(/Clear reference/);
    await page.locator('[data-blx-v2-group="controller"] summary').click();
    await page.locator("[data-blx-control-mode]").selectOption("forced-ccm");
    await expect(root).toHaveAttribute("data-blx-mode", "ccm");
    await expect(page.locator("[data-blx-reference-card]")).toContainText("v2 · GaN · DCM");
    await expect(page.locator("[data-blx-reference-card]")).toContainText("v2 · GaN · CCM");

    await page.locator("[data-blx-change-device]").click();
    await page.locator('[data-blx-device-choice="silicon-30v"]').click();
    await expect(page.locator("[data-blx-device-label]")).toHaveText("Silicon teaching · 30 V");
    await expect(root).toHaveAttribute("data-blx-technology", "silicon");
    await expect(page.locator('[data-blx-field="qrrRef"]')).not.toHaveAttribute("hidden", "");
    await expect(page).not.toHaveURL(/teon=/);

    await page.locator('[data-blx-view="load"]').click();
    await expect(page.locator(".blx-view-tabs")).toHaveAttribute("data-active-view", "load");
    await expect(page.locator("[data-blx-efficiency-plot] svg")).toBeVisible();
    await expect(page.locator("[data-blx-loss-plot] path[data-series]")).toHaveCount(3);
    await expect(page.locator(".blx-chart-boundary")).toHaveCount(2);
    await expect(page.locator(".blx-chart-peak")).toHaveCount(1);
    await expect(page.locator(".blx-chart-reference-line")).toHaveCount(4);
    await expect(page.locator("[data-reference-series]")).toHaveCount(3);
    const firstSeries = page.getByRole("combobox", { name: "Loss series 1" });
    await firstSeries.selectOption("switchingTransitions");
    await expect(firstSeries).toHaveValue("switchingTransitions");
    await expect(page.locator("[data-blx-series-controls] button").first()).toHaveText("Pinned");
  });

  test("legacy links remain read-only and import into a canonical v2 URL with deltas", async ({ page }) => {
    await page.goto("/tools/buck-losses/?p=12v-to-3v3-pol&i=2&rhs=123&qhs=99&vf=2&qrr=200&vdrv=6", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const root = page.locator("#buck-loss-explorer");
    await expect(root).toHaveAttribute("data-blx-legacy", "true");
    await expect(page.locator("[data-blx-legacy-banner]")).toContainText("Legacy model v1 · Read-only");
    await expect(page.locator("#blx-num-vin")).toBeDisabled();
    await page.locator("[data-blx-import-v2]").click();
    await page.locator('[data-blx-device-choice="silicon-30v"]').click();
    await expect(page).toHaveURL(/m=2/);
    await expect(page).toHaveURL(/device=silicon-30v/);
    await expect(page.locator("[data-blx-import-delta]")).toContainText("V2 recalculated this point");
    await expect(page.locator("[data-blx-import-delta]")).toContainText("Efficiency delta");
    await expect(root).toHaveAttribute("data-blx-model", "2");
    await expect(page.locator("#blx-v2-rdsHigh")).toHaveValue("5");
    await expect(page.locator("#blx-v2-qgHigh")).toHaveValue("20");
    await expect(page.locator("#blx-v2-diodeVf")).toHaveValue("0.8");
    await expect(page.locator("#blx-v2-qrrRef")).toHaveValue("30");
    await expect(page.locator("#blx-v2-vDrive")).toHaveValue("6");
  });

  test("invalid and exact-zero inputs remain finite and explain unavailable efficiency", async ({ page }) => {
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.locator("#blx-v2-vin").fill("2");
    await page.locator("#blx-v2-vin").press("Tab");
    await expect(page.locator('[data-blx-v2-message="vout"]')).toBeVisible();
    await expect(page.locator('[data-blx-out="efficiency"]')).toHaveText("—");

    await page.locator("#blx-v2-vin").fill("12");
    await page.locator("#blx-v2-vin").press("Tab");
    await page.locator("[data-blx-cursor-rail]").fill("0");
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-mode", "zero-load-unmodeled");
    await expect(page.locator('[data-blx-out="efficiency"]')).toHaveText("—");
    await expect(page.locator("[data-blx-warnings]")).toContainText("controller");
    expect(await page.locator(".blx-page").innerText()).not.toMatch(/\b(?:NaN|Infinity)\b/);
  });

  test("desktop and mobile layouts, focus, charts, and reduced motion satisfy their contracts", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(page.locator("[data-blx-family]")).toHaveCount(8);
    let overflow = await pageOverflow(page);
    expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.offenders, "desktop content must not clip past either viewport edge").toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator("[data-blx-mobile-context]")).toBeVisible();
    await page.locator("[data-blx-input-open]").click();
    const sheet = page.locator("[data-blx-input-sheet]");
    await expect(sheet).toHaveAttribute("open", "");
    await expect(page.locator("#blx-input-sheet-title")).toBeFocused();
    const typeSizes = await page.evaluate(() => ({
      input: Number.parseFloat(getComputedStyle(document.querySelector("#blx-v2-vin")).fontSize),
      efficiency: Number.parseFloat(getComputedStyle(document.querySelector(".blx-efficiency-value")).fontSize),
      result: Number.parseFloat(getComputedStyle(document.querySelector(".blx-summary-metric strong")).fontSize)
    }));
    expect(typeSizes.input).toBeGreaterThanOrEqual(16);
    expect(typeSizes.efficiency).toBeGreaterThanOrEqual(48);
    expect(typeSizes.result).toBeGreaterThanOrEqual(16);
    const sheetScroll = await page.locator(".blx-input-sheet-body").evaluate((body) => ({ client: body.clientHeight, scroll: body.scrollHeight, overflow: getComputedStyle(body).overflowY }));
    expect(sheetScroll.scroll).toBeGreaterThan(sheetScroll.client);
    expect(sheetScroll.overflow).toBe("auto");
    await page.locator("[data-blx-input-close]").click();
    await expect(page.locator("[data-blx-input-open]")).toBeFocused();
    await page.locator('[data-blx-view="load"]').click();
    await expect(page.locator("[data-blx-efficiency-plot] svg")).toBeVisible();
    await expect(page.locator("[data-blx-loss-plot] svg")).toBeVisible();
    overflow = await pageOverflow(page);
    expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.offenders, "mobile content must not clip past either viewport edge").toEqual([]);
  });
});
