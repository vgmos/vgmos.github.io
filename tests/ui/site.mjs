export const SITE_URL = process.env.SITE_URL || "http://127.0.0.1:4000";
export const LIVE_COMMIT = process.env.LIVE_COMMIT || process.env.GITHUB_SHA || "unknown";
export const BUCK_LOSS_V2_ROUTE = "/tools/buck-losses/?m=2&p=12v-to-3v3-pol&device=epc2090&i=2";

export const HTML_ROUTES = [
  "/",
  "/2026/06/12/a-working-notebook.html",
  "/about/",
  "/projects/bits-ceeri-image-processing/",
  "/projects/bits-gmid-op-amp/",
  "/projects/georgia-tech-led-driver-dimming/",
  "/projects/georgia-tech-noise-shaping-sar-adc/",
  "/projects/technion-y-flash/",
  "/tools/buck-converter/",
  "/tools/buck-losses/",
  "/writing/",
  "/writing/index/"
];

export const AUDIT_ROUTES = [
  ...HTML_ROUTES.filter((route) => route !== "/tools/buck-losses/"),
  BUCK_LOSS_V2_ROUTE,
  "/404.html"
];

export const CRITICAL_VISUAL_ROUTES = [
  { name: "home", path: "/" },
  { name: "buck-converter", path: "/tools/buck-converter/" },
  { name: "buck-losses", path: BUCK_LOSS_V2_ROUTE },
  { name: "sar-project", path: "/projects/georgia-tech-noise-shaping-sar-adc/" },
  { name: "notebook-post", path: "/2026/06/12/a-working-notebook.html" },
  { name: "not-found", path: "/404.html" }
];

export const TARGET_VIEWPORTS = [
  { name: "desktop-wide", width: 1440, height: 900 },
  { name: "desktop", width: 1366, height: 768 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "mobile", width: 390, height: 844 },
  { name: "mobile-narrow", width: 320, height: 568 },
  { name: "mobile-landscape", width: 844, height: 390 },
  { name: "zoom-200-percent", width: 640, height: 450 }
];

export function normalizePath(value) {
  const url = new URL(value, SITE_URL);
  return url.pathname.replace(/\/index\.html$/, "/");
}

export function htmlRoutesFromSitemap(xml) {
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((match) => normalizePath(match[1]))
    .filter((route) => route.endsWith("/") || route.endsWith(".html"))
    .sort();
}

export async function settlePage(page) {
  await page.locator("body > main.page-content").waitFor({ state: "visible" });
  const lossExplorer = page.locator("#buck-loss-explorer");
  if (await lossExplorer.count()) {
    await lossExplorer.waitFor({ state: "visible" });
    await page.waitForFunction(() => document.querySelector("#buck-loss-explorer")?.dataset.blxStatus === "ready");
    await page.waitForFunction(() => {
      const state = document.querySelector("[data-blx-catalog]")?.dataset.catalogState;
      return !state || state === "ready" || state === "error";
    });
  }
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

export async function settleVisualPage(page) {
  await settlePage(page);
  const images = page.locator("img");
  for (let index = 0; index < await images.count(); index += 1) {
    await images.nth(index).scrollIntoViewIfNeeded();
  }
  await page.waitForFunction(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0));
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((image) => image.decode?.().catch(() => {})));
    window.scrollTo(0, 0);
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

export function observeRuntimeIssues(page) {
  const issues = [];
  page.on("console", (message) => {
    if (message.type() === "error") issues.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => issues.push(`pageerror: ${error.message}`));
  page.on("requestfailed", (request) => {
    const failure = request.failure()?.errorText || "unknown failure";
    if (failure.includes("ERR_ABORTED") || failure.includes("NS_BINDING_ABORTED")) return;
    issues.push(`requestfailed: ${request.method()} ${request.url()} (${failure})`);
  });
  return issues;
}

export async function setStoredTheme(page, theme) {
  await page.addInitScript((nextTheme) => {
    window.localStorage.setItem("vgmos-theme", nextTheme);
  }, theme);
  await page.emulateMedia({ colorScheme: theme });
}

export async function pageOverflow(page) {
  return page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    offenders: [...document.querySelectorAll("body *")]
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.right > document.documentElement.clientWidth + 1 || rect.left < -1;
      })
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        className: typeof element.className === "string" ? element.className : "",
        rect: element.getBoundingClientRect().toJSON()
      }))
  }));
}
