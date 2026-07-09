import type { MetadataRoute } from "next";
import { getBaseUrl } from "@/lib/site";

// Replaces the old static public/robots.txt - that file hardcoded the
// domain separately from sitemap.ts, so the two could (and did) disagree.
// This is generated from the same getBaseUrl() single source of truth.
export default function robots(): MetadataRoute.Robots {
  const base = getBaseUrl();
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/login", "/signup", "/support", "/flights/", "/guides"],
      disallow: ["/api/", "/bookings", "/booking/", "/profile"],
    },
    sitemap: `${base}/sitemap.xml`,
  };
}
