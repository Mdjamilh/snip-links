import { defineConfig, devices } from "@playwright/test";

const PORT = 47180; // uncommon, so an unrelated local server is never reused by mistake

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["html", { open: "never" }]] : "list",
  use: { baseURL: `http://localhost:${PORT}`, trace: "retain-on-failure" },
  projects: [
    { name: "with-js", use: { ...devices["Desktop Chrome"] } },
    // The same flows with JavaScript off: plain HTML forms must still work.
    { name: "no-js", use: { ...devices["Desktop Chrome"], javaScriptEnabled: false } },
  ],
  webServer: {
    command: "node --import tsx src/node-server.ts",
    env: { PORT: String(PORT) },
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: !process.env.CI,
  },
});
