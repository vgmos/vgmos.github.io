import { test, expect } from "./fixtures.mjs";
import { BUCK_LOSS_V2_ROUTE, observeRuntimeIssues, pageOverflow, settlePage } from "./site.mjs";

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

  test("tools share one soft-navigation lifecycle and restore Buck route state", async ({ page }) => {
    const issues = observeRuntimeIssues(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const initialTheme = await page.locator("html").getAttribute("data-theme");
    await page.locator(".theme-toggle").click();
    const selectedTheme = initialTheme === "dark" ? "light" : "dark";

    await page.evaluate(() => { window.__documentBoundaryMarker = "home"; });
    await page.getByRole("link", { name: "Buck Converter Tool", exact: true }).click();
    await expect(page).toHaveURL(/\/tools\/buck-converter\/$/);
    await settlePage(page);
    expect(await page.evaluate(() => window.__documentBoundaryMarker)).toBe("home");
    await expect(page).toHaveTitle(/Buck Converter Tool/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute("href", /\/tools\/buck-converter\/$/);
    await expect(page.locator("html")).toHaveAttribute("data-theme", selectedTheme);
    await expect(page.locator(".site-nav .page-link--tools")).toHaveClass(/page-link--active/);
    await expect(page.locator("#out-d")).not.toHaveText("—");

    await page.locator("#num-vin").fill("24");
    await page.locator("#num-vin").press("Tab");
    await expect(page.locator("#num-vin")).toHaveValue("24");

    await page.getByRole("link", { name: "Buck Converter Loss Tool", exact: true }).click();
    await expect(page).toHaveURL(/\/tools\/buck-losses\/$/);
    await settlePage(page);
    expect(await page.evaluate(() => window.__documentBoundaryMarker)).toBe("home");
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-status", "ready");
    await expect(page.locator('link[data-vgmos-page-style][href*="buck-losses.css"]')).toHaveCount(1);

    await page.goBack();
    await expect(page).toHaveURL(/\/tools\/buck-converter\/$/);
    await settlePage(page);
    await expect(page.locator("#num-vin")).toHaveValue("24");
    expect(await page.evaluate(() => window.__documentBoundaryMarker)).toBe("home");
    await expect(page.locator("html")).toHaveAttribute("data-theme", selectedTheme);
    await expect.poll(() => page.locator('link[data-vgmos-page-style][href*="buck-losses.css"]').count()).toBe(0);

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { level: 1, name: "Tools, projects, and notes" })).toBeVisible();
    expect(await page.evaluate(() => window.__documentBoundaryMarker)).toBe("home");

    await page.goForward();
    await expect(page).toHaveURL(/\/tools\/buck-converter\/$/);
    await settlePage(page);
    await expect(page.locator("#num-vin")).toHaveValue("24");
    await expect(page.locator(".site-nav .page-link--tools")).toHaveClass(/page-link--active/);

    await page.goForward();
    await expect(page).toHaveURL(/\/tools\/buck-losses\/$/);
    await settlePage(page);
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-status", "ready");
    await expect(page.locator('link[data-vgmos-page-style][href*="buck-losses.css"]')).toHaveCount(1);
    expect(await page.evaluate(() => window.__documentBoundaryMarker)).toBe("home");
    expect(issues).toEqual([]);
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

  test("an in-flight Loss edit cannot overwrite a Back or Forward destination", async ({ page }) => {
    const issues = observeRuntimeIssues(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    await page.getByRole("link", { name: "Buck Converter Loss Tool", exact: true }).click();
    await expect(page).toHaveURL(/\/tools\/buck-losses\/$/);
    await settlePage(page);
    await page.getByRole("button", { name: "Open seeded example" }).click();
    await expect(page).toHaveURL(/\/tools\/buck-losses\/\?/);
    await settlePage(page);
    await expect(page.locator("#blx-v2-vin")).toHaveValue("12");

    await page.locator("#blx-v2-vin").fill("13");
    await page.goBack();
    await expect(page).toHaveURL(/\/tools\/buck-losses\/$/);
    await settlePage(page);
    await page.waitForTimeout(350);
    await expect(page).toHaveURL(/\/tools\/buck-losses\/$/);
    await expect(page.getByRole("button", { name: "Start guided setup" })).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/tools\/buck-losses\/\?/);
    await settlePage(page);
    await expect(page.locator("#blx-v2-vin")).toHaveValue("12");
    expect(issues).toEqual([]);
  });

  test("rapid navigation keeps only the final destination in history", async ({ page }) => {
    const issues = observeRuntimeIssues(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.evaluate(() => { window.__documentBoundaryMarker = "home"; });

    // Dispatch both clicks in the same page task so this deterministically
    // exercises the router's in-flight coalescing path. Two awaited locator
    // clicks can be separated by actionability work long enough for the first
    // transition to finish, especially in WebKit under parallel load.
    await page.evaluate(() => {
      document.querySelector('a[href="/tools/buck-converter/"]')?.click();
      document.querySelector(".site-nav .page-link--about")?.click();
    });
    await expect(page).toHaveURL(/\/about\/$/);
    await settlePage(page);
    await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();
    expect(await page.evaluate(() => window.__documentBoundaryMarker)).toBe("home");

    await page.goBack();
    await expect(page).toHaveURL((url) => (
      url.pathname === "/" && !url.search && !url.hash
    ));
    await settlePage(page);
    await expect(page.getByRole("heading", { level: 1, name: "Tools, projects, and notes" })).toBeVisible();
    expect(issues).toEqual([]);
  });

  test("three post-commit clicks share one transient history entry", async ({ page }) => {
    const issues = observeRuntimeIssues(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.evaluate(() => { window.__documentBoundaryMarker = "home"; });

    const entryIds = await page.evaluate(() => new Promise((resolve, reject) => {
      const deadline = performance.now() + 4000;
      let stage = 0;
      let aboutEntryId = null;

      const advance = () => {
        const transitionIsActive =
          document.documentElement.classList.contains("is-content-entering") ||
          Boolean(document.querySelector(".page-exit-layer"));

        if (stage === 0 && window.location.pathname === "/about/" && transitionIsActive) {
          aboutEntryId = window.history.state?.softEntryId || null;
          stage = 1;
          window.vgmosNavigation.navigate("/writing/");
        } else if (stage === 1 && window.location.pathname === "/writing/" && transitionIsActive) {
          const writingEntryId = window.history.state?.softEntryId || null;
          window.vgmosNavigation.navigate("/about/");
          resolve({ aboutEntryId, writingEntryId });
          return;
        }

        if (performance.now() >= deadline) {
          reject(new Error("Chained navigation did not commit within its active transitions"));
          return;
        }
        requestAnimationFrame(advance);
      };

      window.vgmosNavigation.navigate("/about/");
      requestAnimationFrame(advance);
    }));

    expect(entryIds.aboutEntryId).toBeTruthy();
    expect(entryIds.writingEntryId).toBeTruthy();
    expect(entryIds.writingEntryId).not.toBe(entryIds.aboutEntryId);
    await expect(page).toHaveURL(/\/about\/$/);
    await settlePage(page);
    await expect(page.getByRole("heading", { level: 1, name: "About" })).toBeVisible();
    expect(await page.evaluate(() => window.__documentBoundaryMarker)).toBe("home");

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await settlePage(page);
    await expect(page.getByRole("heading", { level: 1, name: "Tools, projects, and notes" })).toBeVisible();
    expect(issues).toEqual([]);
  });

  test("Back cancels a navigation whose inline module never finishes hydrating", async ({ page }) => {
    const issues = observeRuntimeIssues(page);
    await page.route("**/about/", async (route) => {
      const response = await route.fetch();
      const html = await response.text();
      const stalledHtml = html.replace(
        "</main>",
        '<script type="module">await new Promise(() => {});</script></main>',
      );
      await route.fulfill({ response, body: stalledHtml });
    });

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.locator(".site-nav .page-link--about").click();
    await expect(page).toHaveURL(/\/about\/$/);

    // The About URL is committed, but hydration cannot reach the router's
    // 15-second module timeout. Back must cancel that wait and render Home.
    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Tools, projects, and notes" }),
    ).toBeVisible({ timeout: 4000 });
    await settlePage(page);
    expect(issues).toEqual([]);
  });

  test("a retried navigation still waits for its in-flight page stylesheet", async ({ page }) => {
    const issues = observeRuntimeIssues(page);
    let markCssRequested;
    let releaseCss;
    const cssRequested = new Promise((resolve) => { markCssRequested = resolve; });
    const cssRelease = new Promise((resolve) => { releaseCss = resolve; });

    await page.route("**/css/tools/buck-losses.css*", async (route) => {
      markCssRequested();
      await cssRelease;
      await route.continue();
    });
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    await page.evaluate(() => window.vgmosNavigation.navigate("/tools/buck-losses/"));
    await Promise.race([
      cssRequested,
      page.waitForTimeout(3000).then(() => { throw new Error("Loss stylesheet was not requested"); }),
    ]);

    try {
      // Retry while the first attempt owns the still-loading link. The second
      // attempt must reuse that load promise rather than commit unstyled UI.
      await page.evaluate(() => window.vgmosNavigation.navigate("/tools/buck-losses/"));
      await page.waitForTimeout(200);
      expect(new URL(page.url()).pathname).toBe("/");
    } finally {
      releaseCss();
    }

    await expect(page).toHaveURL(/\/tools\/buck-losses\/$/);
    await settlePage(page);
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-status", "ready");
    expect(issues).toEqual([]);
  });

  test("a soft-navigated device recovery dialog is interactive before initialization settles", async ({ page }) => {
    const issues = observeRuntimeIssues(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.evaluate(() => {
      localStorage.removeItem("buck-loss-v2-device");
      window.__documentBoundaryMarker = "device-recovery";
      window.vgmosNavigation.navigate("/tools/buck-losses/?m=2");
    });

    await expect(page).toHaveURL(/\/tools\/buck-losses\/\?m=2$/);
    const chooser = page.locator("[data-blx-device-dialog]");
    await expect(chooser).toBeVisible();
    await expect.poll(() => page.locator("body > main.page-content").evaluate((main) => main.inert)).toBe(false);

    await chooser.locator("[data-blx-device-choice]").first().click();
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-status", "ready");
    await settlePage(page);
    expect(await page.evaluate(() => window.__documentBoundaryMarker)).toBe("device-recovery");
    expect(issues).toEqual([]);
  });

  test("a click queued after Back preserves the returned history entry", async ({ page }) => {
    const issues = observeRuntimeIssues(page);
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.evaluate(() => { window.__documentBoundaryMarker = "home"; });

    await page.locator(".site-nav .page-link--about").click();
    await expect(page).toHaveURL(/\/about\/$/);

    // Fire Back while About's pushed-entry transition is still settling. The
    // router receives the popstate first; a second click in that same event
    // task then replaces the queued destination before cancellation drains.
    await page.evaluate(() => new Promise((resolve, reject) => {
      const deadline = performance.now() + 3000;
      const arm = () => {
        const transitionIsSettling =
          !document.documentElement.classList.contains("is-content-entering") &&
          Boolean(document.querySelector(".page-exit-layer"));
        if (transitionIsSettling) {
          window.addEventListener("popstate", () => {
            window.vgmosNavigation.navigate("/writing/");
            resolve();
          }, { once: true });
          window.history.back();
          return;
        }
        if (performance.now() >= deadline) {
          reject(new Error("About transition did not enter its settling phase"));
          return;
        }
        requestAnimationFrame(arm);
      };
      arm();
    }));

    await expect(page).toHaveURL(/\/writing\/$/);
    await settlePage(page);
    await expect(page.getByRole("heading", { level: 1, name: "Notebook" })).toBeVisible();
    expect(await page.evaluate(() => window.__documentBoundaryMarker)).toBe("home");

    await page.goBack();
    await expect(page).toHaveURL(/\/$/);
    await settlePage(page);
    await expect(page.getByRole("heading", { level: 1, name: "Tools, projects, and notes" })).toBeVisible();
    expect(issues).toEqual([]);
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

test.describe("Buck Converter Loss Tool", () => {
  test("the bare route offers guided setup and a resumable seeded workspace", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Buck Converter Loss Explorer");
    await expect(page.getByRole("button", { name: "Start guided setup" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open seeded example" })).toBeVisible();
    await expect(page.locator("[data-blx-device-dialog]")).toHaveCount(0);

    await page.getByRole("button", { name: "Open seeded example" }).click();
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-status", "ready");
    await expect(page).toHaveURL(/m=2/);
    await expect(page).toHaveURL(/device=epc2090/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("buck-loss-v2-device"))).toBe("epc2090");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("buck-loss-v2-last-setup"))).toContain("device=epc2090");

    await page.goBack();
    await expect(page).toHaveURL(/\/tools\/buck-losses\/$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Buck Converter Loss Explorer");
    await expect(page.getByText("Resume your last setup", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open previous setup" })).toBeVisible();
    await page.getByRole("button", { name: "Open previous setup" }).click();
    await settlePage(page);
    await expect(page.locator("[data-blx-device-label]")).toHaveText("EPC2090 GaN");
    await expect(page.locator("[data-blx-device-source]")).toHaveAttribute("href", /EPC2090_datasheet\.pdf/);
    await expect(page).toHaveURL(/m=2/);
    await expect(page.locator("[data-blx-prompt]")).toHaveText("A 12 Vᵢₙ point-of-load example with a Coilcraft 2.2 µH inductor.");
    await expect(page.locator("#blx-v2-deadTime")).toHaveValue("2");
    await expect.poll(async () => Number(await page.locator("#blx-v2-effectiveTurnOn").inputValue())).toBeCloseTo(1.590882, 6);
    await expect.poll(async () => Number(await page.locator("#blx-v2-effectiveTurnOff").inputValue())).toBeCloseTo(1.208654, 6);
    await expect(page.locator('[data-blx-field="inductance"] [data-blx-catalog]')).toHaveCount(1);
    await expect(page.locator('[data-blx-v2-group="magnetics"] [data-blx-catalog]')).toHaveCount(0);

    await page.locator('[data-blx-current-fraction="0.25"]').click();
    await expect(page.locator('[data-blx-out="current"]')).toHaveText("0.75 A");
    await expect(page.locator('[data-blx-current-fraction="0.25"]')).toHaveAttribute("aria-pressed", "true");
    await expect.poll(() => new URL(page.url()).searchParams.get("i")).toBe("0.75");

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
    await expect(page.locator("[data-blx-device-label]")).toHaveText("Silicon · 60 V");
    await expect(page).toHaveURL(/device=silicon-60v/);
  });

  test("the guided setup retains draft state and commits one canonical calculation", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.getByRole("button", { name: "Start guided setup" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set circuit conditions");

    await page.locator('[data-blx-entry-preset="48v-to-12v-bus"]').click();
    await expect(page.locator("#blx-entry-vin")).toHaveValue("48");
    await page.getByRole("button", { name: "Continue to switch pair" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Choose a switch pair");
    await expect(page.locator('[data-blx-entry-device][value="silicon-30v"]')).toHaveCount(0);
    await expect(page.locator('[data-blx-entry-device][value="infineon-bsc010n04ls6-4v5"]')).toHaveCount(0);
    await expect(page.locator('[data-blx-entry-device][value="silicon-60v"]')).toHaveCount(1);

    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.locator("#blx-entry-vin")).toHaveValue("48");
    await page.getByRole("button", { name: "Continue to switch pair" }).click();
    await page.locator('[data-blx-entry-device][value="silicon-60v"]').check();
    await page.getByRole("button", { name: "Continue to gate drive" }).click();
    await expect(page.locator("#blx-entry-vDrive")).toHaveValue("5");
    await page.getByRole("button", { name: "Continue to timing" }).click();
    await page.getByRole("button", { name: "Continue to magnetics" }).click();
    await expect(page.locator(".blx-entry-catalog")).toHaveAttribute("data-catalog-state", "ready");
    await expect(page.locator("#blx-entry-part")).toHaveValue("XGL6060-153");
    await page.getByRole("button", { name: "Continue to capacitors & control" }).click();
    await page.getByRole("button", { name: "Review assumptions" }).click();

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Review assumptions");
    await expect(page.locator(".blx-entry-review-rows")).toContainText("48 V → 12 V · 3.5 A max · 0.4 MHz");
    await expect(page.locator(".blx-entry-review-rows")).toContainText("Silicon · 60 V");
    await expect(page.locator(".blx-entry-review-rows")).toContainText("XGL6060-153");
    await page.getByRole("button", { name: "Open loss explorer" }).click();
    await settlePage(page);

    await expect(page).toHaveURL(/m=2/);
    await expect(page).toHaveURL(/p=48v-to-12v-bus/);
    await expect(page).toHaveURL(/device=silicon-60v/);
    await expect(page).toHaveURL(/part=XGL6060-153/);
    await expect(page.locator("#blx-v2-vin")).toHaveValue("48");
    await expect(page.locator("#blx-v2-vout")).toHaveValue("12");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("buck-loss-v2-last-setup"))).toContain("device=silicon-60v");
  });

  test("guided gate inputs resolve from drive and load conditions while manual overrides stay reversible", async ({ page }) => {
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.getByRole("button", { name: "Start guided setup" }).click();
    await page.getByRole("button", { name: "Continue to switch pair" }).click();
    await expect(page.locator('[data-blx-entry-device][value="epc2090"]')).toBeChecked();
    await page.getByRole("button", { name: "Continue to gate drive" }).click();

    const plateau = page.locator("#blx-entry-plateauHigh");
    const rds = page.locator("#blx-entry-rdsHigh");
    const qg = page.locator("#blx-entry-qgHigh");
    const qgd = page.locator("#blx-entry-qgdHigh");
    const turnOn = page.locator("#blx-entry-effectiveTurnOn");
    const plateauAt5V = Number(await plateau.inputValue());
    const qgAt5V = Number(await qg.inputValue());
    const turnOnAt5V = Number(await turnOn.inputValue());

    await page.locator("#blx-entry-vDrive").fill("3.3");
    await expect(rds).toHaveValue("6.4");
    await expect.poll(async () => Number(await qg.inputValue())).toBeLessThan(qgAt5V);
    await expect.poll(async () => Number(await turnOn.inputValue())).toBeGreaterThan(turnOnAt5V);
    await expect.poll(async () => Number(await plateau.inputValue())).toBeCloseTo(plateauAt5V, 10);
    await expect(page.locator("[data-blx-entry-condition-preview]")).toContainText("outside the device's 4.5-5 V recommended range");

    await qg.fill("9");
    await expect(qg).toHaveValue("9");
    const reset = page.locator('[data-blx-entry-condition-reset="qgHigh"]');
    await expect(reset).toBeVisible();
    await page.locator("#blx-entry-vDrive").fill("5");
    await expect(qg).toHaveValue("9");
    await reset.click();
    await expect.poll(async () => Number(await qg.inputValue())).not.toBe(9);
    await expect(page.locator('[data-blx-entry-condition-reset="qgHigh"]')).toBeHidden();

    await page.locator(".blx-entry-advanced > summary").click();
    const automaticQgd = Number(await qgd.inputValue());
    await qgd.fill("1.2");
    const qgdReset = page.locator('[data-blx-entry-condition-reset="qgdHigh"]');
    await expect(qgdReset).toBeVisible();
    await qgdReset.click();
    await expect.poll(async () => Number(await qgd.inputValue())).toBeCloseTo(automaticQgd, 10);
    await expect(qgdReset).toBeHidden();

    await plateau.fill("6");
    await page.getByRole("button", { name: "Continue to timing" }).click();
    await expect(plateau).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#blx-entry-plateauHigh-error")).toContainText("does not exceed the resolved high-side plateau");
    const plateauReset = page.locator('[data-blx-entry-condition-reset="plateauHigh"]');
    await expect(plateauReset).toBeVisible();
    await plateauReset.click();
    await expect(plateau).not.toHaveAttribute("aria-invalid", "true");
    await expect(page.locator("#blx-entry-plateauHigh-error")).toHaveCount(0);
    await expect(page.locator(".blx-entry-form-error")).toHaveCount(0);

    await page.setViewportSize({ width: 390, height: 844 });
    const preview = page.locator("[data-blx-entry-condition-preview]");
    await expect(preview).toBeVisible();
    const previewOverflow = await preview.evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      const offenders = [...node.querySelectorAll("*")]
        .map((child) => ({ tag: child.tagName.toLowerCase(), className: child.className, rect: child.getBoundingClientRect().toJSON() }))
        .filter(({ rect }) => rect.left < bounds.left - 1 || rect.right > bounds.right + 1);
      return {
        left: bounds.left,
        right: bounds.right,
        viewportWidth: innerWidth,
        clientWidth: node.clientWidth,
        scrollWidth: node.scrollWidth,
        offenders
      };
    });
    expect(previewOverflow.left).toBeGreaterThanOrEqual(0);
    expect(previewOverflow.right).toBeLessThanOrEqual(previewOverflow.viewportWidth);
    expect(previewOverflow.scrollWidth).toBeLessThanOrEqual(previewOverflow.clientWidth + 1);
    expect(previewOverflow.offenders, "guided condition cards must not clip on mobile").toEqual([]);
  });

  test("guided validation and catalog failure keep the setup recoverable", async ({ page }) => {
    await page.route("**/assets/data/coilcraft-inductors.v1.json*", (route) => route.abort());
    await page.goto("/tools/buck-losses/", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.getByRole("button", { name: "Start guided setup" }).click();

    await page.locator("#blx-entry-vin").fill("5");
    await page.locator("#blx-entry-vout").fill("12");
    await page.getByRole("button", { name: "Continue to switch pair" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Set circuit conditions");
    await expect(page.locator(".blx-entry-form-error")).toContainText("Output voltage must be below input voltage");

    await page.locator("#blx-entry-vout").fill("3.3");
    await expect(page.locator(".blx-entry-form-error")).toHaveCount(0);
    await page.getByRole("button", { name: "Continue to switch pair" }).click();
    await page.getByRole("button", { name: "Continue to gate drive" }).click();
    await page.getByRole("button", { name: "Continue to timing" }).click();
    await page.getByRole("button", { name: "Continue to magnetics" }).click();

    await expect(page.locator(".blx-entry-catalog")).toHaveAttribute("data-catalog-state", "error");
    await expect(page.locator(".blx-entry-catalog")).toContainText("manual magnetic inputs remain editable");
    await expect(page.locator("#blx-entry-part")).toBeDisabled();
    await expect(page.locator("#blx-entry-inductance")).toBeEnabled();

    await page.getByRole("button", { name: "Exit setup" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Buck Converter Loss Explorer");
  });

  test("incompatible preloaded devices require an explicit compatible replacement", async ({ page }) => {
    await page.goto("/tools/buck-losses/?m=2&p=12v-to-3v3-pol&device=silicon-30v&i=2", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.locator('[data-blx-preset="48v-to-12v-bus"]').click();

    const chooser = page.locator("[data-blx-device-dialog]");
    await expect(chooser).toBeVisible();
    await expect(chooser).toContainText("Choose a switch rated for 48 V");
    await expect(chooser).toContainText("Silicon · 30 V is below this preset's input-voltage class");
    await expect(chooser.locator('[data-blx-device-choice="epc2090"]')).toHaveCount(1);
    await expect(chooser.locator('[data-blx-device-choice="silicon-60v"]')).toHaveCount(1);
    await expect(chooser.locator('[data-blx-device-choice="silicon-100v"]')).toHaveCount(1);
    await expect(chooser.locator('[data-blx-device-choice="silicon-30v"]')).toHaveCount(0);
    await expect(chooser.locator('[data-blx-device-choice="infineon-bsc010n04ls6-4v5"]')).toHaveCount(0);
    await expect(chooser.locator('[data-blx-device-choice="vishay-si7860dp-tps40071evm"]')).toHaveCount(0);
    await expect(page.locator("#blx-v2-vin")).toHaveValue("12");
    await expect(page).toHaveURL(/p=12v-to-3v3-pol/);

    await chooser.locator("[data-blx-device-cancel]").click();
    await expect(chooser).toBeHidden();
    await expect(page.locator("#blx-v2-vin")).toHaveValue("12");
    await expect(page.locator("[data-blx-device-label]")).toHaveText("Silicon · 30 V");

    await page.locator('[data-blx-preset="48v-to-12v-bus"]').click();
    await chooser.locator('[data-blx-device-choice="silicon-60v"]').click();
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-status", "ready");
    await expect(page.locator("[data-blx-device-label]")).toHaveText("Silicon · 60 V");
    await expect(page.locator("#blx-v2-vin")).toHaveValue("48");
    await expect(page.locator("#blx-v2-ioutMax")).toHaveValue("3.5");
    await expect(page.locator("#blx-v2-dcr")).toHaveValue("28.2");
    await expect(page.locator("#blx-v2-rac")).toHaveValue("28.2");
    await expect(page.locator("#blx-v2-inductorIsat")).toHaveValue("4.4");
    await expect(page).toHaveURL(/p=48v-to-12v-bus/);
    await expect(page).toHaveURL(/device=silicon-60v/);
    await expect.poll(() => page.evaluate(() => localStorage.getItem("buck-loss-v2-device"))).toBe("silicon-60v");

    await page.goto("/tools/buck-losses/?m=2&p=48v-to-12v-bus&device=silicon-30v&i=3", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(page.locator("[data-blx-device-dialog]")).toHaveCount(0);
    await expect(page.locator("[data-blx-warnings]")).toContainText("below the entered VIN voltage class");
    await expect(page).toHaveURL(/device=silicon-30v/);

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.setItem("buck-loss-v2-device", "silicon-30v"));
    await page.goto("/tools/buck-losses/?m=2&p=48v-to-12v-bus&i=3", { waitUntil: "domcontentloaded" });
    const rememberedChooser = page.locator("[data-blx-device-dialog]");
    await expect(rememberedChooser).toBeVisible();
    await expect(rememberedChooser).toContainText("Choose a switch rated for 48 V");
    await expect(rememberedChooser.locator('[data-blx-device-choice="silicon-30v"]')).toHaveCount(0);
  });

  test("EPC startup conditions and catalog-failure fallbacks stay explicit", async ({ page }) => {
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(page.locator('[data-blx-out="loss-total"]')).toHaveText("Total · 293.76 mW");
    await expect(page.locator("[data-blx-device-condition-summary]")).toContainText("50 V / 16 A test conditions");
    await expect(page.locator("[data-blx-device-notes]")).toContainText("No shipped EON/EOFF surface is loaded");
    await expect(page.locator("[data-blx-warnings]")).toContainText("illustrative effective-time anchor");
    await expect(page.locator(".blx-equations")).toContainText("no shipped device template currently loads one");
    const conditions = page.locator("[data-blx-device-conditions]");
    await conditions.locator("summary").click();
    await expect(conditions.locator("[data-blx-device-condition-list] li")).toHaveCount(11);
    await expect(conditions).toContainText("High/low-side QG: 7.3 nC typical");
    await expect(conditions).toContainText("maximum 9.3 nC");
    await expect(conditions).toContainText("High/low-side COSS(ER): 441 pF energy-equivalent");
    await expect(conditions).toContainText("Effective turn-on overlap: 3 ns illustrative assumption");

    await page.route("**/assets/data/coilcraft-inductors.v1.json*", (route) => route.abort());
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(page.locator("[data-blx-catalog]")).toHaveAttribute("data-catalog-state", "error");
    await expect(page.locator("#blx-v2-dcr")).toHaveValue("4.3");
    await expect(page.locator("#blx-v2-rac")).toHaveValue("4.3");
    await expect(page.locator("#blx-v2-inductorIsat")).toHaveValue("12.1");
    await expect(page.locator("[data-blx-availability-label]")).toHaveText("Subtotal");
    await expect(page.locator("[data-blx-subtotal-copy]")).toContainText("never counted as zero");
  });

  test("Infineon source conditions and unavailable loss families stay explicit", async ({ page }) => {
    await page.goto("/tools/buck-losses/?m=2&p=12v-to-3v3-pol&device=infineon-bsc010n04ls6-4v5&control=auto-dcm&timing=effective&i=2", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    await expect(page.locator("[data-blx-device-label]")).toHaveText("Infineon BSC010N04LS6 pair");
    await expect(page.locator("[data-blx-device-source]")).toHaveAttribute("href", /bsc010n04ls6-datasheet-en\.pdf/i);
    await expect(page.locator("[data-blx-device-model-source]")).toHaveAttribute("href", /OptiMOS6_40V_Spice\.zip/i);
    await expect(page.locator("[data-blx-device-model-source]")).toHaveAttribute("title", /LTspice requires \.options Thev_Induc=1/);
    await expect(page.locator("[data-blx-device-model-guide]")).toHaveAttribute("href", /powermosfet-simulationmodels/i);
    await expect(page.locator("[data-blx-device-model-note]")).toContainText("Vendor archive 280225 · 28-Feb-2025");
    await expect(page.locator("[data-blx-device-model-note]")).toContainText("LTspice requires .options Thev_Induc=1");
    await expect(page.locator("[data-blx-device-notes] li")).toHaveCount(5);
    await expect(page.locator("[data-blx-device-notes]")).toContainText("Asymptotic QRR scales linearly from its 10 A reference point");
    await expect(page.locator("[data-blx-device-notes]")).toContainText("capped by diffusion buildup during LS→HS dead time");
    await expect(page.locator("[data-blx-device-notes]")).toContainText("QGD and QRR are defined by design");
    await expect(page.locator("[data-blx-device-summary]")).toContainText("Mixed datasheet typical · 25 °C · VGS 4.5 V");
    await expect(page.locator("[data-blx-device-condition-summary]")).toContainText("QGS2 is inferred");
    await expect(page.locator("[data-blx-device-condition-summary]")).toContainText("edge timing unavailable with the current evidence");
    await expect(page.locator("[data-blx-operating-metrics]")).toContainText("3 terms omitted");
    const transitions = page.locator('[data-blx-family="switchingTransitions"]');
    await expect(transitions.locator(".blx-loss-name b")).toHaveAttribute("title", /current is already flowing while voltage still remains/i);
    await transitions.locator("summary").click();
    await expect(transitions.locator(".blx-v2-family-intuition")).toContainText("That brief overlap spends energy twice per cycle");
    await page.locator("[data-blx-efficiency-label]").click();
    const coverage = page.locator("[data-blx-coverage-popover]");
    await expect(coverage).toBeVisible();
    await expect(coverage).toContainText("Why this is a ceiling, not an estimate");
    await expect(coverage).toContainText("Missing terms are never counted as zero");
    await page.keyboard.press("Escape");
    await expect(coverage).toBeHidden();

    const conditions = page.locator("[data-blx-device-conditions]");
    await conditions.locator("summary").click();
    await expect(conditions.locator("[data-blx-device-condition-list] li")).toHaveCount(9);
    await expect(conditions).toContainText("High/low-side QGD: 8.1 nC typical");
    await expect(conditions).toContainText("maximum 12 nC");
    await expect(conditions).toContainText("Defined by design; not subject to production test");
    await expect(conditions).toContainText("QRR reference current: 10 A reference condition");
    await expect(conditions).toContainText("Gate drive voltage: 4.5 V selected test condition");

    for (const familyId of ["switchingTransitions", "nodeEnergy"]) {
      const family = page.locator(`[data-blx-family="${familyId}"]`);
      await expect(family).toHaveAttribute("data-blx-availability", "unavailable");
      await expect(family.locator("summary > strong")).toHaveText("—");
      await expect(family.locator("summary > strong")).toHaveAttribute("aria-label", "Not available");
      await family.locator("summary").click();
      await expect(family).toContainText("Not available");
    }
    await expect(page.locator("[data-blx-subtotal-copy]")).toContainText("never counted as zero");
  });

  test("touch coverage popovers stay pinned until their close button is tapped", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/tools/buck-losses/?m=2&p=12v-to-3v3-pol&device=infineon-bsc010n04ls6-4v5&control=auto-dcm&timing=effective&i=2", { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const trigger = page.locator("[data-blx-efficiency-label]");
    const coverage = page.locator("[data-blx-coverage-popover]");
    await trigger.dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
    await trigger.dispatchEvent("click", { detail: 1 });
    await trigger.dispatchEvent("pointerup", { pointerType: "touch", isPrimary: true });
    await trigger.dispatchEvent("pointerout", { pointerType: "touch", isPrimary: true });
    await trigger.dispatchEvent("focusout");
    await page.waitForTimeout(250);

    await expect(coverage).toBeVisible();
    await page.locator("main").dispatchEvent("pointerdown", { pointerType: "touch", isPrimary: true });
    await expect(coverage).toBeVisible();
    await coverage.locator("[data-blx-coverage-close]").click();
    await expect(coverage).toBeHidden();
  });

  test("presets, keyboard cursor, equation details, URL state, copy, and related navigation work", async ({ page }) => {
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const root = page.locator("#buck-loss-explorer");
    await expect(root).toHaveAttribute("data-blx-status", "ready");
    await expect(root).toHaveAttribute("aria-busy", "false");
    await expect(page.locator("[data-blx-catalog]")).toHaveAttribute("data-catalog-state", "ready");
    await expect(root).toHaveAttribute("data-blx-model", "2");
    await expect(root).toHaveAttribute("data-blx-revision", "2.5");
    await expect(page.locator('[data-blx-out="efficiency"]')).not.toHaveText("—");
    await expect(page.locator("[data-blx-family]")).toHaveCount(8);
    await expect(page.locator("[data-blx-operating-metrics] .blx-operating-metric")).toHaveCount(8);
    await expect(page.locator("[data-blx-confidence-metrics] .blx-operating-metric")).toHaveCount(4);
    await expect(page.locator("[data-blx-confidence-metrics]")).toContainText("Effective-time fallback · low");
    await expect(page.locator("[data-blx-confidence-copy]")).toContainText("engineering bounds, not a statistical confidence interval");
    await expect(page.locator("[data-blx-timing-mode]")).toHaveValue("auto");
    await expect(page.locator("[data-blx-availability-label]")).toHaveText("Total");
    await expect(page.locator("[data-blx-model-label]")).toHaveCount(0);
    await expect(page.locator("[data-blx-device-summary]")).toContainText("Mixed datasheet typical · 25 °C");
    await expect(page.locator("[data-blx-device-model-source]")).toHaveAttribute("href", /EPCGaNLibrary\.zip$/);
    await expect(page.locator("[data-blx-device-model-note]")).toContainText("Vendor archive 1.104 · 22-Jul-2025");
    await expect(page.locator("[data-blx-operating-metrics]")).toContainText("Coverage");
    await expect(page.locator("[data-blx-operating-metrics]")).toContainText("All terms modeled");
    await expect(page.locator("[data-blx-operating-metrics]")).toContainText("EON / EOFF");
    await expect(page.locator("[data-blx-operating-metrics]")).toContainText("ION / IOFF");
    await expect(page.locator(".blx-controls [data-blx-v2-input]")).toHaveCount(5);
    await expect(page.locator("[data-blx-v2-group]")).toHaveCount(6);
    await expect(page.locator("[data-blx-presets] button")).toHaveCount(3);
    await expect(page.locator("[data-blx-try]")).toHaveCount(0);
    await expect(page.locator(".blx-page")).not.toContainText("Light-load sensitive");
    const timingGroup = page.locator('[data-blx-v2-group="timing"]');
    await timingGroup.locator("summary").click();
    await expect(page.locator("#blx-v2-deadTimeHighToLow")).toHaveValue("");
    await expect(page.locator("#blx-v2-deadTimeLowToHigh")).toHaveValue("");
    const lossBeforeEdgeEdit = await page.locator('[data-blx-out="loss"]').textContent();
    await page.locator("#blx-v2-deadTimeHighToLow").fill("7");
    await page.locator("#blx-v2-deadTimeHighToLow").press("Tab");
    await expect.poll(() => new URL(page.url()).searchParams.get("tdhl")).toBe("7");
    await expect(page.locator('[data-blx-out="loss"]')).not.toHaveText(lossBeforeEdgeEdit || "");
    await expect(page.locator("[data-blx-confidence-metrics]")).toContainText("LS full-zvs · HS hard-switching");
    await page.locator("#blx-v2-deadTimeHighToLow").fill("");
    await page.locator("#blx-v2-deadTimeHighToLow").press("Tab");
    await expect.poll(() => new URL(page.url()).searchParams.has("tdhl")).toBe(false);
    const mismatch = page.locator('[data-blx-view-panel="point"] [data-blx-report-mismatch]');
    await expect(mismatch).toHaveAttribute("href", /github\.com\/vgmos\/vgmos\.github\.io\/issues\/new/);
    const mismatchBody = await mismatch.getAttribute("href").then((href) => new URL(href).searchParams.get("body"));
    expect(mismatchBody).not.toContain("Model revision:");
    expect(mismatchBody).toContain("Device: epc2090");
    expect(mismatchBody).toContain("Coverage: total");

    const waveform = page.locator("[data-blx-waveform-diagram]");
    await expect(waveform.locator('[data-blx-waveform-trace="switch-node"]')).toHaveCount(1);
    await expect(waveform.locator('[data-blx-waveform-trace="inductor-current"]')).toHaveCount(1);
    await expect(waveform.locator('[data-blx-waveform-trace="gate-high"]')).toHaveCount(0);
    await expect(waveform.locator('[data-blx-waveform-trace="gate-low"]')).toHaveCount(0);
    await expect(page.locator("[data-blx-boundary-copy]")).toHaveCount(0);
    await expect(page.locator("[data-blx-waveform-probe-chevron]")).toHaveCount(0);
    await expect(waveform.locator("[data-blx-dead-time-band]")).toHaveCount(2);
    await expect(waveform.locator("svg")).not.toHaveAttribute("aria-label", /gate commands/i);
    await expect(page.locator(".blx-waveform-note")).toContainText("auto-fits iL vertically");
    await expect(page.locator(".blx-waveform-note")).toContainText("calculated, step/ramp-excited first-order series-RLC response");
    await expect(page.locator(".blx-waveform-note")).toContainText("excluded from the loss total");
    const waveformProbe = page.locator("[data-blx-waveform-probe]");
    const waveformReadout = page.locator("[data-blx-waveform-readout]");
    const waveformReadoutBefore = await waveformReadout.textContent();
    await waveformProbe.focus();
    await page.keyboard.press("ArrowRight");
    await expect(waveformReadout).not.toHaveText(waveformReadoutBefore || "");
    await expect(waveformProbe).toHaveAttribute("aria-valuetext", /VSW(?: RLC)? ≈ .* · (?:drive target .* · )?iL/);

    const familyGrid = await page.locator("[data-blx-family-list]").evaluate((list) => {
      const rows = [...list.querySelectorAll("[data-blx-family]")].slice(0, 2);
      return {
        columns: getComputedStyle(list).gridTemplateColumns.split(" ").length,
        firstTop: Math.round(rows[0].getBoundingClientRect().top),
        secondTop: Math.round(rows[1].getBoundingClientRect().top)
      };
    });
    expect(familyGrid.columns).toBe(2);
    expect(familyGrid.firstTop).toBe(familyGrid.secondTop);

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
    await expect(conduction).toHaveClass(/is-open/);
    const expandedWidths = await conduction.evaluate((row) => ({
      row: Math.round(row.getBoundingClientRect().width),
      list: Math.round(row.parentElement.getBoundingClientRect().width)
    }));
    expect(expandedWidths.row).toBe(expandedWidths.list);
    await expect(conduction).toContainText("Eq. 4.21");
    await expect(conduction).toContainText("printed p. 182");
    await expect(conduction).toContainText("PDF p. 196");
    await expect(conduction).toContainText("datasheet");
    const controller = page.locator('[data-blx-family="controllerBias"]');
    await controller.locator("summary").click();
    await expect(controller).toContainText("printed p. 236");
    await expect(controller).toContainText("PDF p. 250");
    await expect(page.getByText("Switched Inductor Power IC Design", { exact: true })).toHaveCount(1);

    const stateURL = page.url();
    const vinBeforeReload = await page.locator("#blx-v2-vin").inputValue();
    await page.reload({ waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(page).toHaveURL(stateURL);
    await expect(page.locator("#blx-v2-vin")).toHaveValue(vinBeforeReload);

    const copyButton = page.locator('[data-blx-view-panel="point"] [data-blx-copy]:visible');
    await copyButton.click();
    await expect(copyButton).toHaveText("Copied");
    await page.getByRole("link", { name: "Buck Converter Ripple Tool" }).click();
    await expect(page).toHaveURL(/\/tools\/buck-converter\/$/);
  });

  test("workspace conditioning recalculates from drive and current without turning calculated values into URL overrides", async ({ page }) => {
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const driveGroup = page.locator('[data-blx-v2-group="drive"]');
    await driveGroup.locator("summary").click();

    const plateau = page.locator("#blx-v2-plateauHigh");
    const qg = page.locator("#blx-v2-qgHigh");
    const qgd = page.locator("#blx-v2-qgdHigh");
    const turnOn = page.locator("#blx-v2-effectiveTurnOn");
    const loss = page.locator('[data-blx-out="loss-total"]');
    const edgeEnergy = page.locator("[data-blx-operating-metrics] .blx-operating-metric").filter({ hasText: "EON / EOFF" });
    const plateauAt5V = Number(await plateau.inputValue());
    const qgAt5V = Number(await qg.inputValue());
    const qgdAt12V = Number(await qgd.inputValue());
    const turnOnAt5V = Number(await turnOn.inputValue());
    const lossAt5V = await loss.textContent();
    const edgeEnergyAt5V = await edgeEnergy.textContent();

    await page.locator("#blx-v2-vDrive").fill("3.3");
    await page.locator("#blx-v2-vDrive").press("Tab");
    await expect(page.locator("#blx-v2-rdsHigh")).toHaveValue("6.4");
    await expect.poll(async () => Number(await qg.inputValue())).toBeLessThan(qgAt5V);
    await expect.poll(async () => Number(await turnOn.inputValue())).toBeGreaterThan(turnOnAt5V);
    await expect.poll(async () => Number(await plateau.inputValue())).toBeCloseTo(plateauAt5V, 10);
    await expect.poll(async () => Number(await qgd.inputValue())).toBeCloseTo(qgdAt12V, 10);
    await expect(loss).not.toHaveText(lossAt5V || "");
    await expect(edgeEnergy).not.toHaveText(edgeEnergyAt5V || "");
    await expect(page.locator("[data-blx-device-condition-summary]")).toContainText("live EON/EOFF re-resolve");
    await expect(page.locator("[data-blx-warnings]")).toContainText("outside the device's 4.5-5 V recommended range");
    await expect.poll(() => {
      const params = new URL(page.url()).searchParams;
      return {
        drive: params.get("vdrv"),
        rds: params.has("rhs"),
        qg: params.has("qgh"),
        qgd: params.has("qgdh"),
        plateau: params.has("vplh"),
        turnOn: params.has("teon")
      };
    }).toEqual({ drive: "3.3", rds: false, qg: false, qgd: false, plateau: false, turnOn: false });

    await qgd.fill("1.2");
    await qgd.press("Tab");
    const qgdReset = page.locator('[data-blx-condition-reset="qgdHigh"]');
    await expect(qgdReset).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("qgdh")).toBe("1.2");
    await page.locator("#blx-v2-vin").fill("10");
    await page.locator("#blx-v2-vin").press("Tab");
    await expect(qgd).toHaveValue("1.2");
    await qgdReset.click();
    await expect.poll(async () => Number(await qgd.inputValue())).not.toBe(1.2);
    await expect.poll(() => new URL(page.url()).searchParams.has("qgdh")).toBe(false);
    const qgdAt10V = Number(await qgd.inputValue());
    await page.locator("#blx-v2-vin").fill("8");
    await page.locator("#blx-v2-vin").press("Tab");
    await expect.poll(async () => Number(await qgd.inputValue())).toBeLessThan(qgdAt10V);
    await expect.poll(() => new URL(page.url()).searchParams.has("qgdh")).toBe(false);

    await qg.fill("9");
    await qg.press("Tab");
    const reset = page.locator('[data-blx-condition-reset="qgHigh"]');
    await expect(reset).toBeVisible();
    await expect.poll(() => new URL(page.url()).searchParams.get("qgh")).toBe("9");
    await page.locator("#blx-v2-vDrive").fill("5");
    await page.locator("#blx-v2-vDrive").press("Tab");
    await expect(qg).toHaveValue("9");
    await reset.click();
    await expect.poll(async () => Number(await qg.inputValue())).not.toBe(9);
    await expect.poll(() => new URL(page.url()).searchParams.has("qgh")).toBe(false);

    await page.locator("#blx-v2-ioutMax").fill("5");
    await page.locator("#blx-v2-ioutMax").press("Tab");
    await expect.poll(async () => Number(await plateau.inputValue())).toBeGreaterThan(plateauAt5V);

    await plateau.fill("6");
    await plateau.press("Tab");
    await expect(plateau).toHaveAttribute("aria-invalid", "true");
    await expect(page.locator('[data-blx-v2-message="plateauHigh"]')).toContainText("does not exceed the resolved high-side plateau");
    await expect(page.locator("#blx-v2-vDrive")).not.toHaveAttribute("aria-invalid", "true");
    const plateauReset = page.locator('[data-blx-condition-reset="plateauHigh"]');
    await expect(plateauReset).toBeVisible();
    await plateauReset.click();
    await expect(plateau).not.toHaveAttribute("aria-invalid", "true");

    await plateau.fill("0.1");
    await plateau.press("Tab");
    await expect(page.locator('[data-blx-v2-message="plateauHigh"]')).toContainText("below the device transfer-fit threshold");
    await plateauReset.click();

    await turnOn.fill("");
    await turnOn.press("Tab");
    await expect(page.locator("[data-blx-device-condition-summary]")).toContainText("edge timing unavailable with the current evidence");
    await page.locator('[data-blx-condition-reset="effectiveTurnOn"]').click();
    await expect(page.locator("[data-blx-device-condition-summary]")).toContainText("conditioned edge times");
  });

  test("hidden legacy low-side condition parameters self-heal instead of blocking an uneditable state", async ({ page }) => {
    await page.goto(`${BUCK_LOSS_V2_ROUTE}&vpll=6&qgs2l=100&qgdl=100`, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const root = page.locator("#buck-loss-explorer");
    await expect(root.locator('[data-blx-out="efficiency"]')).not.toHaveText("—");
    await expect(page.locator('[data-blx-v2-message="vDrive"]')).toBeHidden();
    await expect.poll(() => page.evaluate(() => {
      const state = document.querySelector("#buck-loss-explorer")?.blxV2State;
      return {
        plateauMirrored: Math.abs(Number(state?.rawInputs?.plateauLow) - Number(state?.rawInputs?.plateauHigh)) < 1e-12,
        plateauProvenance: state?.rawInputs?.__provenance?.plateauLow,
        urlHasHidden: ["vpll", "qgs2l", "qgdl"].some((key) => new URL(location.href).searchParams.has(key))
      };
    })).toEqual({
      plateauMirrored: true,
      plateauProvenance: "calculated-condition-plateau",
      urlHasHidden: false
    });
  });

  test("automatic DCM, held references, technology switching, and chart pinning stay connected", async ({ page }) => {
    await page.goto(BUCK_LOSS_V2_ROUTE.replace(/i=2$/, "i=0.05"), { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const root = page.locator("#buck-loss-explorer");
    await expect(root).toHaveAttribute("data-blx-mode", "dcm");
    await expect(page.locator('[data-blx-out="regime"]')).toHaveText("DCM");
    await expect(page.locator("[data-blx-operating-metrics]")).toContainText("Zero-current window");
    await expect(page.locator("[data-blx-efficiency-label]")).toHaveText("known-loss ceiling");
    await expect(page.locator("[data-blx-input-label]")).toHaveText("input · floor");
    await expect(page.locator("[data-blx-power-copy]")).toHaveText("Output + known analytical losses");
    await expect(page.locator("[data-blx-operating-metrics]")).toContainText(/\d+ terms? omitted/);
    await expect(page.locator("[data-blx-subtotal-copy]")).toContainText("never counted as zero");

    const reference = page.locator('[data-blx-view-panel="point"] [data-blx-reference]');
    await reference.click();
    await expect(reference).toHaveText(/Clear reference/);
    await page.locator('[data-blx-v2-group="controller"] summary').click();
    await page.locator("[data-blx-control-mode]").selectOption("forced-ccm");
    await expect(root).toHaveAttribute("data-blx-mode", "ccm");
    await expect(page.locator("[data-blx-warnings]")).toContainText("Approximate commutation");
    await expect(page.locator("[data-blx-warnings]")).toContainText("ZVS, signed dead-time paths, QRR, turn-on overlap, and EOSS");
    await expect(page.locator("[data-blx-efficiency-label]")).toHaveText("efficiency");
    await expect(page.locator("[data-blx-reference-card]")).toContainText("GaN · DCM");
    await expect(page.locator("[data-blx-reference-card]")).toContainText("GaN · CCM");
    await expect(page.locator("[data-blx-reference-card]")).not.toContainText(/v[12](?:\.|\b)/i);
    await expect(page.locator("[data-blx-reference-card]")).toContainText("Efficiency deltas stay hidden while either run has omitted terms");

    await page.locator("[data-blx-change-device]").click();
    await page.locator('[data-blx-device-choice="silicon-30v"]').click();
    await expect(page.locator("[data-blx-device-label]")).toHaveText("Silicon · 30 V");
    await expect(root).toHaveAttribute("data-blx-technology", "silicon");
    await expect(page.locator('[data-blx-field="qrrRef"]')).not.toHaveAttribute("hidden", "");
    await expect(page).not.toHaveURL(/teon=/);

    await page.locator('[data-blx-view="load"]').click();
    await expect(page.locator(".blx-view-tabs")).toHaveAttribute("data-active-view", "load");
    await expect(page.locator("[data-blx-efficiency-plot] svg")).toBeVisible();
    await expect(page.locator("[data-blx-loss-plot] path[data-series]")).toHaveCount(3);
    await expect(page.locator(".blx-chart-boundary")).toHaveCount(2);
    await expect(page.locator(".blx-chart-peak")).toHaveCount(1);
    await expect(page.locator('[data-blx-chart-marker="efficiency"]')).toHaveCount(1);
    await expect(page.locator(".blx-chart-family-marker")).toHaveCount(3);
    await expect(page.locator(".blx-chart-reference-line")).toHaveCount(4);
    await expect(page.locator("[data-reference-series]")).toHaveCount(3);
    await expect(page.locator("[data-blx-reference-key]")).toContainText("Solid:");
    await expect(page.locator("[data-blx-reference-key]")).toContainText("Dashed:");
    await expect(page.locator("[data-blx-reference-key]")).toContainText("subtotal");
    const character = page.locator("[data-blx-loss-character]");
    await expect(character.locator("span[data-kind]")).not.toHaveCount(0);
    await expect(page.locator("[data-blx-causal-insight]")).toContainText(/terms lead at .* of known loss/);
    const firstSeries = page.getByRole("combobox", { name: "Loss series 1" });
    await firstSeries.selectOption("switchingTransitions");
    await expect(firstSeries).toHaveValue("switchingTransitions");
    await expect(page.locator("[data-blx-series-controls] button").first()).toHaveText("Pinned");
  });

  test("legacy imports preserve unsupported drive values and block until condition-valid", async ({ page }) => {
    await page.goto("/tools/buck-losses/?p=12v-to-3v3-pol&i=2&rhs=123&qhs=99&vf=2&qrr=200&vdrv=6", { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const root = page.locator("#buck-loss-explorer");
    await expect(root).toHaveAttribute("data-blx-legacy", "true");
    await expect(page.locator("[data-blx-legacy-banner]")).toContainText("Earlier shared calculation · Read-only");
    await expect(page.locator("#blx-num-vin")).toBeDisabled();
    await page.locator("[data-blx-import-v2]").click();
    await page.locator('[data-blx-device-choice="epc2090"]').click();
    await expect(page).toHaveURL(/m=2/);
    await expect(page).toHaveURL(/device=epc2090/);
    await expect(root).toHaveAttribute("data-blx-model", "2");
    await expect(page.locator("#blx-v2-vDrive")).toHaveValue("6");
    await expect(page.locator('[data-blx-v2-message="vDrive"]')).toContainText("outside this condition model's 3-5 V domain");
    await expect(page.locator("[data-blx-model-failure]")).toContainText("gate-drive condition is unsupported");
    await expect(root.locator('[data-blx-out="efficiency"]')).toHaveText("—");

    await page.locator('[data-blx-v2-group="drive"] > summary').click();
    await page.locator("#blx-v2-vDrive").fill("5");
    await page.locator("#blx-v2-vDrive").press("Tab");
    await expect(page.locator("[data-blx-import-delta]")).toContainText("This point was recalculated");
    await expect(page.locator("[data-blx-import-delta]")).toContainText("Efficiency delta");
    await expect(root.locator('[data-blx-out="efficiency"]')).not.toHaveText("—");
  });

  test("invalid and exact-zero inputs remain finite and explain unavailable efficiency", async ({ page }) => {
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.locator("#blx-v2-vin").fill("2");
    await page.locator("#blx-v2-vin").press("Tab");
    await expect(page.locator('[data-blx-v2-message="vout"]')).toBeVisible();
    await expect(page.locator('[data-blx-out="efficiency"]')).toHaveText("—");
    await expect(page.locator("[data-blx-model-failure]")).toBeVisible();
    await expect(page.locator("[data-blx-model-failure]")).toContainText("a buck converter can only step down");
    await expect(page.locator("[data-blx-fix-output]")).toBeVisible();

    await page.locator("#blx-v2-vin").fill("12");
    await page.locator("#blx-v2-vin").press("Tab");
    await page.locator("[data-blx-cursor-rail]").fill("0");
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-mode", "zero-load-unmodeled");
    await expect(page.locator('[data-blx-out="efficiency"]')).toHaveText("—");
    await expect(page.locator("[data-blx-warnings]")).toContainText("controller");
    expect(await page.locator(".blx-page").innerText()).not.toMatch(/\b(?:NaN|Infinity)\b/);
  });

  test("near-dropout and dead-time failures clear stale results and recover safely", async ({ page }) => {
    const runtimeIssues = observeRuntimeIssues(page);
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const root = page.locator("#buck-loss-explorer");
    await expect(root).toHaveAttribute("data-blx-mode", "ccm");
    await page.locator('[data-blx-view-panel="point"] [data-blx-reference]').click();
    await page.locator('[data-blx-view="load"]').click();
    await expect(page.locator("[data-blx-efficiency-plot] svg")).toBeVisible();
    await expect(page.locator("[data-blx-reference-key]")).toBeVisible();

    await page.locator("#blx-v2-vout").fill("11.95");
    await page.locator("#blx-v2-vout").press("Tab");
    await expect(root).toHaveAttribute("data-blx-mode", "infeasible");
    const failure = page.locator("[data-blx-model-failure]");
    await expect(failure).toBeVisible();
    await expect(failure).toContainText("negative low-side window");
    await expect(failure.locator("[data-blx-failure-equation]")).toContainText("DLS = -");
    await expect(page.locator("[data-blx-result-badges]")).not.toContainText(/model v[12]/i);
    await expect(page.locator("[data-blx-result-badges]")).toContainText("Out of regulation · low-side-window-negative");
    await expect(page.locator("[data-blx-result-badges]")).toContainText("No result");
    for (const output of ["efficiency", "pout", "loss", "pin"]) {
      await expect(page.locator(`[data-blx-out="${output}"]`)).toHaveText("—");
    }
    await expect(page.locator("[data-blx-family]")).toHaveCount(0);
    await expect(page.locator("[data-blx-waveform-diagram] svg")).toHaveCount(1);
    await expect(page.locator("[data-blx-waveform-diagram] svg")).toBeHidden();
    await expect(page.locator("[data-blx-waveform-overview] svg")).toBeHidden();
    await expect(page.locator(".blx-v2-power-track")).toHaveCount(0);
    await expect(page.locator("[data-blx-efficiency-plot] svg")).toHaveCount(0);
    await expect(page.locator("[data-blx-loss-plot] svg")).toHaveCount(0);
    await expect(page.locator("[data-blx-reference-card]")).toBeHidden();
    await expect(page.locator("[data-blx-reference-key]")).toBeHidden();
    await expect(page.locator('[data-blx-view="load"]')).toBeDisabled();
    await expect(page.locator("[data-blx-reference]").first()).toBeDisabled();
    expect(await page.evaluate(() => document.querySelector("#buck-loss-explorer").blxV2State.sweep)).toBeNull();
    expect(await page.locator(".blx-page").innerText()).not.toMatch(/\b(?:NaN|Infinity)\b/);

    await page.locator("#blx-v2-vout").fill("3.3");
    await page.locator("#blx-v2-vout").press("Tab");
    await expect(root).toHaveAttribute("data-blx-mode", "ccm");
    await expect(failure).toBeHidden();
    await expect(page.locator("[data-blx-family]")).toHaveCount(8);
    await expect(page.locator("[data-blx-waveform-diagram] svg")).not.toHaveAttribute("hidden", "");
    await expect(page.locator("[data-blx-waveform-overview] svg")).not.toHaveAttribute("hidden", "");
    await expect(page.locator(".blx-v2-power-track")).toHaveCount(1);
    await expect(page.locator('[data-blx-view="load"]')).toBeEnabled();

    await page.locator('[data-blx-v2-group="timing"] summary').click();
    await page.locator("#blx-v2-deadTime").fill("500");
    await page.locator("#blx-v2-deadTime").press("Tab");
    await expect(root).toHaveAttribute("data-blx-mode", "infeasible");
    await expect(failure).toContainText("Dead time consumes the switching period");
    await expect(failure.locator("[data-blx-failure-equation]")).toContainText("(tDEAD,HS→LS + tDEAD,LS→HS) / TSW = 1");
    await expect(page.locator("[data-blx-family]")).toHaveCount(0);

    await page.locator("#blx-v2-deadTime").fill("2");
    await page.locator("#blx-v2-deadTime").press("Tab");
    await expect(root).toHaveAttribute("data-blx-mode", "ccm");
    await expect(failure).toBeHidden();
    await expect(page.locator("[data-blx-family]")).toHaveCount(8);
    expect(runtimeIssues).toEqual([]);
  });

  test("chart sliders preview without URL mutation, commit quantized current, and reuse the sweep", async ({ page }) => {
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await page.locator('[data-blx-view="load"]').click();
    const efficiencyPlot = page.locator("[data-blx-efficiency-plot]");
    const lossPlot = page.locator("[data-blx-loss-plot]");
    for (const plot of [efficiencyPlot, lossPlot]) {
      await expect(plot).toHaveAttribute("role", "slider");
      await expect(plot).toHaveAttribute("tabindex", "0");
      await expect(plot).toHaveAttribute("aria-valuemin", "0");
      await expect(plot).toHaveAttribute("aria-valuemax", "3");
      await expect(plot).toHaveAttribute("aria-valuetext", /A; /);
    }
    await page.evaluate(() => {
      window.__buckSweep = document.querySelector("#buck-loss-explorer").blxV2State.sweep;
    });
    const initialUrl = page.url();
    const initialCurrent = await page.locator('[data-blx-out="current"]').textContent();
    const initialChartReadout = await page.locator('[data-blx-efficiency-plot] [data-blx-chart-cursor-label]').textContent();
    await efficiencyPlot.scrollIntoViewIfNeeded();
    const box = await efficiencyPlot.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box.x + box.width * 0.32, box.y + box.height * 0.55);
    await expect.poll(() => page.evaluate(() => document.querySelector("#buck-loss-explorer").blxV2State.previewCursor)).not.toBeNull();
    const previewCurrent = await page.evaluate(() => document.querySelector("#buck-loss-explorer").blxV2State.previewCursor);
    expect(previewCurrent).toBe(Number(previewCurrent.toPrecision(3)));
    await expect(page.locator('[data-blx-out="current"]')).toHaveText(initialCurrent || "");
    await expect.poll(() => page.locator('[data-blx-efficiency-plot] [data-blx-chart-cursor-label]').textContent()).not.toBe(initialChartReadout);
    await page.waitForTimeout(320);
    expect(page.url()).toBe(initialUrl);
    expect(await page.evaluate(() => document.querySelector("#buck-loss-explorer").blxV2State.sweep === window.__buckSweep)).toBe(true);
    await expect(efficiencyPlot.locator("svg")).toBeVisible();
    await expect(lossPlot.locator("svg")).toBeVisible();

    await page.mouse.move(1, 1);
    await expect.poll(() => page.evaluate(() => document.querySelector("#buck-loss-explorer").blxV2State.previewCursor)).toBeNull();
    await expect(page.locator('[data-blx-out="current"]')).toHaveText(initialCurrent || "");
    expect(page.url()).toBe(initialUrl);

    await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.55);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.57, box.y + box.height * 0.55, { steps: 3 });
    await page.mouse.up();
    await expect.poll(() => page.url()).not.toBe(initialUrl);
    const committed = await page.evaluate(() => ({
      cursor: document.querySelector("#buck-loss-explorer").blxV2State.cursor,
      preview: document.querySelector("#buck-loss-explorer").blxV2State.previewCursor
    }));
    const committedText = new URL(page.url()).searchParams.get("i");
    expect(Number(committedText)).toBe(committed.cursor);
    expect(committed.preview).toBeNull();
    const significantDigits = committedText.replace(/^[+-]?0*\.?0*/, "").replace(/[^0-9]/g, "").length;
    expect(significantDigits).toBeLessThanOrEqual(3);
    expect(await page.evaluate(() => document.querySelector("#buck-loss-explorer").blxV2State.sweep === window.__buckSweep)).toBe(true);

    const rail = page.locator("[data-blx-cursor-rail]");
    await rail.fill("667");
    await expect(rail).toHaveAttribute("aria-valuenow", "2");
    await expect.poll(() => new URL(page.url()).searchParams.get("i")).toBe("2");
    expect(await page.evaluate(() => document.querySelector("#buck-loss-explorer").blxV2State.sweep === window.__buckSweep)).toBe(true);

    await efficiencyPlot.focus();
    await page.keyboard.press("Home");
    await expect(efficiencyPlot).toHaveAttribute("aria-valuenow", "0");
    await expect.poll(() => new URL(page.url()).searchParams.get("i")).toBe("0");
    await page.keyboard.press("ArrowRight");
    await expect(efficiencyPlot).toHaveAttribute("aria-valuenow", "0.01");
    await expect.poll(() => new URL(page.url()).searchParams.get("i")).toBe("0.01");
    await page.keyboard.press("End");
    await expect(efficiencyPlot).toHaveAttribute("aria-valuenow", "3");
    await expect.poll(() => new URL(page.url()).searchParams.get("i")).toBe("3");
    expect(await page.evaluate(() => document.querySelector("#buck-loss-explorer").blxV2State.sweep === window.__buckSweep)).toBe(true);

    await page.locator('[data-blx-view="point"]').click();
    await page.locator('[data-blx-view="load"]').click();
    await expect(page.locator("[data-blx-loss-character] span[data-kind]")).not.toHaveCount(0);
    await expect(page.locator("[data-blx-causal-insight]")).toContainText(/At .* terms lead at .* of known loss/);
  });

  test("desktop and mobile layouts, focus, charts, and reduced motion satisfy their contracts", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-status", "ready");
    await expect(page.locator("[data-blx-family]")).toHaveCount(8);
    const powerGeometry = await page.locator("[data-blx-power-balance]").evaluate((holder) => {
      const track = holder.querySelector(".blx-v2-power-track");
      return { holder: holder.getBoundingClientRect().width, track: track?.getBoundingClientRect().width || 0 };
    });
    expect(powerGeometry.track).toBeGreaterThanOrEqual(powerGeometry.holder - 1);
    const vinInput = page.locator("#blx-v2-vin");
    await vinInput.click();
    await expect(vinInput).toBeFocused();
    const inputFocus = await vinInput.evaluate((input) => {
      const style = getComputedStyle(input);
      return { outlineStyle: style.outlineStyle, outlineWidth: Number.parseFloat(style.outlineWidth) || 0, boxShadow: style.boxShadow };
    });
    expect(inputFocus.outlineStyle).not.toBe("none");
    expect(inputFocus.outlineWidth).toBeGreaterThanOrEqual(1);
    expect(inputFocus.boxShadow).not.toBe("none");

    const transitionSummary = page.locator('[data-blx-family="switchingTransitions"] summary');
    await transitionSummary.click();
    await transitionSummary.focus();
    const orderBefore = await page.locator("[data-blx-family]").evaluateAll((rows) => rows.map((row) => row.dataset.blxFamily));
    await page.evaluate(() => {
      window.__focusedFamilyRow = document.querySelector('[data-blx-family="switchingTransitions"]');
      window.__familyAnimationCalls = 0;
      const originalAnimate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        if (this.matches?.("[data-blx-family]")) window.__familyAnimationCalls += 1;
        return originalAnimate.apply(this, args);
      };
      const rail = document.querySelector("[data-blx-cursor-rail]");
      rail.value = "17";
      rail.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(page.locator("#buck-loss-explorer")).toHaveAttribute("data-blx-mode", "dcm");
    const orderAfter = await page.locator("[data-blx-family]").evaluateAll((rows) => rows.map((row) => row.dataset.blxFamily));
    expect(orderAfter).not.toEqual(orderBefore);
    await expect(transitionSummary).toBeFocused();
    await expect(page.locator('[data-blx-family="switchingTransitions"] details')).toHaveAttribute("open", "");
    expect(await page.evaluate(() => document.querySelector('[data-blx-family="switchingTransitions"]') === window.__focusedFamilyRow)).toBe(true);
    expect(await page.evaluate(() => window.__familyAnimationCalls)).toBe(0);
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
    const mobileStack = await page.evaluate(() => {
      const actions = document.querySelector('[data-blx-view-panel="load"] .blx-actions').getBoundingClientRect();
      const equations = document.querySelector('.blx-equations').getBoundingClientRect();
      return { actionsBottom: actions.bottom, equationsTop: equations.top };
    });
    expect(mobileStack.actionsBottom).toBeLessThanOrEqual(mobileStack.equationsTop + 1);
    overflow = await pageOverflow(page);
    expect(overflow.scrollWidth, JSON.stringify(overflow.offenders)).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.offenders, "mobile content must not clip past either viewport edge").toEqual([]);
  });
});
