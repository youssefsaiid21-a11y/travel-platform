import { NextRequest, NextResponse } from "next/server";

// CSP needs a per-request nonce so Next.js's own inline hydration bootstrap
// scripts (the `self.__next_f.push(...)` tags every App Router page ships)
// can run without a blanket 'unsafe-inline' - see
// https://nextjs.org/docs/app/guides/content-security-policy. A static CSP
// set from next.config.ts's headers() has no per-request nonce, which is
// what silently blocked those scripts and broke all client-side
// interactivity in production the first time a CSP was added here.
export function middleware(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const isDev = process.env.NODE_ENV === "development";

  const csp = [
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

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // Skip static assets so a fresh nonce/CSP isn't computed for requests
    // that never render HTML.
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
