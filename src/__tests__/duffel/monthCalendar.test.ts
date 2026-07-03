import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NormalizedOffer } from "@/lib/duffel/types";

vi.mock("@/lib/duffel/client", () => ({
  duffelRequest: vi.fn(),
  requestLog: [],
}));

import { duffelRequest } from "@/lib/duffel/client";
import { getMonthPriceCalendar } from "@/lib/duffel/search";
import type { SearchParams } from "@/lib/parser/types";

function makeRawOffer(id: string, totalAmount: string, refundable = false): NormalizedOffer {
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

describe("getMonthPriceCalendar", () => {
  it("returns one entry per day of the calendar month containing departure_date, sorted ascending", async () => {
    vi.mocked(duffelRequest).mockResolvedValue(makeApiResponse([makeRawOffer("off", "300.00")]));

    const entries = await getMonthPriceCalendar(BASE_PARAMS);

    // October 2026 has 31 days, and the whole month is in the future relative
    // to "today" in this test environment, so every day should be present.
    expect(entries).toHaveLength(31);
    expect(entries[0].date).toBe("2026-10-01");
    expect(entries[entries.length - 1].date).toBe("2026-10-31");
    // Sorted ascending
    const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date));
    expect(entries.map((e) => e.date)).toEqual(sorted.map((e) => e.date));
  });

  it("omits days in the month that fall before today", async () => {
    vi.mocked(duffelRequest).mockResolvedValue(makeApiResponse([makeRawOffer("off", "300.00")]));
    const today = new Date().toISOString().split("T")[0];
    const [y, m] = today.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();

    const entries = await getMonthPriceCalendar({ ...BASE_PARAMS, departure_date: today });

    expect(entries.every((e) => e.date >= today)).toBe(true);
    expect(entries[0].date).toBe(today);
    expect(entries).toHaveLength(daysInMonth - Number(today.split("-")[2]) + 1);
  });

  it("applies prefer_refundable to every day in the month, not just departure_date", async () => {
    vi.mocked(duffelRequest).mockResolvedValue(
      makeApiResponse([
        makeRawOffer("cheap_nonref", "150.00", false),
        makeRawOffer("pricier_ref", "400.00", true),
      ])
    );

    const entries = await getMonthPriceCalendar({ ...BASE_PARAMS, prefer_refundable: true });

    for (const e of entries) {
      expect(e.cheapestAmount).toBe("400.00");
    }
  });

  it("returns [] for multi-city params - the same guard as getPriceCalendar", async () => {
    const entries = await getMonthPriceCalendar({
      ...BASE_PARAMS,
      additional_slices: [{ origin: "JFK", destination: "LAX", departure_date: "2026-10-15" }],
    });
    expect(entries).toEqual([]);
    expect(duffelRequest).not.toHaveBeenCalled();
  });

  it("reuses the known exact-date entry instead of re-querying Duffel for departure_date", async () => {
    vi.mocked(duffelRequest).mockResolvedValue(makeApiResponse([makeRawOffer("off", "300.00")]));

    const entries = await getMonthPriceCalendar(BASE_PARAMS, {
      cheapestAmount: "42.00",
      currency: "USD",
    });

    // 31 days in October, 30 of which hit Duffel - departure_date (Oct 10) is reused.
    expect(vi.mocked(duffelRequest)).toHaveBeenCalledTimes(30);
    const exact = entries.find((e) => e.date === BASE_PARAMS.departure_date);
    expect(exact).toEqual({ date: BASE_PARAMS.departure_date, cheapestAmount: "42.00", currency: "USD" });
  });

  it("shifts return_date by the correct delta throughout the month for round trips", async () => {
    vi.mocked(duffelRequest).mockResolvedValue(makeApiResponse([makeRawOffer("off", "300.00")]));

    await getMonthPriceCalendar({ ...BASE_PARAMS, return_date: "2026-10-17" });

    const calls = vi.mocked(duffelRequest).mock.calls;
    const bodies = calls.map(
      (c) => (c[1] as { body: { data: { slices: Array<{ departure_date: string }> } } }).body.data.slices
    );
    // Find the call for departure_date = 2026-10-01 (delta -9 from the 10th) -
    // return_date should shift by the same -9 days, to 2026-10-08.
    const oct1Call = bodies.find((b) => b[0].departure_date === "2026-10-01");
    expect(oct1Call?.[1].departure_date).toBe("2026-10-08");

    // And 2026-10-31 (delta +21) -> return_date shifts to 2026-11-07.
    const oct31Call = bodies.find((b) => b[0].departure_date === "2026-10-31");
    expect(oct31Call?.[1].departure_date).toBe("2026-11-07");
  });

  it("returns null price for days with no offers or errors, without throwing", async () => {
    vi.mocked(duffelRequest)
      .mockResolvedValueOnce(makeApiResponse([]))
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue(makeApiResponse([makeRawOffer("off", "150.00")]));

    const entries = await getMonthPriceCalendar(BASE_PARAMS);

    expect(entries).toHaveLength(31);
    const nullEntries = entries.filter((e) => e.cheapestAmount === null);
    expect(nullEntries).toHaveLength(2);
  });
});
