import { describe, it, expect, afterEach } from "vitest";
import sitemap from "@/app/sitemap";
import robots from "@/app/robots";
import { FLIGHT_GUIDES } from "@/lib/flightGuides";

describe("sitemap", () => {
  const originalEnv = process.env.NEXT_PUBLIC_APP_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = originalEnv;
  });

  it("uses the live Vercel URL fallback, not the non-resolving orbi.travel domain", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const entries = sitemap();
    expect(entries[0].url).toBe("https://travel-platform-ashy.vercel.app");
  });

  it("includes every flight guide route", () => {
    const entries = sitemap();
    for (const guide of FLIGHT_GUIDES) {
      expect(entries.some((e) => e.url.endsWith(`/flights/${guide.slug}`))).toBe(true);
    }
  });
});

describe("robots", () => {
  it("references the sitemap using the same base URL as sitemap.ts", () => {
    delete process.env.NEXT_PUBLIC_APP_URL;
    const result = robots();
    expect(result.sitemap).toBe("https://travel-platform-ashy.vercel.app/sitemap.xml");
  });

  it("disallows authenticated/API routes", () => {
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rules?.disallow).toEqual(
      expect.arrayContaining(["/api/", "/bookings", "/booking/", "/profile"])
    );
  });
});
