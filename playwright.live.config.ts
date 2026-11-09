import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/live",
  workers: 1, // Both viewports share the same disposable Compose database.
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: 0,
  timeout: 60000,
  use: { baseURL: "http://127.0.0.1:8081/", trace: "retain-on-failure" },
  projects: [
    {
      name: "compose-desktop",
      use: { viewport: { width: 1440, height: 900 } },
    },
    { name: "compose-mobile", use: { viewport: { width: 390, height: 844 } } },
  ],
});
