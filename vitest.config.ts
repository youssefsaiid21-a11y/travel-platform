import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // e2e/ holds real Playwright specs (run via `npm run test:e2e`, a
    // separate browser-automation tool with its own test/expect globals) -
    // Vitest's default *.spec.ts glob would otherwise try to run them too.
    exclude: ["**/node_modules/**", "**/e2e/**"],
    // Tests that hit routes touching getStripe() mock the `stripe` package
    // itself, but getStripe() still checks STRIPE_SECRET_KEY is non-empty
    // before constructing the (mocked) client - stub a placeholder so that
    // guard doesn't throw before the mock is ever reached.
    env: {
      STRIPE_SECRET_KEY: "sk_test_placeholder_for_unit_tests",
      // A real 32-byte AES-256 key, base64-encoded - not the production
      // key, just needs to be valid-shaped for src/lib/crypto.ts to work.
      PASSPORT_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      // Not the production secret - just needs to be set for
      // src/lib/recoveryToken.ts's HMAC to work in tests.
      NEXTAUTH_SECRET: "test-only-nextauth-secret-placeholder",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
