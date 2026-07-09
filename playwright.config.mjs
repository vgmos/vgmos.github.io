import os from "node:os";
import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

const defaultSiteURL = "http://127.0.0.1:4000";
const siteURL = process.env.SITE_URL || defaultSiteURL;
const usesManagedLocalServer = !process.env.SITE_URL;
const artifactRoot = process.env.PLAYWRIGHT_ARTIFACT_DIR || path.join(os.tmpdir(), "vgmos-playwright");

export default defineConfig({
  testDir: "./tests/ui",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  timeout: 45_000,
  expect: {
    timeout: 8_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      maxDiffPixelRatio: 0.01
    }
  },
  outputDir: path.join(artifactRoot, "test-results"),
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}{ext}",
  reporter: [
    ["list"],
    ["html", { open: "never", outputFolder: path.join(artifactRoot, "html-report") }]
  ],
  metadata: {
    auditDate: new Date().toISOString(),
    liveCommit: process.env.LIVE_COMMIT || process.env.GITHUB_SHA || "unknown",
    siteURL
  },
  use: {
    baseURL: siteURL,
    locale: "en-US",
    colorScheme: "light",
    reducedMotion: "no-preference",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure"
  },
  webServer: usesManagedLocalServer
    ? {
        command: "bundle exec jekyll serve --host 127.0.0.1 --port 4000",
        url: defaultSiteURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
      }
    : undefined,
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    },
    {
      name: "webkit",
      testMatch: /.*\.critical\.spec\.mjs/,
      use: { ...devices["Desktop Safari"] }
    }
  ]
});
