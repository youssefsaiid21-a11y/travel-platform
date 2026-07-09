import type { MetadataRoute } from "next";
import { GUIDES } from "@/lib/guides";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://orbi.travel";
  return [
    { url: base, lastModified: new Date(), changeFrequency: "weekly", priority: 1 },
    { url: `${base}/login`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.5 },
    { url: `${base}/signup`, lastModified: new Date(), changeFrequency: "yearly", priority: 0.6 },
    { url: `${base}/support`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.4 },
    { url: `${base}/guides`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.6 },
    ...GUIDES.map((g) => ({
      url: `${base}/guides/${g.slug}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.5,
    })),
  ];
}
