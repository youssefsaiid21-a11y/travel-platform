import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NormalizedOffer } from "@/lib/duffel/types";
import type { SearchParams } from "@/lib/parser/types";

vi.mock("@/lib/duffel/client", () => ({
  duffelRequest: vi.fn(),
  requestLog: [],
}));

import { duffelRequest } from "@/lib/duffel/client";
import { searchSources } from "@/lib/fares/aggregate";
import { duffelSource } from "@/lib/fares/duffelSource";
import { createFixtureFareSource } from "@/lib/fares/mockSource";

function makeOffer(id: string, totalAmount: string): NormalizedOffer {
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
      owner: o.owner,
      slices: o.slices.map((s) => ({
        duration: s.duration,
        segments: s.segments.map((seg) => ({
          departing_at: seg.departing_at,
          arriving_at: seg.arriving_at,
          duration: seg.duration,
          origin: seg.origin,
          destination: seg.destination,
          marketing_carrier: seg.marketing_carrier,
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

const PARAMS: SearchParams = {
  origin: "LHR",
  destination: "JFK",
  departure_date: "2026-10-01",
  passengers: [{ type: "adult", count: 1 }],
};

beforeEach(() => {
  vi.mocked(duffelRequest).mockReset();
});

describe("searchSources - multi-source merge/rank", () => {
  it("merges and price-sorts offers from two independent sources", async () => {
    vi.mocked(duffelRequest).mockResolvedValueOnce(
      makeApiResponse([makeOffer("duffel_expensive", "500.00")])
    );
    const fixtureSource = createFixtureFareSource("fixture", "Fixture Airline", [
      makeOffer("fixture_cheap", "150.00"),
    ]);

    const offers = await searchSources([duffelSource, fixtureSource], PARAMS);

    expect(offers.map((o) => o.id)).toEqual(["fixture_cheap", "duffel_expensive"]);
  });

  it("keeps results from a healthy source when another source fails", async () => {
    vi.mocked(duffelRequest).mockRejectedValueOnce(new Error("network down"));
    const fixtureSource = createFixtureFareSource("fixture", "Fixture Airline", [
      makeOffer("fixture_only", "200.00"),
    ]);

    const offers = await searchSources([duffelSource, fixtureSource], PARAMS);

    expect(offers).toHaveLength(1);
    expect(offers[0].id).toBe("fixture_only");
  });

  it("returns an empty array when every source fails", async () => {
    vi.mocked(duffelRequest).mockRejectedValueOnce(new Error("network down"));
    const failingSource = createFixtureFareSource("broken", "Broken", []);
    failingSource.search = async () => {
      throw new Error("also broken");
    };

    const offers = await searchSources([duffelSource, failingSource], PARAMS);
    expect(offers).toEqual([]);
  });
});
