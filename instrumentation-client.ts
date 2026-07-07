import * as Sentry from "@sentry/nextjs";

// Browser-side Sentry init - the client-side counterpart of instrumentation.ts.
// No DSN configured (local dev, CI) - Sentry.init no-ops safely.
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
