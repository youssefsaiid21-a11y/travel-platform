import * as Sentry from "@sentry/nextjs";

// Runs once per server/edge runtime on cold start (Next.js instrumentation
// hook - see next.config.ts). instrumentation-client.ts handles the browser
// side; this file is the only place server/edge Sentry.init() is called.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
      // No DSN configured (e.g. local dev, CI) - Sentry.init no-ops safely,
      // so this doesn't need its own env-gate.
    });
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    Sentry.init({
      dsn: process.env.SENTRY_DSN,
      tracesSampleRate: 0.1,
    });
  }
}

export const onRequestError = Sentry.captureRequestError;
