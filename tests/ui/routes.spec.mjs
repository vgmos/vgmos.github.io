import { test, expect } from "./fixtures.mjs";
import {
  AUDIT_ROUTES,
  BUCK_LOSS_V2_ROUTE,
  HTML_ROUTES,
  SITE_URL,
  TARGET_VIEWPORTS,
  htmlRoutesFromSitemap,
  normalizePath,
  observeRuntimeIssues,
  pageOverflow,
  settlePage
} from "./site.mjs";

test.describe("route inventory and smoke coverage", () => {
  test("the sitemap retains every expected HTML route", async ({ request }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.ok()).toBeTruthy();

    const sitemapRoutes = htmlRoutesFromSitemap(await response.text());
    expect(sitemapRoutes).toEqual([...HTML_ROUTES].sort());
  });

  test("the Loss Explorer module graph is cache-versioned", async ({ page, request }) => {
    await page.goto(BUCK_LOSS_V2_ROUTE, { waitUntil: "domcontentloaded" });
    await settlePage(page);

    const moduleSource = await page.locator('script[type="module"]').evaluateAll((scripts) => scripts
      .map((script) => script.textContent || "")
      .find((source) => source.includes("buck-loss-ui.js")) || "");
    const entryMatch = moduleSource.match(/\/js\/tools\/buck-loss-ui\.js\?v=\d{14}/);
    expect(entryMatch, "the HTML entry module must change URL on every build").not.toBeNull();

    const response = await request.get(entryMatch[0]);
    expect(response.ok()).toBeTruthy();
    const entrySource = await response.text();
    expect(entrySource).toContain('searchParams.get("v")');
    expect(entrySource).toContain("versionedModuleUrl");
  });

  for (const route of AUDIT_ROUTES) {
    test(`${route} renders meaningful, healthy content`, async ({ page }) => {
      const issues = observeRuntimeIssues(page);
      const response = await page.goto(route, { waitUntil: "domcontentloaded" });
      expect(response, "navigation should produce an HTTP response").not.toBeNull();
      const status = response?.status() || 0;
      if (route === "/404.html") {
        expect([200, 404]).toContain(status);
      } else {
        expect(status).toBeGreaterThanOrEqual(200);
        expect(status).toBeLessThan(400);
      }

      await settlePage(page);
      await page.waitForLoadState("load");

      await expect(page).toHaveTitle(/\S+/);
      await expect(page.locator("body > main.page-content")).toBeVisible();
      await expect(page.locator("body > main.page-content h1")).toHaveCount(1);
      await expect(page.locator("body > main.page-content h1")).toBeVisible();

      const canonical = await page.locator('link[rel="canonical"]').getAttribute("href");
      expect(canonical, "each route should publish a canonical URL").toBeTruthy();
      expect(normalizePath(canonical)).toBe(normalizePath(route));

      const images = page.locator("img");
      for (let index = 0; index < await images.count(); index += 1) {
        await images.nth(index).scrollIntoViewIfNeeded();
      }
      await expect.poll(() => images.evaluateAll((nodes) => nodes
        .filter((image) => !image.complete || image.naturalWidth === 0)
        .map((image) => image.currentSrc || image.getAttribute("src") || "unnamed image")), {
        message: "all images should load after each lazy image is revealed"
      }).toEqual([]);

      const missingSamePageAnchors = await page.locator('a[href*="#"]').evaluateAll((links) => links.flatMap((link) => {
        const target = new URL(link.href, window.location.href);
        if (!target.hash || target.origin !== window.location.origin || target.pathname !== window.location.pathname) return [];
        let id = "";
        try {
          id = decodeURIComponent(target.hash.slice(1));
        } catch {
          id = target.hash.slice(1);
        }
        return document.getElementById(id) ? [] : [link.getAttribute("href")];
      }));
      expect(missingSamePageAnchors, "same-page anchors should resolve to an element id").toEqual([]);

      const overflow = await pageOverflow(page);
      expect(
        overflow.scrollWidth,
        `page overflowed by ${overflow.scrollWidth - overflow.clientWidth}px: ${JSON.stringify(overflow.offenders)}`
      ).toBeLessThanOrEqual(overflow.clientWidth + 1);
      expect(issues, "the page should not emit console, script, or network errors").toEqual([]);
    });
  }

  test("all internal links and cross-page anchors resolve", async ({ page, request }) => {
    test.setTimeout(120_000);
    const internalURLs = new Set();
    const anchorTargets = new Map();

    for (const route of AUDIT_ROUTES) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await settlePage(page);
      const links = await page.locator("a[href]").evaluateAll((nodes) => nodes.map((node) => node.href));
      for (const href of links) {
        const url = new URL(href, SITE_URL);
        if (url.origin !== new URL(SITE_URL).origin) continue;
        url.hash = "";
        internalURLs.add(url.href);

        const source = new URL(href, SITE_URL);
        if (!source.hash) continue;
        const key = `${source.pathname}${source.search}`;
        if (!anchorTargets.has(key)) anchorTargets.set(key, new Set());
        anchorTargets.get(key).add(decodeURIComponent(source.hash.slice(1)));
      }
    }

    for (const href of internalURLs) {
      const response = await request.get(href, { failOnStatusCode: false });
      expect.soft(response.status(), `${href} should resolve`).toBeLessThan(400);
    }

    for (const [route, ids] of anchorTargets) {
      await page.goto(route, { waitUntil: "domcontentloaded" });
      await settlePage(page);
      for (const id of ids) {
        const exists = await page.evaluate((targetId) => Boolean(document.getElementById(targetId)), id);
        expect.soft(exists, `${route}#${id} should exist`).toBe(true);
      }
    }
  });
});

