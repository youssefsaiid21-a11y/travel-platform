import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NormalizedOffer } from "@/lib/duffel/types";

vi.mock("@/lib/duffel/client", () => ({
  duffelRequest: vi.fn(),
  requestLog: [],
}));

import { duffelRequest } from "@/lib/duffel/client";
import { exploreDestinations } from "@/lib/duffel/explore";
import type { ExploreParams } from "@/lib/parser/types";

function makeRawOffer(id: string, totalAmount: string): NormalizedOffer {
  return {
    id,
    expires_at: "2026-11-01T00:00:00Z",
    total_amount: totalAmount,
    total_currency: "GBP",
    base_amount: totalAmount,
    tax_amount: null,
    owner: { iata_code: "ZZ", name: "Duffel Airways" },
    slices: [{
      duration: "PT7H0M",
      stops: 0,
      segments: [{
        departing_at: "2026-10-10T08:00:00",
        arriving_at: "2026-10-10T15:00:00",
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
          marketing_carrier: { ...seg.marketing_carrier },
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

interface OfferRequestCallOpts {
  body: { data: { slices: Array<{ origin: string; destination: string }> } };
}

const BASE_EXPLORE_PARAMS: ExploreParams = {
  origin: "LHR",
  departure_date: "2026-10-10",
  passengers: [{ type: "adult", count: 1 }],
};

// Fixed per-destination behaviour used across tests below.
const PRICE_BY_DEST: Record<string, string> = {
  CDG: "150.00", // cheapest
  JFK: "500.00",
  BKK: "900.00",
};

function mockPerDestination() {
  vi.mocked(duffelRequest).mockImplementation(async (_path: string, opts?: unknown) => {
    const dest = (opts as OfferRequestCallOpts).body.data.slices[0].destination;
    if (dest === "NRT") return makeApiResponse([]); // no availability
    if (dest === "DXB") throw new Error("simulated Duffel failure");
    const price = PRICE_BY_DEST[dest] ?? "1000.00";
    return makeApiResponse([makeRawOffer(`off_${dest}`, price)]);
  });
}

beforeEach(() => {
  vi.mocked(duffelRequest).mockReset();
});

describe("exploreDestinations", () => {
  it("ranks destinations cheapest-first", async () => {
    mockPerDestination();

    const results = await exploreDestinations(BASE_EXPLORE_PARAMS);

    expect(results[0].destination).toBe("CDG");
    expect(results[0].cheapestAmount).toBe("150.00");
    const amounts = results.map((r) => parseFloat(r.cheapestAmount));
    expect(amounts).toEqual([...amounts].sort((a, b) => a - b));
  });

  it("excludes destinations with no offers", async () => {
    mockPerDestination();
    const results = await exploreDestinations(BASE_EXPLORE_PARAMS);
    expect(results.find((r) => r.destination === "NRT")).toBeUndefined();
  });

  it("excludes destinations whose search errors, without failing the whole request", async () => {
    mockPerDestination();
    const results = await exploreDestinations(BASE_EXPLORE_PARAMS);
    expect(results.find((r) => r.destination === "DXB")).toBeUndefined();
    // Other destinations still come back despite DXB failing.
    expect(results.find((r) => r.destination === "CDG")).toBeDefined();
  });

  it("never searches the origin itself, even if it's in the popular-destinations list", async () => {
    vi.mocked(duffelRequest).mockResolvedValue(makeApiResponse([makeRawOffer("off", "100.00")]));

    const results = await exploreDestinations({ ...BASE_EXPLORE_PARAMS, origin: "CDG" });

    expect(results.find((r) => r.destination === "CDG")).toBeUndefined();
    const destinations = vi.mocked(duffelRequest).mock.calls.map(
      (c) => (c[1] as OfferRequestCallOpts).body.data.slices[0].destination
    );
    expect(destinations).not.toContain("CDG");
  });

  it("still searches every popular destination despite batching in groups of 10 internally", async () => {
    // POPULAR_DESTINATIONS has 26 entries - more than one batch - so this
    // exercises the chunking loop for real instead of asserting against a
    // fake oversized list.
    vi.mocked(duffelRequest).mockResolvedValue(makeApiResponse([makeRawOffer("off", "100.00")]));

    await exploreDestinations(BASE_EXPLORE_PARAMS);

    const { POPULAR_DESTINATIONS } = await import("@/lib/airlines/popularDestinations");
    const expectedCount = POPULAR_DESTINATIONS.filter(
      (d) => d.iata !== BASE_EXPLORE_PARAMS.origin
    ).length;
    expect(vi.mocked(duffelRequest)).toHaveBeenCalledTimes(expectedCount);
  });

  it("filters out destinations above max_budget", async () => {
    mockPerDestination();

    const results = await exploreDestinations({ ...BASE_EXPLORE_PARAMS, max_budget: 200 });

    expect(results.every((r) => parseFloat(r.cheapestAmount) <= 200)).toBe(true);
    expect(results.find((r) => r.destination === "JFK")).toBeUndefined(); // 500 > 200
    expect(results.find((r) => r.destination === "CDG")).toBeDefined(); // 150 <= 200
  });

  it("carries the searched origin/date/passengers through to each per-destination request", async () => {
    vi.mocked(duffelRequest).mockResolvedValue(makeApiResponse([makeRawOffer("off", "100.00")]));

    await exploreDestinations({
      origin: "LHR",
      departure_date: "2026-10-10",
      return_date: "2026-10-17",
      passengers: [{ type: "adult", count: 2 }],
      cabin_class: "business",
    });

    const firstCallOpts = vi.mocked(duffelRequest).mock.calls[0][1] as {
      body: { data: { slices: unknown[]; passengers: unknown[]; cabin_class?: string } };
    };
    expect(firstCallOpts.body.data.slices).toHaveLength(2); // outbound + return
    expect(firstCallOpts.body.data.passengers).toHaveLength(2);
    expect(firstCallOpts.body.data.cabin_class).toBe("business");
  });
});
