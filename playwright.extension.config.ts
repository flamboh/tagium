import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/extension",
  workers: 1,
  timeout: 60_000,
  use: { baseURL: "http://localhost:5173" },
  webServer: {
    command: "bun run dev --host 127.0.0.1 --port 5173 --strictPort",
    url: "http://localhost:5173",
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
