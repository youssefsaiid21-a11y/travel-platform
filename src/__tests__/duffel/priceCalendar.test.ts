import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NormalizedOffer } from "@/lib/duffel/types";

vi.mock("@/lib/duffel/client", () => ({
  duffelRequest: vi.fn(),
  requestLog: [],
}));

import { duffelRequest } from "@/lib/duffel/client";
import { getPriceCalendar } from "@/lib/duffel/search";
import type { SearchParams } from "@/lib/parser/types";

function makeRawOffer(id: string, totalAmount: string, refundable = false): NormalizedOffer {
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

const BASE_PARAMS: SearchParams = {
  origin: "LHR",
  destination: "JFK",
  departure_date: "2026-10-10",
  passengers: [{ type: "adult", count: 1 }],
};

beforeEach(() => {
  vi.mocked(duffelRequest).mockReset();
});

describe("getPriceCalendar", () => {
  it("returns a sorted entry per date in the window, cheapest offer per date", async () => {
    vi.mocked(duffelRequest).mockResolvedValue(makeApiResponse([makeRawOffer("off", "300.00")]));

    const entries = await getPriceCalendar(BASE_PARAMS, 1);

    expect(entries.map((e) => e.date)).toEqual(["2026-10-09", "2026-10-10", "2026-10-11"]);
    for (const e of entries) {
      expect(e.cheapestAmount).toBe("300.00");
      expect(e.currency).toBe("GBP");
    }
  });

  it("applies prefer_refundable to every date, not just the known exact date", async () => {
    // Cheapest offer overall is non-refundable; the refundable one is pricier.
    vi.mocked(duffelRequest).mockResolvedValue(
      makeApiResponse([
        makeRawOffer("cheap_nonref", "150.00", false),
        makeRawOffer("pricier_ref", "400.00", true),
      ])
    );

    const entries = await getPriceCalendar({ ...BASE_PARAMS, prefer_refundable: true }, 1);

    // Every date's tile must reflect the refundable price (£400), since that's
    // what clicking any of these dates would actually search for and find -
    // not the £150 non-refundable fare that "refundable only" would filter out.
    for (const e of entries) {
      expect(e.cheapestAmount).toBe("400.00");
    }
  });

  it("uses the known exact-date entry instead of re-querying Duffel for delta 0", async () => {
    vi.mocked(duffelRequest).mockResolvedValue(makeApiResponse([makeRawOffer("off", "300.00")]));

    const entries = await getPriceCalendar(BASE_PARAMS, 1, {
      cheapestAmount: "99.00",
      currency: "USD",
    });

    // Only the two shifted dates (-1, +1) should hit Duffel - delta 0 is reused.
    expect(vi.mocked(duffelRequest)).toHaveBeenCalledTimes(2);
    const exact = entries.find((e) => e.date === BASE_PARAMS.departure_date);
    expect(exact).toEqual({ date: BASE_PARAMS.departure_date, cheapestAmount: "99.00", currency: "USD" });
  });

  it("skips dates before today", async () => {
    vi.mocked(duffelRequest).mockResolvedValue(makeApiResponse([]));
    const today = new Date().toISOString().split("T")[0];

    const entries = await getPriceCalendar({ ...BASE_PARAMS, departure_date: today }, 2);

    expect(entries.every((e) => e.date >= today)).toBe(true);
    expect(entries[0].date).toBe(today);
  });

  it("returns null price for dates with no offers or errors, without throwing", async () => {
    vi.mocked(duffelRequest)
      .mockResolvedValueOnce(makeApiResponse([]))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(makeApiResponse([makeRawOffer("off", "150.00")]));

    const entries = await getPriceCalendar(BASE_PARAMS, 1);

    expect(entries).toHaveLength(3);
    const nullEntries = entries.filter((e) => e.cheapestAmount === null);
    expect(nullEntries).toHaveLength(2);
  });

  it("shifts return_date by the same delta as departure_date for round trips", async () => {
    vi.mocked(duffelRequest).mockResolvedValue(makeApiResponse([makeRawOffer("off", "300.00")]));

    await getPriceCalendar({ ...BASE_PARAMS, return_date: "2026-10-17" }, 1);

    const calls = vi.mocked(duffelRequest).mock.calls;
    expect(calls).toHaveLength(3);
    const bodies = calls.map((c) => (c[1] as { body: { data: { slices: Array<{ departure_date: string }> } } }).body.data.slices);
    expect(bodies[0][1].departure_date).toBe("2026-10-16");
    expect(bodies[2][1].departure_date).toBe("2026-10-18");
  });
});
