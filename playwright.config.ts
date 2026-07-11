import { defineConfig, devices } from "@playwright/test";

// This suite is the automated backbone behind the Product Agent /
// Fullstack Engineer loop (CLAUDE.md's Executive Charter) - it never runs
// against production. PLAYWRIGHT_TEST_URL must point at local dev or a
// Preview deployment on Duffel sandbox / Stripe test-mode credentials,
// same hard constraint product-agent.md's live browser walkthrough
// follows. Defaults to localhost so `npx playwright test` works out of the
// box against `npm run dev`.
const baseURL = process.env.PLAYWRIGHT_TEST_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 30_000,
  use: {
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
