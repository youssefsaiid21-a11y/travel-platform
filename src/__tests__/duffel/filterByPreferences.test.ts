import { describe, it, expect } from "vitest";
import { filterByPreferences } from "@/lib/duffel/search";
import type { NormalizedOffer } from "@/lib/duffel/types";
import type { SearchParams } from "@/lib/parser/types";

const BASE_PARAMS: SearchParams = {
  origin: "LHR",
  destination: "JFK",
  departure_date: "2026-10-01",
  passengers: [{ type: "adult", count: 1 }],
};

function makeOffer(id: string, totalAmount: string, refundable: boolean): NormalizedOffer {
  return {
    id,
    expires_at: "2026-08-01T00:00:00Z",
    total_amount: totalAmount,
    total_currency: "GBP",
    base_amount: totalAmount,
    tax_amount: null,
    owner: { iata_code: "ZZ", name: "Duffel Airways" },
    slices: [{
      duration: "PT7H0M",
      stops: 0,
      segments: [{
        departing_at: "2026-10-01T08:00:00",
        arriving_at: "2026-10-01T15:00:00",
        duration: "PT7H0M",
        origin: { iata_code: "LHR", name: "Heathrow" },
        destination: { iata_code: "JFK", name: "JFK" },
        marketing_carrier: { iata_code: "ZZ", name: "Duffel Airways" },
        operating_carrier: { iata_code: "ZZ", name: "Duffel Airways" },
        flight_number: "001",
      }],
    }],
    conditions: { refundable, changeable: false },
    passengers: [{ id: "pas_1", type: "adult" }],
  };
}

describe("filterByPreferences", () => {
  it("returns no note when there are no offers to filter, even with preferences set", () => {
    const result = filterByPreferences([], { ...BASE_PARAMS, prefer_refundable: true });
    expect(result.offers).toEqual([]);
    expect(result.note).toBeNull();
  });

  it("preserves price order so the cheapest filtered offer is still first - the exact value the chat route reuses for the price calendar's exact-date tile", () => {
    // Pre-sorted ascending by price, as rankOffers would produce, with the
    // overall cheapest offer being non-refundable.
    const offers = [
      makeOffer("cheap_nonref", "150.00", false),
      makeOffer("mid_ref", "300.00", true),
      makeOffer("expensive_ref", "450.00", true),
    ];

    const result = filterByPreferences(offers, { ...BASE_PARAMS, prefer_refundable: true });

    // Filtered cheapest must be the £300 refundable offer, not the £150
    // non-refundable one that got filtered out - this is the exact value
    // that must match between the reply text and the price calendar.
    expect(result.offers[0].id).toBe("mid_ref");
    expect(result.offers[0].total_amount).toBe("300.00");
  });
});
