import { test, expect } from "./fixtures.mjs";
import { pageOverflow, settlePage } from "./site.mjs";

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

test.describe("Buck Converter Loss Explorer", () => {
  test("preset, Try/Undo, keyboard cursor, accordions, URL state, copy, and related navigation work", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    await expect(page.locator('[data-blx-out="efficiency"]')).not.toHaveText("—");
    await page.locator('[data-blx-preset="48v-to-12v-bus"]').click();
    await expect(page.locator("#blx-num-vin")).toHaveValue("48");
    await expect(page).toHaveURL(/p=48v-to-12v-bus/);

    const fswBefore = Number(await page.locator("#blx-num-fsw").inputValue());
    await page.locator('[data-blx-try="half-fsw"]').click();
    await expect(page.locator("#blx-num-fsw")).toHaveValue(String(fswBefore / 2));
    await expect(page.locator("[data-blx-try-undo]")).toHaveText("Undo");
    await page.locator("[data-blx-try-undo]").click();
    await expect(page.locator("#blx-num-fsw")).toHaveValue(String(fswBefore));

    const cursor = page.locator("[data-blx-cursor-rail]");
    await cursor.focus();
    const cursorBefore = await cursor.getAttribute("aria-valuenow");
    const currentBefore = await page.locator('[data-blx-out="current"]').textContent();
    await page.keyboard.press("ArrowRight");
    await expect.poll(() => cursor.getAttribute("aria-valuenow")).not.toBe(cursorBefore);
    await expect.poll(() => page.locator('[data-blx-out="current"]').textContent()).not.toBe(currentBefore);
    await expect.poll(() => new URL(page.url()).searchParams.get("i")).not.toBe("3");

    const firstAdvanced = page.locator(".blx-advanced details").first();
    await firstAdvanced.locator("summary").click();
    await expect(firstAdvanced).toHaveAttribute("data-open", "true");
    await expect(firstAdvanced).toHaveAttribute("open", "");

    const stateURL = page.url();
    const vinBeforeReload = await page.locator("#blx-num-vin").inputValue();
    const currentBeforeReload = await page.locator('[data-blx-out="current"]').textContent();
    await page.reload({ waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(page).toHaveURL(stateURL);
    await expect(page.locator("#blx-num-vin")).toHaveValue(vinBeforeReload);
    await expect(page.locator('[data-blx-out="current"]')).toHaveText(currentBeforeReload || "");

    const copyButton = page.locator("[data-blx-copy]").first();
    await copyButton.click();
    await expect(copyButton).toHaveText("Copied");

    await page.getByRole("link", { name: "Buck Converter Ripple Tool" }).click();
    await expect(page).toHaveURL(/\/tools\/buck-converter\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Buck Converter Tool" })).toBeVisible();
  });

  test("invalid inputs show a useful warning without non-finite output", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.locator("#blx-num-vin").fill("2");
    await expect(page.locator(".blx-warnings .blx-note")).toContainText(/VIN|input values/i);
    const toolText = await page.locator(".blx-page").innerText();
    expect(toolText).not.toMatch(/\b(?:NaN|Infinity)\b/);
  });

  test("Coilcraft selector fills electrical values and preserves manual fallback", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const details = page.locator(".blx-advanced details").filter({ hasText: "Inductor & capacitors" });
    await details.locator("summary").click();
    const part = page.locator("#blx-catalog-part");
    await expect(part.locator("option")).toHaveCount(34);
    await part.selectOption("XEL4030-201");
    await expect(page.locator("[data-blx-catalog-meta]")).toContainText("additional AC/core modeled at 25 °C");
    await expect(page.locator('[data-blx-out="loss-total"]')).toContainText("Total");
    await expect(page.locator("[data-blx-warnings]")).not.toContainText("outside the characterized");

    await part.selectOption("XGL6060-222");
    await expect(page.locator("#blx-num-l")).toHaveValue("2.2");
    await expect(page.locator("#blx-num-dcr")).toHaveValue("4.3");
    await expect(page.locator("#blx-num-isat")).toHaveValue("12.1");
    await expect(page.locator("[data-blx-catalog-meta]")).toContainText("20% drop");
    await expect(page.locator("[data-blx-catalog-meta]")).toContainText("additional AC/core modeled at 25 °C");
    await expect(page.locator("[data-blx-catalog-meta]")).toContainText("verified 50 kHz–6 MHz");
    await expect(page.locator("[data-blx-catalog-meta]")).toContainText("A ripple p-p");
    await page.locator("#blx-catalog-dcr").selectOption("max");
    await expect(page.locator("#blx-num-dcr")).toHaveValue("4.8");
    await expect.poll(() => new URL(page.url()).searchParams.get("part")).toBe("XGL6060-222");
    await expect.poll(() => new URL(page.url()).searchParams.get("dcrm")).toBe("max");

    await part.selectOption("XGL6060-332");
    await expect(page.locator("[data-blx-catalog-meta]")).toContainText("part-specific AC/core not modeled");
    await expect(page.locator("[data-blx-warnings]")).toContainText("RMS-DCR-only subtotals");
    await page.locator("#blx-num-inductor-ac").fill("25");
    await page.locator("#blx-num-inductor-ac").press("Enter");
    await expect.poll(() => new URL(page.url()).searchParams.get("lac")).toBe("25");
    const manualAcRow = page.locator("[data-blx-breakdown-list] [data-blx-loss-key=\"inductorAc\"]");
    await expect(manualAcRow).toContainText("25 mW");
    await expect(page.locator("[data-blx-warnings]")).toContainText("RMS DCR and the manual AC/core loss");
    await page.locator("#blx-num-dcr").fill("5");
    await expect(part).toHaveValue("");
    await expect(page.locator("[data-blx-catalog-meta]")).toBeHidden();
    await expect(page.locator("#blx-catalog-dcr")).toBeDisabled();
  });

  test("approved residual AC-loss surfaces add once and stop at their domain", async ({ page }) => {
    const axes = { frequency_Hz: [500_000, 2_000_000], dc_current_A: [0, 4], ripple_pp_A: [0.5, 2] };
    await page.route("**/assets/data/coilcraft-inductor-loss-surfaces.v1.json*", async (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: 1,
        permission_status: "approved",
        dataset_version: "ui-fixture",
        parts: {
          "XGL6060-222": {
            part_number: "XGL6060-222",
            ambient_C: 25,
            axes,
            ac_loss_W: axes.frequency_Hz.map(() => axes.dc_current_A.map(() => axes.ripple_pp_A.map(() => 0.1)))
          }
        }
      })
    }));
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const details = page.locator(".blx-advanced details").filter({ hasText: "Inductor & capacitors" });
    await details.locator("summary").click();
    await page.locator("#blx-catalog-part").selectOption("XGL6060-222");
    await expect(page.locator("[data-blx-catalog-meta]")).toContainText("additional AC/core modeled at 25 °C");
    const acRow = page.locator("[data-blx-breakdown-list] [data-blx-loss-key=\"inductorAc\"]");
    await expect(acRow).toContainText("Additional inductor AC/core");
    await expect(acRow).toContainText("100 mW");
    await expect(page.locator('[data-blx-out="loss-total"]')).toContainText("Total");

    await page.locator("#blx-catalog-dcr").selectOption("max");
    await expect(acRow).toContainText("100 mW");
    await expect(page.locator("[data-blx-warnings]")).toContainText("maximum RMS DCR with modeled typical additional AC/core loss");

    await page.locator("#blx-num-fsw").fill("6000");
    await page.locator("#blx-num-fsw").press("Enter");
    await expect(page.locator("[data-blx-warnings]")).toContainText("frequency, ripple-current condition is outside the guarded model limits");
    await expect(page.locator('[data-blx-out="loss-total"]')).toContainText("Subtotal");
    await expect(acRow).toContainText("not modeled");
  });

  test("schema-v2 models expose verified, guarded, and rejected UI states", async ({ page }) => {
    const model = {
      model_schema_version: 2,
      model_type: "frequency-interpolated-ripple-power-law",
      part_number: "XGL6060-472",
      ambient_C: 25,
      waveform: "triangular",
      reference_current_A: 7.8,
      selected_isat_A: 7.8,
      dcr_typ_mOhm: 9.1,
      verified_domain: { frequency_Hz: [500_000, 2_000_000], ripple_pp_A: [0.1, 2] },
      guarded_domain: { frequency_Hz: [50_000, 6_000_000], ripple_pp_A: [0, 6.24] },
      knots: [
        { frequency_Hz: 500_000, a_W_per_A_pow_B: 0.01, b: 2, measured_ripple_pp_A: [0.1, 2] },
        { frequency_Hz: 2_000_000, a_W_per_A_pow_B: 0.04, b: 2, measured_ripple_pp_A: [0.1, 2] }
      ]
    };
    await page.route("**/assets/data/coilcraft-inductor-loss-surfaces.v1.json*", async (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        schema_version: 2,
        permission_status: "approved",
        dataset_version: "ui-v2-fixture",
        parts: { "XGL6060-472": model }
      })
    }));
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const details = page.locator(".blx-advanced details").filter({ hasText: "Inductor & capacitors" });
    await details.locator("summary").click();
    await expect(page.locator('#blx-catalog-part option[value="XGL6060-472"]')).toContainText("AC modeled");
    await page.locator("#blx-catalog-part").selectOption("XGL6060-472");
    await expect(page.locator("[data-blx-catalog-meta]")).toContainText("verified 500 kHz–2 MHz, 0.1–2 A ripple p-p");
    await expect(page.locator("[data-blx-warnings]")).not.toContainText("Guarded extrapolation");
    await expect(page.locator('[data-blx-out="loss-total"]')).toContainText("Total");
    const v2AcRow = page.locator('[data-blx-breakdown-list] [data-blx-loss-key="inductorAc"]');
    const modeledAcMw = Number((await v2AcRow.innerText()).match(/([\d.]+) mW/)?.[1]);
    expect(modeledAcMw).toBeGreaterThan(0);
    await page.locator("#blx-num-inductor-ac").fill("25");
    await page.locator("#blx-num-inductor-ac").press("Enter");
    await expect.poll(async () => Number((await v2AcRow.innerText()).match(/([\d.]+) mW/)?.[1]) - modeledAcMw).toBeCloseTo(25, 1);

    const referenceButton = page.locator('.blx-view-panel:not([hidden]) [data-blx-reference]');
    await referenceButton.click();
    await expect(referenceButton).toHaveAttribute("aria-pressed", "true");
    await page.locator("#blx-num-fsw").fill("5000");
    await page.locator("#blx-num-fsw").press("Enter");
    await expect(page.locator("[data-blx-warnings]")).toContainText("Guarded extrapolation");
    await expect(page.locator('[data-blx-out="loss-total"]')).toContainText("Total");
    await expect(page.locator("[data-blx-reference-summary]")).toContainText("Held:");
    await page.locator('[data-blx-view="load"]').click();
    await expect(page.locator("[data-blx-efficiency-plot] svg")).toBeVisible();
    await expect(page.locator("[data-blx-loss-plot] svg")).toBeVisible();

    await page.locator("#blx-num-inductor-ac").fill("0");
    await page.locator("#blx-num-inductor-ac").press("Enter");
    await page.locator("#blx-num-fsw").fill("50");
    await page.locator("#blx-num-fsw").press("Enter");
    await expect(page.locator("[data-blx-warnings]")).toContainText("outside the guarded model limits");
    await expect(page.locator('[data-blx-out="loss-total"]')).toContainText("Subtotal");
    await expect(page.locator('[data-blx-breakdown-list] [data-blx-loss-key="inductorAc"]')).toContainText("not modeled");
  });

  test("top views, held reference, and mobile input disclosure stay connected", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const pointTab = page.locator('[data-blx-view="point"]');
    const loadTab = page.locator('[data-blx-view="load"]');
    await expect(pointTab).toHaveAttribute("aria-selected", "true");
    await loadTab.click();
    await expect(loadTab).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("[data-blx-efficiency-plot] svg")).toBeVisible();
    await expect(page.locator("[data-blx-loss-plot] svg")).toBeVisible();

    await loadTab.press("ArrowLeft");
    await expect(pointTab).toHaveAttribute("aria-selected", "true");
    const referenceButton = page.locator('.blx-view-panel:not([hidden]) [data-blx-reference]');
    await referenceButton.click();
    await expect(referenceButton).toHaveAttribute("aria-pressed", "true");
    await page.locator('[data-blx-try="half-fsw"]').click();
    await expect(page.locator("[data-blx-reference-summary]")).toContainText("Held:");

    await page.setViewportSize({ width: 390, height: 844 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await settlePage(page);
    const disclosure = page.locator(".blx-input-disclosure");
    await expect(disclosure).not.toHaveAttribute("open", "");
    await disclosure.locator(":scope > summary").click();
    await expect(disclosure).toHaveAttribute("open", "");

    const showAll = page.locator("[data-blx-show-all]");
    await expect(showAll).toHaveAttribute("aria-expanded", "false");
    await showAll.click();
    await expect(showAll).toHaveAttribute("aria-expanded", "true");
    const visibleRows = await page.locator(".blx-loss-row").evaluateAll((rows) => rows.filter((row) => {
      const style = getComputedStyle(row);
      return style.display !== "none" && row.getBoundingClientRect().height > 0;
    }).length);
    expect(visibleRows).toBe(9);
  });

  test("responsive workspace, chart surfaces, and equations preserve their layout contracts", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const initialized = await page.locator(".blx-page").evaluate((root) => ({
      status: root.dataset.blxStatus,
      busy: root.getAttribute("aria-busy"),
      loaderDisplay: getComputedStyle(root.querySelector(".blx-loading-state")).display,
      unresolvedOutputs: [...root.querySelectorAll(".blx-workspace [data-blx-out]")]
        .filter((node) => node.textContent.trim() === "—").length
    }));
    expect(initialized).toEqual({
      status: "ready",
      busy: "false",
      loaderDisplay: "none",
      unresolvedOutputs: 0
    });

    const desktop = await page.locator(".blx-workspace").evaluate((workspace) => {
      const style = getComputedStyle(workspace);
      const powerBalance = document.querySelector("[data-blx-power-balance]");
      return {
        width: workspace.getBoundingClientRect().width,
        columns: style.gridTemplateColumns,
        powerBalanceBottom: powerBalance?.getBoundingClientRect().bottom,
        visibleLossRows: [...document.querySelectorAll(".blx-loss-row")]
          .filter((row) => getComputedStyle(row).display !== "none").length
      };
    });
    expect(desktop.width).toBeCloseTo(1240, 0);
    expect(desktop.columns).toMatch(/^380px\s+/);
    expect(desktop.visibleLossRows).toBe(6);
    expect(desktop.powerBalanceBottom).toBeLessThanOrEqual(901);

    await page.setViewportSize({ width: 768, height: 1024 });
    const tablet = await page.locator(".blx-workspace").evaluate((workspace) => ({
      display: getComputedStyle(workspace).display,
      resultsOrder: getComputedStyle(document.querySelector(".blx-results")).order,
      inputsOrder: getComputedStyle(document.querySelector(".blx-inputs")).order,
      controlColumns: getComputedStyle(document.querySelector(".blx-controls")).gridTemplateColumns,
      inputsOpen: document.querySelector(".blx-input-disclosure")?.open
    }));
    expect(tablet.display).toBe("flex");
    expect(tablet.resultsOrder).toBe("1");
    expect(tablet.inputsOrder).toBe("2");
    expect(tablet.controlColumns.split(" ")).toHaveLength(2);
    expect(tablet.inputsOpen).toBe(true);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.locator(".blx-input-disclosure")).not.toHaveAttribute("open", "");
    await page.locator('[data-blx-view="load"]').click();
    await expect(page.locator("[data-blx-efficiency-plot] svg")).toHaveAttribute("viewBox", "0 0 360 190");
    await expect(page.locator("[data-blx-loss-plot] svg")).toHaveAttribute("viewBox", "0 0 360 215");
    const mobile = await page.locator(".blx-page").evaluate((root) => {
      const equation = root.querySelector(".blx-equations .katex-display");
      const surfaces = [...root.querySelectorAll("[data-blx-across-surface]")];
      return {
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        chartViewBoxes: [...root.querySelectorAll(".blx-plot svg")].map((svg) => svg.getAttribute("viewBox")),
        chartTouchActions: surfaces.map((surface) => surface.style.touchAction),
        equationOverflow: equation ? getComputedStyle(equation).overflowX : null,
        equationScrollable: equation ? equation.scrollWidth >= equation.clientWidth : false
      };
    });
    expect(mobile.scrollWidth).toBeLessThanOrEqual(mobile.clientWidth + 1);
    expect(mobile.chartViewBoxes).toEqual(["0 0 360 190", "0 0 360 215"]);
    expect(mobile.chartTouchActions).toEqual(["pan-y", "pan-y"]);
    expect(mobile.equationOverflow).toBe("auto");
    expect(mobile.equationScrollable).toBe(true);
  });
});
