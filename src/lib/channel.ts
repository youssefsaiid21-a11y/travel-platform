// Reads the first-touch channel attribution cookie set by src/proxy.ts.
// Client-side only (no next/headers dependency) - used by client components
// like OfferCard that fire analytics events directly in the browser.
export function getChannelCookie(): string {
  if (typeof document === "undefined") return "direct";
  const match = document.cookie.match(/(?:^|;\s*)orbi_channel=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : "direct";
}
