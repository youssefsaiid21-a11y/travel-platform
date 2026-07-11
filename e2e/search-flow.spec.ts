import { test, expect } from "@playwright/test";

// Real smoke-level coverage of the core search -> checkpoint-confirm ->
// offers flow (src/app/page.tsx) - the automated regression backbone
// behind the Product Agent's human-perspective walkthrough. Deliberately
// scoped to "does the flow work at all," not exhaustive UX coverage -
// that judgment call stays with the Product Agent's live browser
// walkthrough, not this suite. Runs against Duffel sandbox (see
// playwright.config.ts) so results are synthetic, not real inventory.

test("homepage loads with a working search input", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "Flight search" })).toBeVisible();
});

test("submitting a query reaches either a checkpoint confirm or results", async ({ page }) => {
  await page.goto("/");

  const input = page.getByRole("textbox", { name: "Flight search" });
  await input.fill("London to New York next Friday");
  await input.press("Enter");

  // The app gates the real Duffel search behind an explicit
  // "Here's what I understood" checkpoint (see page.tsx's Message.checkpoint) -
  // confirm it if present so this test exercises the full flow, not just
  // the parse step. `.click()` auto-waits for the button to appear, unlike
  // `.isVisible()` which checks the current DOM synchronously and would
  // race ahead of the checkpoint actually rendering.
  await page
    .getByRole("button", { name: "Confirm search" })
    .click({ timeout: 15_000 })
    .catch(() => {
      // No checkpoint this time (e.g. already-confident parse) - proceed
      // straight to whatever the app shows next.
    });

  // Either real offers render or the app surfaces a graceful "no flights"
  // state - both are a working flow. What this test guards against is the
  // third case: nothing happens, or a client-side error boundary. Currency
  // isn't fixed (Duffel sandbox has returned EUR in practice), so match
  // the "Found N flights" summary rather than a specific symbol.
  const offersOrNoResults = page.getByText(/no flights match|found \d+ flights?/i).first();
  await expect(offersOrNoResults).toBeVisible({ timeout: 30_000 });
});
