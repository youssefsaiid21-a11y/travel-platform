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

function makeOffer(id: string, totalAmount: string, currency = "GBP"): NormalizedOffer {
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
    conditions: { refundable: false, changeable: false },
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
});
