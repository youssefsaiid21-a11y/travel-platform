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
    stripeClient = new Stripe(key);
  }
  return stripeClient;
}
