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
