import { describe, it, expect } from "vitest";
import { FLIGHT_GUIDES, getFlightGuide } from "@/lib/flightGuides";

describe("flightGuides", () => {
  it("has at least one guide with a unique slug", () => {
    expect(FLIGHT_GUIDES.length).toBeGreaterThan(0);
    const slugs = FLIGHT_GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("every guide has at least one FAQ", () => {
    for (const guide of FLIGHT_GUIDES) {
      expect(guide.faqs.length).toBeGreaterThan(0);
    }
  });

  it("getFlightGuide finds an existing guide by slug", () => {
    const guide = getFlightGuide("london-to-new-york");
    expect(guide).toBeDefined();
    expect(guide?.origin).toBe("LHR");
    expect(guide?.destination).toBe("JFK");
  });

  it("getFlightGuide returns undefined for an unknown slug", () => {
    expect(getFlightGuide("nowhere-to-nowhere")).toBeUndefined();
  });
});