test.describe("responsive reflow", () => {
  for (const viewport of TARGET_VIEWPORTS) {
    test(`all routes avoid page-level overflow at ${viewport.name} (${viewport.width}x${viewport.height})`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });

      for (const route of AUDIT_ROUTES) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await settlePage(page);
        const overflow = await pageOverflow(page);
        expect.soft(
          overflow.scrollWidth,
          `${route} overflowed ${viewport.name} by ${overflow.scrollWidth - overflow.clientWidth}px: ${JSON.stringify(overflow.offenders)}`
        ).toBeLessThanOrEqual(overflow.clientWidth + 1);
      }
    });
  }
});

test("live external links do not return a confirmed broken status", async ({ page, request }, testInfo) => {
  test.skip(process.env.PLAYWRIGHT_LIVE !== "1", "External checks run only in the scheduled/manual live audit.");
  test.setTimeout(120_000);

  const externalURLs = new Set();
  const allowlistedHosts = new Set(
    (process.env.PLAYWRIGHT_EXTERNAL_LINK_ALLOWLIST || "linkedin.com,scholar.google.com")
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
  for (const route of HTML_ROUTES) {
    await page.goto(route, { waitUntil: "domcontentloaded" });
    await settlePage(page);
    const links = await page.locator("a[href]").evaluateAll((nodes) => nodes.map((node) => node.href));
    for (const href of links) {
      const url = new URL(href, SITE_URL);
      if (["http:", "https:"].includes(url.protocol) && url.origin !== new URL(SITE_URL).origin) {
        url.hash = "";
        externalURLs.add(url.href);
      }
    }
  }

  const results = [];
  for (const href of externalURLs) {
    const hostname = new URL(href).hostname.toLowerCase();
    const allowlisted = [...allowlistedHosts].some((host) => hostname === host || hostname.endsWith(`.${host}`));
    let status = 0;
    let error = "";
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await request.get(href, { failOnStatusCode: false, timeout: 15_000 });
        status = response.status();
        error = "";
        if (status < 500 && status !== 429) break;
      } catch (requestError) {
        error = requestError.message;
      }
    }
    results.push({ href, status, error, allowlisted });
    if (allowlisted) continue;
    const confirmedBroken = [404, 410].includes(status) || status >= 500;
    expect.soft(confirmedBroken, `${href} returned a confirmed broken status (${status})`).toBe(false);
  }

  await testInfo.attach("external-link-report", {
    body: Buffer.from(JSON.stringify(results, null, 2)),
    contentType: "application/json"
  });
});
