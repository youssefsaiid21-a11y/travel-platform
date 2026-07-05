import type { NextConfig } from "next";

// Dev needs 'unsafe-eval' for Turbopack/webpack HMR source maps - production
// does not, so keep it out of the policy actually served to users.
const scriptSrc =
  process.env.NODE_ENV === "development"
    ? "'self' 'unsafe-eval' https://js.stripe.com"
    : "'self' https://js.stripe.com";

// Stripe Elements (card input) only ever runs as their hosted iframe, never
// our own inline scripts - so only Stripe's own script/frame origins need
// naming here, not a blanket 'unsafe-inline' for scripts.
const csp = [
  "default-src 'self'",
  `script-src ${scriptSrc}`,
  // React inline `style={{...}}` attributes require this - there's no nonce
  // path for inline style attributes in Next.js today.
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self' https://api.stripe.com",
  "frame-src https://js.stripe.com https://hooks.stripe.com",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-XSS-Protection", value: "1; mode=block" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: csp },
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
};

export default nextConfig;
