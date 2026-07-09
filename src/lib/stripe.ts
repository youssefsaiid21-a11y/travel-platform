import Stripe from "stripe";

// Lazily constructed so a missing STRIPE_SECRET_KEY only breaks the specific
// request that needs Stripe, not the whole build/server startup - the SDK
// throws immediately on construction if the key is empty, and Next.js
// evaluates route modules at build time to collect page data, which used to
// crash the entire deploy over an unconfigured (optional at this stage) key.
let stripeClient: Stripe | null = null;

export function getStripe(): Stripe {
  if (!stripeClient) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) {
      throw new Error("STRIPE_SECRET_KEY is not set.");
    }
    // Mirrors the same guardrail already enforced on the Duffel client
    // (src/lib/duffel/client.ts) - CLAUDE.md guardrail #1 bans live/
    // production payment endpoints, but until now nothing in code actually
    // stopped a live sk_live_ key from being used the moment it was set.
    if (!key.startsWith("sk_test_")) {
      throw new Error(
        "STRIPE_SECRET_KEY must be a test-mode key (starts with sk_test_). " +
          "Live keys are not permitted in this application. See CLAUDE.md guardrail #1."
      );
    }
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}
