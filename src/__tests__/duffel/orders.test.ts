import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NormalizedOffer, NormalizedOrder } from "@/lib/duffel/types";

// Mock the duffel client so getOrderStatus doesn't hit the network
vi.mock("@/lib/duffel/client", () => ({
  duffelRequest: vi.fn(),
  requestLog: [],
}));

import { duffelRequest } from "@/lib/duffel/client";
import { getOrderStatus, checkForScheduleChanges } from "@/lib/duffel/orders";

function makeSegment(overrides: Partial<NormalizedOffer["slices"][number]["segments"][number]> = {}) {
  return {
    departing_at: "2026-10-01T08:00:00",
    arriving_at: "2026-10-01T15:00:00",
    duration: "PT7H0M",
    origin: { iata_code: "LHR", name: "Heathrow" },
    destination: { iata_code: "JFK", name: "JFK" },
    marketing_carrier: { iata_code: "ZZ", name: "Duffel Airways" },
    operating_carrier: { iata_code: "ZZ", name: "Duffel Airways" },
    flight_number: "001",
    ...overrides,
  };
}

function makeOffer(segmentOverrides: Partial<ReturnType<typeof makeSegment>> = {}): NormalizedOffer {
  return {
    id: "off_1",
    expires_at: "2026-08-01T00:00:00Z",
    total_amount: "200.00",
    total_currency: "GBP",
    base_amount: "180.00",
    tax_amount: "20.00",
    owner: { iata_code: "ZZ", name: "Duffel Airways" },
    slices: [
      {
        duration: "PT7H0M",
        stops: 0,
        segments: [makeSegment(segmentOverrides)],
      },
    ],
    conditions: { refundable: false, changeable: false },
    passengers: [{ id: "pas_1", type: "adult" }],
  };
}

function makeOrder(
  segmentOverrides: Partial<ReturnType<typeof makeSegment>> = {},
  airlineInitiatedChanges: NormalizedOrder["airlineInitiatedChanges"] = []
): NormalizedOrder {
  return {
    id: "ord_1",
    bookingReference: "ABC123",
    slices: [
      {
        duration: "PT7H0M",
        stops: 0,
        segments: [makeSegment(segmentOverrides)],
      },
    ],
    airlineInitiatedChanges,
  };
}

describe("checkForScheduleChanges - pure diff function", () => {
  it("reports no changes when times are identical", () => {
    const offer = makeOffer();
    const order = makeOrder();
    const result = checkForScheduleChanges(offer, order);
    expect(result.hasChanges).toBe(false);
    expect(result.segmentChanges).toHaveLength(0);
    expect(result.hasPendingAirlineChange).toBe(false);
  });

  it("detects a departure time change", () => {
    const offer = makeOffer();
    const order = makeOrder({ departing_at: "2026-10-01T10:30:00", arriving_at: "2026-10-01T17:30:00" });
    const result = checkForScheduleChanges(offer, order);
    expect(result.hasChanges).toBe(true);
    expect(result.segmentChanges).toHaveLength(1);
    expect(result.segmentChanges[0]).toMatchObject({
      origin: "LHR",
      destination: "JFK",
      flightNumber: "ZZ001",
      originalDepartingAt: "2026-10-01T08:00:00",
      currentDepartingAt: "2026-10-01T10:30:00",
    });
  });

  it("flags a pending airline-initiated change even with no time diff", () => {
    const offer = makeOffer();
    const order = makeOrder({}, [
      { id: "aic_1", actionTaken: null, createdAt: "2026-07-01T00:00:00Z" },
    ]);
    const result = checkForScheduleChanges(offer, order);
    expect(result.hasChanges).toBe(false);
    expect(result.hasPendingAirlineChange).toBe(true);
  });

  it("does not flag an already-actioned airline-initiated change", () => {
    const offer = makeOffer();
    const order = makeOrder({}, [
      { id: "aic_1", actionTaken: "accepted", createdAt: "2026-07-01T00:00:00Z" },
    ]);
    const result = checkForScheduleChanges(offer, order);
    expect(result.hasPendingAirlineChange).toBe(false);
  });

  it("skips segments that don't exist on the current order (no crash on length mismatch)", () => {
    const offer = makeOffer();
    const order: NormalizedOrder = { ...makeOrder(), slices: [] };
    const result = checkForScheduleChanges(offer, order);
    expect(result.hasChanges).toBe(false);
    expect(result.segmentChanges).toHaveLength(0);
  });
});

describe("getOrderStatus", () => {
  beforeEach(() => {
    vi.mocked(duffelRequest).mockReset();
  });

  it("normalizes a raw order response, including airline_initiated_changes", async () => {
    vi.mocked(duffelRequest).mockResolvedValueOnce({
      id: "ord_1",
      booking_reference: "ABC123",
      live_mode: false,
      slices: [
        {
          duration: "PT7H0M",
          segments: [
            {
              departing_at: "2026-10-01T08:00:00",
              arriving_at: "2026-10-01T15:00:00",
              duration: "PT7H0M",
              origin: { iata_code: "LHR", name: "Heathrow" },
              destination: { iata_code: "JFK", name: "JFK" },
              marketing_carrier: { iata_code: "ZZ", name: "Duffel Airways" },
              marketing_carrier_flight_number: "001",
              operating_carrier: { iata_code: "ZZ", name: "Duffel Airways" },
              operating_carrier_flight_number: "001",
              stops: [],
            },
          ],
        },
      ],
      airline_initiated_changes: [
        {
          id: "aic_1",
          order_id: "ord_1",
          action_taken: null,
          created_at: "2026-07-01T00:00:00Z",
          added: [],
          removed: [],
        },
      ],
    });

    const order = await getOrderStatus("ord_1");

    expect(duffelRequest).toHaveBeenCalledWith("/air/orders/ord_1");
    expect(order.id).toBe("ord_1");
    expect(order.bookingReference).toBe("ABC123");
    expect(order.slices[0].segments[0].flight_number).toBe("001");
    expect(order.airlineInitiatedChanges).toEqual([
      { id: "aic_1", actionTaken: null, createdAt: "2026-07-01T00:00:00Z" },
    ]);
  });
});
