import { defineConfig, devices } from "@playwright/test";

// Regression suite (docs: Assembly regression test plan). Runs against the local dev server on a reset database.
//   npm run test:e2e
export default defineConfig({
  testDir: "e2e",
  timeout: 45_000,
  expect: { timeout: 8_000 },
  // Tests share one database; most write to it, so they run one file at a time.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    // On GitHub, each failure shows on the run page as it happens.
    ...(process.env.CI ? [["github"] as ["github"]] : []),
    ["json", { outputFile: "e2e-results/results.json" }],
    ["html", { outputFolder: "e2e-results/html", open: "never" }],
  ],
  outputDir: "e2e-results/artifacts",
  globalSetup: "./e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    timezoneId: "America/Chicago",
    locale: "en-US",
  },
  projects: [
    { name: "phone", use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 } }, grep: /@desktop/ },
  ],
  webServer: {
    // E2E_BUILT runs the production build (service worker, headers) instead of the dev server.
    command: process.env.E2E_BUILT ? "npm run build && E2E=1 npx vite preview --port 5174 --strictPort" : "E2E=1 npx vite --port 5174 --strictPort",
    url: "http://localhost:5174/api/health",
    // A fresh server each run, on its own database (scripts/e2e-reset.mjs), never your dev server.
    reuseExistingServer: false,
    timeout: 300_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
