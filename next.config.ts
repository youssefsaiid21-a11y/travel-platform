import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs";

// Content-Security-Policy is set in src/proxy.ts instead of here - it needs
// a fresh per-request nonce for Next.js's own inline hydration scripts,
// which a static header from next.config.ts's headers() can't provide.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
  experimental: {
    // Lets React's <ViewTransition> (used in layout.tsx) drive route-change
    // crossfades via the browser's native View Transitions API - no client
    // animation library needed. Ships in Next's own bundled React build;
    // @types/react doesn't know about it yet, hence src/types/react-view-transition.d.ts.
    viewTransition: true,
  },
  // /admin/ops reads .claude/BUSINESS_STATE.md via fs at request time
  // (src/lib/businessState.ts). That file lives outside src/ and is read,
  // not imported, so @vercel/nft's static analysis isn't guaranteed to
  // include it in the deployed function's bundle - pin it explicitly
  // rather than relying on next dev's raw filesystem access (which works
  // regardless and would hide this in local testing).
  outputFileTracingIncludes: {
    "/admin/ops": [".claude/BUSINESS_STATE.md"],
  },
};

// Wraps the build to upload source maps to Sentry - a no-op when SENTRY_AUTH_TOKEN
// isn't set (local dev, CI, and any run without a Sentry org/project configured).
export default withSentryConfig(nextConfig, {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: true,
  // disableLogger isn't supported under Turbopack (which this project
  // builds with) - omitted rather than left in as a no-op that also
  // prints its own deprecation warning on every build.
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
});
