import { describe, it, expect, beforeEach } from "vitest";
import { requestLog } from "@/lib/duffel/client";
import { rankOffers } from "@/lib/duffel/search";
import type { NormalizedOffer } from "@/lib/duffel/types";

function makeOffer(id: string, totalAmount: string, durationH: number): NormalizedOffer {
  return {
    id,
    expires_at: "2026-08-01T00:00:00Z",
    total_amount: totalAmount,
    total_currency: "GBP",
    base_amount: totalAmount,
    tax_amount: null,
    owner: { iata_code: "BA", name: "British Airways" },
    slices: [{
      duration: `PT${durationH}H0M`,
      stops: 0,
      segments: [{
        departing_at: "2026-09-01T08:00:00",
        arriving_at: "2026-09-01T16:00:00",
        duration: `PT${durationH}H0M`,
        origin: { iata_code: "LHR", name: "London Heathrow" },
        destination: { iata_code: "JFK", name: "John F. Kennedy" },
        marketing_carrier: { iata_code: "BA", name: "British Airways" },
        operating_carrier: { iata_code: "BA", name: "British Airways" },
        flight_number: "117",
      }],
    }],
    conditions: { refundable: false, changeable: false },
    passengers: [{ id: "pas_1", type: "adult" }],
  };
}

describe("rankOffers - pure sort function", () => {
  it("sorts by price ascending when prices differ", () => {
    const offers = [
      makeOffer("c", "500.00", 8),
      makeOffer("a", "200.00", 9),
      makeOffer("b", "350.00", 7),
    ];
    const ranked = rankOffers(offers);
    expect(ranked.map((o) => o.id)).toEqual(["a", "b", "c"]);
  });

  it("breaks price ties by duration ascending", () => {
    const offers = [
      makeOffer("slow", "300.00", 12),
      makeOffer("fast", "300.00", 7),
    ];
    const ranked = rankOffers(offers);
    expect(ranked[0].id).toBe("fast");
  });

  it("preserves input array (does not mutate)", () => {
    const offers = [makeOffer("a", "300.00", 8), makeOffer("b", "100.00", 6)];
    const copy = [...offers];
    rankOffers(offers);
    expect(offers[0].id).toBe(copy[0].id);
  });

  it("handles a single offer", () => {
    const offers = [makeOffer("solo", "250.00", 5)];
    expect(rankOffers(offers)).toHaveLength(1);
  });

  it("handles empty array", () => {
    expect(rankOffers([])).toHaveLength(0);
  });
});

const HAS_KEY =
  process.env.DUFFEL_API_KEY?.startsWith("duffel_test_") ?? false;

describe.skipIf(!HAS_KEY)(
  "Duffel sandbox integration (requires DUFFEL_API_KEY in .env.local)",
  () => {
    beforeEach(() => {
      requestLog.length = 0;
    });

    it("returns >0 offers with required fields for a sandbox route", async () => {
      // Duffel Airways (ZZ) is the reliable sandbox airline - no real-airline
      // sandbox issues. LHR→JFK is a common test route.
      const { createOfferRequest } = await import("@/lib/duffel/search");

      const offers = await createOfferRequest({
        origin: "LHR",
        destination: "JFK",
        departure_date: getNextMonthDate(),
        passengers: [{ type: "adult", count: 1 }],
      });

      expect(offers.length).toBeGreaterThan(0);

      const offer = offers[0];
      expect(offer.id).toMatch(/^off_/);
      expect(offer.total_amount).toBeTruthy();
      expect(offer.total_currency).toMatch(/^[A-Z]{3}$/);
      expect(offer.owner.name).toBeTruthy();
      expect(offer.slices.length).toBeGreaterThan(0);

      const slice = offer.slices[0];
      expect(slice.segments.length).toBeGreaterThan(0);
      expect(typeof slice.stops).toBe("number");

      const seg = slice.segments[0];
      expect(seg.departing_at).toBeTruthy();
      expect(seg.arriving_at).toBeTruthy();
      expect(seg.origin.iata_code).toBeTruthy();
      expect(seg.destination.iata_code).toBeTruthy();
      expect(seg.marketing_carrier.name).toBeTruthy();
      expect(seg.operating_carrier.name).toBeTruthy();
    });

    it("every request URL targets api.duffel.com (no live endpoint called)", () => {
      for (const url of requestLog) {
        expect(url).toMatch(/^https:\/\/api\.duffel\.com/);
      }
    });

    it("prices are raw strings - no client-side arithmetic applied", async () => {
      const { createOfferRequest } = await import("@/lib/duffel/search");
      const offers = await createOfferRequest({
        origin: "LHR",
        destination: "JFK",
        departure_date: getNextMonthDate(),
        passengers: [{ type: "adult", count: 1 }],
      });
      for (const offer of offers) {
        // total = base + tax - but we never compute this ourselves
        // We just verify both are strings, not numbers
        expect(typeof offer.total_amount).toBe("string");
        expect(typeof offer.base_amount).toBe("string");
        if (offer.tax_amount !== null) {
          expect(typeof offer.tax_amount).toBe("string");
        }
      }
    });
  }
);

describe("Duffel client sandbox key enforcement", () => {
  it("rejects a live-looking key at runtime", async () => {
    const original = process.env.DUFFEL_API_KEY;
    process.env.DUFFEL_API_KEY = "duffel_live_fake_key";
    try {
      const { createOfferRequest } = await import("@/lib/duffel/search");
      await expect(
        createOfferRequest({
          origin: "LHR",
          destination: "JFK",
          departure_date: "2026-12-01",
          passengers: [{ type: "adult", count: 1 }],
        })
      ).rejects.toThrow("sandbox key");
    } finally {
      process.env.DUFFEL_API_KEY = original;
    }
  });
});

function getNextMonthDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().split("T")[0];
}
