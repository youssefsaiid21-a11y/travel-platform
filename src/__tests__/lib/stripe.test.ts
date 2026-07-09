import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// getStripe() caches a module-level singleton, so each test needs a fresh
// module instance (vi.resetModules) to observe a different env var value.
describe("getStripe", () => {
  const originalKey = process.env.STRIPE_SECRET_KEY;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.STRIPE_SECRET_KEY = originalKey;
  });

  it("throws when STRIPE_SECRET_KEY is not set", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const { getStripe } = await import("@/lib/stripe");
    expect(() => getStripe()).toThrow(/STRIPE_SECRET_KEY is not set/);
  });

  it("throws when the key is not a test-mode key (blocks live keys)", async () => {
    // Deliberately NOT shaped like "sk_live_..." - GitHub's push protection
    // flags that pattern as a real Stripe secret even in an obvious test
    // fixture. Any non-"sk_test_"-prefixed value exercises the same guard.
    process.env.STRIPE_SECRET_KEY = "not-a-test-mode-key";
    const { getStripe } = await import("@/lib/stripe");
    expect(() => getStripe()).toThrow(/must be a test-mode key/);
  });

  it("constructs successfully with a valid sk_test_ key", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_validkeyforunittests";
    const { getStripe } = await import("@/lib/stripe");
    expect(() => getStripe()).not.toThrow();
  });
});
