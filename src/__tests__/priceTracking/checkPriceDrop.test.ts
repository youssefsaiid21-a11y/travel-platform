import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NormalizedOffer } from "@/lib/duffel/types";

const mockCreateOfferRequest = vi.hoisted(() => vi.fn());
const mockSendPriceDropAlert = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/duffel/search", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/duffel/search")>();
  return {
    ...actual,
    createOfferRequest: mockCreateOfferRequest,
  };
});

vi.mock("@/lib/notifications", () => ({
  sendPriceDropAlert: mockSendPriceDropAlert,
}));

vi.mock("@/lib/db", () => ({
  db: {
    trackedSearch: { update: mockUpdate },
  },
}));

import {
  comparePrices,
  trackedSearchToSearchParams,
  checkTrackedSearchForPriceDrop,
  type TrackedSearchWithUser,
} from "@/lib/priceTracking/checkPriceDrop";

function makeOffer(
  id: string,
  totalAmount: string,
  currency = "GBP",
  refundable = false
): NormalizedOffer {
  return {
    id,
    expires_at: "2026-08-01T00:00:00Z",
    total_amount: totalAmount,
    total_currency: currency,
    base_amount: totalAmount,
    tax_amount: null,
    owner: { iata_code: "ZZ", name: "Duffel Airways" },
    slices: [
      {
        duration: "PT7H0M",
        stops: 0,
        segments: [
          {
            departing_at: "2026-10-01T08:00:00",
            arriving_at: "2026-10-01T15:00:00",
            duration: "PT7H0M",
            origin: { iata_code: "LHR", name: "Heathrow" },
            destination: { iata_code: "JFK", name: "JFK" },
            marketing_carrier: { iata_code: "ZZ", name: "Duffel Airways" },
            operating_carrier: { iata_code: "ZZ", name: "Duffel Airways" },
            flight_number: "001",
          },
        ],
      },
    ],
    conditions: { refundable, changeable: false },
    passengers: [{ id: "pas_1", type: "adult" }],
  };
}

function makeTracked(overrides: Partial<TrackedSearchWithUser> = {}): TrackedSearchWithUser {
  return {
    id: "trk_1",
    origin: "LHR",
    destination: "JFK",
    departureDate: "2026-10-01",
    returnDate: null,
    passengers: JSON.stringify([{ type: "adult", count: 1 }]),
    cabinClass: null,
    preferRefundable: false,
    preferChangeable: false,
    departAfter: null,
    departBefore: null,
    maxConnections: null,
    lastKnownPrice: "300.00",
    lastKnownCurrency: "GBP",
    user: { email: "traveler@example.com", passengerProfile: { phone: "+441234567890" } },
    ...overrides,
  };
}

describe("comparePrices - pure comparison", () => {
  it("flags a drop when the new price is lower in the same currency", () => {
    const result = comparePrices("300.00", "GBP", "250.00", "GBP");
    expect(result.dropped).toBe(true);
  });

  it("does not flag a drop when the price rose", () => {
    const result = comparePrices("300.00", "GBP", "350.00", "GBP");
    expect(result.dropped).toBe(false);
  });

  it("does not flag a drop when the price is unchanged", () => {
    const result = comparePrices("300.00", "GBP", "300.00", "GBP");
    expect(result.dropped).toBe(false);
  });

  it("does not flag a drop across different currencies, even if the number is lower", () => {
    const result = comparePrices("300.00", "GBP", "100.00", "USD");
    expect(result.dropped).toBe(false);
  });
});

describe("trackedSearchToSearchParams", () => {
  it("builds SearchParams from a tracked search row, omitting nullable fields", () => {
    const params = trackedSearchToSearchParams(makeTracked());
    expect(params).toEqual({
      origin: "LHR",
      destination: "JFK",
      departure_date: "2026-10-01",
      passengers: [{ type: "adult", count: 1 }],
    });
  });

  it("includes return_date and cabin_class when present", () => {
    const params = trackedSearchToSearchParams(
      makeTracked({ returnDate: "2026-10-10", cabinClass: "business" })
    );
    expect(params.return_date).toBe("2026-10-10");
    expect(params.cabin_class).toBe("business");
  });

  it("carries over every preference filter the original search applied", () => {
    const params = trackedSearchToSearchParams(
      makeTracked({
        preferRefundable: true,
        preferChangeable: true,
        departAfter: "18:00",
        departBefore: "22:59",
        maxConnections: 0,
      })
    );
    expect(params.prefer_refundable).toBe(true);
    expect(params.prefer_changeable).toBe(true);
    expect(params.depart_after).toBe("18:00");
    expect(params.depart_before).toBe("22:59");
    expect(params.max_connections).toBe(0);
  });
});

