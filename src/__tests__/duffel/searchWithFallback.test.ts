import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NormalizedOffer } from "@/lib/duffel/types";

// Mock the duffel client so createOfferRequest doesn't hit the network
vi.mock("@/lib/duffel/client", () => ({
  duffelRequest: vi.fn(),
  requestLog: [],
}));

import { duffelRequest } from "@/lib/duffel/client";
import { searchWithFallback } from "@/lib/duffel/search";
import type { SearchParams } from "@/lib/parser/types";

function makeRawOffer(id: string): NormalizedOffer {
  return {
    id,
    expires_at: "2026-08-01T00:00:00Z",
    total_amount: "200.00",
    total_currency: "GBP",
    base_amount: "180.00",
    tax_amount: "20.00",
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
    conditions: { refundable: false, changeable: false },
    passengers: [{ id: "pas_1", type: "adult" }],
  };
}

function makeApiResponse(offers: NormalizedOffer[]) {
  return {
    offers: offers.map((o) => ({
      id: o.id,
      expires_at: o.expires_at,
      total_amount: o.total_amount,
      total_currency: o.total_currency,
      base_amount: o.base_amount,
      tax_amount: o.tax_amount,
      owner: { ...o.owner, logo_symbol_url: undefined },
      slices: o.slices.map((s) => ({
        duration: s.duration,
        segments: s.segments.map((seg) => ({
          departing_at: seg.departing_at,
          arriving_at: seg.arriving_at,
          duration: seg.duration,
          origin: seg.origin,
          destination: seg.destination,
          marketing_carrier: { ...seg.marketing_carrier, marketing_carrier_flight_number: seg.flight_number },
          operating_carrier: seg.operating_carrier,
          marketing_carrier_flight_number: seg.flight_number,
        })),
      })),
      conditions: {
        refund_before_departure: { allowed: o.conditions.refundable },
        change_before_departure: { allowed: o.conditions.changeable },
      },
      passengers: o.passengers,
    })),
  };
}

const BASE_PARAMS: SearchParams = {
  origin: "LHR",
  destination: "JFK",
  departure_date: "2026-10-01",
  passengers: [{ type: "adult", count: 1 }],
};

beforeEach(() => {
  vi.mocked(duffelRequest).mockReset();
});

describe("searchWithFallback", () => {
  it("returns results directly when exact date has offers", async () => {
    vi.mocked(duffelRequest).mockResolvedValueOnce(makeApiResponse([makeRawOffer("off_exact")]));

    const result = await searchWithFallback(BASE_PARAMS);

    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].id).toBe("off_exact");
    expect(result.dateAdjusted).toBe(false);
    expect(result.usedParams.departure_date).toBe("2026-10-01");
    expect(vi.mocked(duffelRequest)).toHaveBeenCalledTimes(1);
  });

  it("tries alternative dates when exact date returns no offers", async () => {
    vi.mocked(duffelRequest)
      .mockResolvedValueOnce(makeApiResponse([]))   // exact date - empty
      .mockResolvedValueOnce(makeApiResponse([]))   // +1 day - empty
      .mockResolvedValueOnce(makeApiResponse([makeRawOffer("off_fallback")])); // -1 day - hit

    const result = await searchWithFallback(BASE_PARAMS);

    expect(result.offers).toHaveLength(1);
    expect(result.offers[0].id).toBe("off_fallback");
    expect(result.dateAdjusted).toBe(true);
  });

  it("returns empty with dateAdjusted=false when all fallback dates fail", async () => {
    vi.mocked(duffelRequest).mockResolvedValue(makeApiResponse([]));

    const result = await searchWithFallback(BASE_PARAMS);

    expect(result.offers).toHaveLength(0);
    expect(result.dateAdjusted).toBe(false);
  });

  it("adjusts return_date by the same delta as departure_date", async () => {
    vi.mocked(duffelRequest)
      .mockResolvedValueOnce(makeApiResponse([]))  // exact dates - empty
      .mockResolvedValueOnce(makeApiResponse([makeRawOffer("off_rt")])); // +1 day - hit

    const params: SearchParams = {
      ...BASE_PARAMS,
      return_date: "2026-10-08",
    };

    const result = await searchWithFallback(params);

    expect(result.dateAdjusted).toBe(true);
    expect(result.usedParams.departure_date).toBe("2026-10-02"); // +1
    expect(result.usedParams.return_date).toBe("2026-10-09");    // +1
  });

  it("does not attempt date-shift fallback for multi-city itineraries", async () => {
    vi.mocked(duffelRequest).mockResolvedValueOnce(makeApiResponse([]));

    const params: SearchParams = {
      ...BASE_PARAMS,
      additional_slices: [{ origin: "JFK", destination: "LAX", departure_date: "2026-10-08" }],
    };

    const result = await searchWithFallback(params);

    expect(result.offers).toHaveLength(0);
    expect(result.dateAdjusted).toBe(false);
    expect(vi.mocked(duffelRequest)).toHaveBeenCalledTimes(1);
  });

  it("sends every leg of a multi-city itinerary to Duffel as separate slices", async () => {
    vi.mocked(duffelRequest).mockResolvedValueOnce(makeApiResponse([makeRawOffer("off_mc")]));

    const params: SearchParams = {
      ...BASE_PARAMS,
      additional_slices: [
        { origin: "JFK", destination: "LAX", departure_date: "2026-10-08" },
        { origin: "LAX", destination: "LHR", departure_date: "2026-10-15" },
      ],
    };

    await searchWithFallback(params);

    const call = vi.mocked(duffelRequest).mock.calls[0];
    const body = (call[1] as { body: { data: { slices: unknown[] } } }).body;
    expect(body.data.slices).toHaveLength(3);
  });

  it("does not mutate the original params object", async () => {
    vi.mocked(duffelRequest)
      .mockResolvedValueOnce(makeApiResponse([]))
      .mockResolvedValueOnce(makeApiResponse([makeRawOffer("off_x")]));

    const original = { ...BASE_PARAMS };
    await searchWithFallback(BASE_PARAMS);
    expect(BASE_PARAMS.departure_date).toBe(original.departure_date);
  });
});
