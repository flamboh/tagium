import { defineConfig, devices } from "@playwright/test";
import process from "node:process";
import { E2E_BASE_URL, E2E_CONTROL_URL } from "./tests/e2e/harness/protocol.ts";
import { EXPECT_TIMEOUT, TEST_TIMEOUT } from "./tests/e2e/support/test.ts";

const browsers = [
  { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  { name: "webkit", use: { ...devices["Desktop Safari"] } },
];

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: TEST_TIMEOUT,
  expect: { timeout: EXPECT_TIMEOUT },
  use: {
    baseURL: E2E_BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: process.env.E2E_BROWSERS === "all" ? browsers : browsers.slice(0, 1),
  webServer: {
    command: "node tests/e2e/harness/server.ts",
    url: `${E2E_CONTROL_URL}/health`,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: "pipe",
    gracefulShutdown: { signal: "SIGTERM", timeout: 5_000 },
  },
});
