// Single source of truth for the app's public base URL. `orbi.travel` is an
// intended future custom domain that doesn't currently resolve (verified via
// curl during the SEO agent's audit) - the fallback here is the real, live
// Vercel URL so sitemap/JSON-LD/notification links are never dead by default.
// Set NEXT_PUBLIC_APP_URL on Vercel once a custom domain is actually live.
export function getBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL ?? "https://travel-platform-ashy.vercel.app";
}
