import { test, expect } from "./fixtures.mjs";
import { settlePage } from "./site.mjs";

async function installLifecycleInstrumentation(page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("buck-loss-v2-device", "epc2090");
    const nativeRequestAnimationFrame = window.requestAnimationFrame.bind(window);
    const nativeCancelAnimationFrame = window.cancelAnimationFrame.bind(window);
    const activeAnimationFrames = new Set();

    window.requestAnimationFrame = (callback) => {
      let id = 0;
      id = nativeRequestAnimationFrame((timestamp) => {
        activeAnimationFrames.delete(id);
        callback(timestamp);
      });
      activeAnimationFrames.add(id);
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      activeAnimationFrames.delete(id);
      return nativeCancelAnimationFrame(id);
    };

    const nativeAddEventListener = EventTarget.prototype.addEventListener;
    const nativeRemoveEventListener = EventTarget.prototype.removeEventListener;
    const listenerIds = new WeakMap();
    const registrations = new Map();
    let nextListenerId = 1;
    const trackedTypes = new Set(["pointerdown", "popstate", "resize"]);

    function targetName(target) {
      if (target === window) return "window";
      if (target === document) return "document";
      return null;
    }

    function captureValue(options) {
      return typeof options === "boolean" ? options : Boolean(options?.capture);
    }

    function registration(target, type, listener, options) {
      const name = targetName(target);
      if (!name || !trackedTypes.has(type) || (typeof listener !== "function" && typeof listener !== "object") || !listener) {
        return null;
      }
      if (!listenerIds.has(listener)) listenerIds.set(listener, nextListenerId++);
      return `${name}:${type}:${captureValue(options)}:${listenerIds.get(listener)}`;
    }

    EventTarget.prototype.addEventListener = function addEventListener(type, listener, options) {
      const result = nativeAddEventListener.call(this, type, listener, options);
      const key = registration(this, type, listener, options);
      if (key && !options?.signal?.aborted) {
        registrations.set(key, key.split(":").slice(0, 3).join(":"));
        if (options && typeof options === "object" && options.signal) {
          nativeAddEventListener.call(options.signal, "abort", () => registrations.delete(key), { once: true });
        }
      }
      return result;
    };

    EventTarget.prototype.removeEventListener = function removeEventListener(type, listener, options) {
      const key = registration(this, type, listener, options);
      if (key) registrations.delete(key);
      return nativeRemoveEventListener.call(this, type, listener, options);
    };

    window.__vgmosLifecycleAudit = {
      snapshot() {
        const listeners = {};
        for (const label of registrations.values()) listeners[label] = (listeners[label] || 0) + 1;
        return {
          activeAnimationFrames: activeAnimationFrames.size,
          listeners: Object.fromEntries(Object.entries(listeners).sort(([a], [b]) => a.localeCompare(b)))
        };
      }
    };
  });
}

async function waitForSoftNavigation(page, expectedPath) {
  await expect(page).toHaveURL((url) => url.pathname === expectedPath);
  await settlePage(page);
  await page.waitForTimeout(380);
}

async function roundTrip(page, linkName, expectedPath) {
  await page.getByRole("link", { name: linkName, exact: true }).click();
  await waitForSoftNavigation(page, expectedPath);
  await page.locator(".site-title").click();
  await waitForSoftNavigation(page, "/");
}

async function collectGarbageAndMeasure(session) {
  await session.send("HeapProfiler.collectGarbage");
  return session.send("Runtime.getHeapUsage");
}

test("repeated navigation tears down tool animation and global listeners", async ({ page, context }, testInfo) => {
  test.setTimeout(180_000);
  await installLifecycleInstrumentation(page);
  await page.goto("/", { waitUntil: "domcontentloaded" });
  await settlePage(page);
  await page.waitForTimeout(500);

  // Warm both code paths so cached documents, modules, and one-time allocations are
  // represented in the baseline before leak detection begins.
  await roundTrip(page, "Buck Converter Tool", "/tools/buck-converter/");
  await roundTrip(page, "Buck Converter Loss Explorer", "/tools/buck-losses/");

  const cdp = await context.newCDPSession(page);
  await cdp.send("HeapProfiler.enable");
  const heapBefore = await collectGarbageAndMeasure(cdp);
  const baseline = await page.evaluate(() => window.__vgmosLifecycleAudit.snapshot());

  for (let iteration = 0; iteration < 10; iteration += 1) {
    await roundTrip(page, "Buck Converter Tool", "/tools/buck-converter/");
  }
  for (let iteration = 0; iteration < 10; iteration += 1) {
    await roundTrip(page, "Buck Converter Loss Explorer", "/tools/buck-losses/");
  }

  await page.waitForTimeout(750);
  const final = await page.evaluate(() => window.__vgmosLifecycleAudit.snapshot());
  const heapAfter = await collectGarbageAndMeasure(cdp);
  const heapAllowance = Math.max(1_500_000, heapBefore.usedSize * 0.2);

  await testInfo.attach("lifecycle-snapshots", {
    body: Buffer.from(JSON.stringify({ baseline, final, heapBefore, heapAfter, heapAllowance }, null, 2)),
    contentType: "application/json"
  });

  expect(final.listeners, "window/document listener registrations should return to the warm baseline").toEqual(baseline.listeners);
  expect(
    final.activeAnimationFrames,
    "the detached converter must leave no animation frame running on the home page"
  ).toBeLessThanOrEqual(baseline.activeAnimationFrames);
  expect(
    heapAfter.usedSize - heapBefore.usedSize,
    `retained heap grew from ${heapBefore.usedSize} to ${heapAfter.usedSize} bytes`
  ).toBeLessThanOrEqual(heapAllowance);
});
