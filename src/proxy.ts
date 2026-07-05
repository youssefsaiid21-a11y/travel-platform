import { auth } from "@/auth";
import { NextResponse } from "next/server";

// CSP needs a per-request nonce so Next.js's own inline hydration bootstrap
// scripts (`self.__next_f.push(...)`, present on every App Router page) can
// run without a blanket 'unsafe-inline' - see
// https://nextjs.org/docs/app/guides/content-security-policy. A static CSP
// from next.config.ts's headers() has no per-request nonce, which is what
// silently blocked those scripts and broke all client-side interactivity
// site-wide the first time a CSP was added there instead of here.
function buildCsp(nonce: string) {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // 'strict-dynamic' lets a script our own nonce'd bundle injects (e.g.
    // Stripe.js's loadStripe() appending <script src="https://js.stripe.com/v3">)
    // run without listing every such origin - the explicit https://js.stripe.com
    // stays too as a fallback for browsers that don't support strict-dynamic.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' https://js.stripe.com${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline `style={{...}}` attributes have no CSP nonce mechanism (only
    // <style> elements do), so this has to stay 'unsafe-inline'.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self' https://api.stripe.com",
    "frame-src https://js.stripe.com https://hooks.stripe.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export default auth((req) => {
  const isLoggedIn = !!req.auth;
  const { pathname } = req.nextUrl;

  const isProtected =
    pathname.startsWith("/bookings") ||
    pathname.startsWith("/booking/") ||
    pathname.startsWith("/profile");

  if (isProtected && !isLoggedIn) {
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname);
    return NextResponse.redirect(loginUrl);
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
});

export const config = {
  // Broad on purpose - CSP needs to apply to every HTML-rendering route, not
  // just the auth-protected ones the redirect logic above cares about. API
  // routes are excluded: they return JSON (no inline scripts to nonce, no
  // CSP to enforce) and already run their own `auth()` check in-handler, so
  // routing them through this wrapper too would just be wasted session-cookie
  // decoding on every request - including unauthenticated ones like the
  // Stripe webhook and the cron endpoint, where it's also pure risk for no
  // benefit (an exception in auth() would fire before those routes ever get
  // to their own signature/token checks).
  matcher: ["/((?!api/|_next/static|_next/image|favicon.ico).*)"],
};
