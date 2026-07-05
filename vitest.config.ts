import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Tests that hit routes touching getStripe() mock the `stripe` package
    // itself, but getStripe() still checks STRIPE_SECRET_KEY is non-empty
    // before constructing the (mocked) client - stub a placeholder so that
    // guard doesn't throw before the mock is ever reached.
    env: {
      STRIPE_SECRET_KEY: "sk_test_placeholder_for_unit_tests",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