describe("checkTrackedSearchForPriceDrop", () => {
  beforeEach(() => {
    mockCreateOfferRequest.mockReset();
    mockSendPriceDropAlert.mockReset();
    mockUpdate.mockReset();
  });

  it("sends a price drop alert and updates lastKnownPrice when the price fell", async () => {
    mockCreateOfferRequest.mockResolvedValueOnce([makeOffer("off_1", "220.00")]);

    const tracked = makeTracked({ lastKnownPrice: "300.00", lastKnownCurrency: "GBP" });
    const outcome = await checkTrackedSearchForPriceDrop(tracked);

    expect(outcome.dropped).toBe(true);
    expect(outcome.checked).toBe(true);
    expect(mockSendPriceDropAlert).toHaveBeenCalledWith(
      expect.objectContaining({
        trackedSearchId: "trk_1",
        previousAmount: "300.00",
        newAmount: "220.00",
        userEmail: "traveler@example.com",
        userPhone: "+441234567890",
      })
    );
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "trk_1" },
      data: { lastKnownPrice: "220.00", lastKnownCurrency: "GBP" },
    });
    // The baseline is persisted before the alert is sent, not after - so a
    // failure sending the alert can never leave the baseline stuck, which
    // would otherwise re-send an identical alert on the next run.
    expect(mockUpdate.mock.invocationCallOrder[0]).toBeLessThan(
      mockSendPriceDropAlert.mock.invocationCallOrder[0]
    );
  });

  it("does not send an alert when the price did not drop, but still refreshes the baseline", async () => {
    mockCreateOfferRequest.mockResolvedValueOnce([makeOffer("off_1", "350.00")]);

    const tracked = makeTracked({ lastKnownPrice: "300.00", lastKnownCurrency: "GBP" });
    const outcome = await checkTrackedSearchForPriceDrop(tracked);

    expect(outcome.dropped).toBe(false);
    expect(mockSendPriceDropAlert).not.toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "trk_1" },
      data: { lastKnownPrice: "350.00", lastKnownCurrency: "GBP" },
    });
  });

  it("returns checked:false and skips the DB update when no offers come back", async () => {
    mockCreateOfferRequest.mockResolvedValueOnce([]);

    const tracked = makeTracked();
    const outcome = await checkTrackedSearchForPriceDrop(tracked);

    expect(outcome.checked).toBe(false);
    expect(outcome.dropped).toBe(false);
    expect(mockSendPriceDropAlert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("picks the cheapest of several returned offers for comparison", async () => {
    mockCreateOfferRequest.mockResolvedValueOnce([
      makeOffer("off_1", "280.00"),
      makeOffer("off_2", "199.00"),
      makeOffer("off_3", "260.00"),
    ]);

    const tracked = makeTracked({ lastKnownPrice: "300.00", lastKnownCurrency: "GBP" });
    const outcome = await checkTrackedSearchForPriceDrop(tracked);

    expect(outcome.newAmount).toBe("199.00");
    expect(outcome.dropped).toBe(true);
  });

  it("applies the tracked search's own preference filters instead of comparing against an unfiltered cheapest", async () => {
    // Cheapest overall is non-refundable; only the pricier offer is refundable.
    mockCreateOfferRequest.mockResolvedValueOnce([
      makeOffer("cheap_nonref", "150.00", "GBP", false),
      makeOffer("pricier_ref", "280.00", "GBP", true),
    ]);

    const tracked = makeTracked({
      preferRefundable: true,
      lastKnownPrice: "300.00",
      lastKnownCurrency: "GBP",
    });
    const outcome = await checkTrackedSearchForPriceDrop(tracked);

    // Must compare against the refundable £280 fare, not the £150 one that
    // "refundable only" would have excluded from the original tracked search.
    expect(outcome.newAmount).toBe("280.00");
  });

  it("does not alert when no fare currently satisfies the tracked preference (filterByPreferences' own fallback)", async () => {
    // Zero refundable offers - filterByPreferences falls back to the full,
    // unfiltered list (its correct behavior for the interactive chat UI).
    mockCreateOfferRequest.mockResolvedValueOnce([
      makeOffer("cheap_nonref", "100.00", "GBP", false),
    ]);

    const tracked = makeTracked({
      preferRefundable: true,
      lastKnownPrice: "300.00",
      lastKnownCurrency: "GBP",
    });
    const outcome = await checkTrackedSearchForPriceDrop(tracked);

    // Must NOT report this £100 non-refundable fare as a "drop" for a
    // refundable-only tracked search, and must NOT touch the stored baseline.
    expect(outcome.checked).toBe(false);
    expect(outcome.dropped).toBe(false);
    expect(mockSendPriceDropAlert).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
