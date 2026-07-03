import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/duffel/client", () => ({
  duffelRequest: vi.fn(),
  requestLog: [],
}));

import { duffelRequest } from "@/lib/duffel/client";
import { getOfferWithServices, createOfferRequest } from "@/lib/duffel/search";
import type { SearchParams } from "@/lib/parser/types";

function makeRawOfferPayload(overrides: Record<string, unknown> = {}) {
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
            passengers: [
              {
                passenger_id: "pas_1",
                cabin_class: "economy",
                baggages: [
                  { type: "checked", quantity: 1 },
                  { type: "carry_on", quantity: 1 },
                ],
              },
            ],
          },
        ],
      },
    ],
    conditions: {
      refund_before_departure: { allowed: false },
      change_before_departure: { allowed: false },
    },
    passengers: [{ id: "pas_1", type: "adult" }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(duffelRequest).mockReset();
});

describe("included baggage normalization", () => {
  it("extracts checked and carry-on allowance from the first segment passenger", async () => {
    vi.mocked(duffelRequest).mockResolvedValueOnce({
      offers: [makeRawOfferPayload()],
    });

    const params: SearchParams = {
      origin: "LHR",
      destination: "JFK",
      departure_date: "2026-10-01",
      passengers: [{ type: "adult", count: 1 }],
    };

    const offers = await createOfferRequest(params);
    expect(offers[0].includedBaggage).toEqual({ checked: 1, carryOn: 1 });
  });

  it("is undefined when the raw segment carries no passenger baggage data", async () => {
    const raw = makeRawOfferPayload();
    (raw.slices[0].segments[0] as { passengers?: unknown }).passengers = undefined;
    vi.mocked(duffelRequest).mockResolvedValueOnce({ offers: [raw] });

    const params: SearchParams = {
      origin: "LHR",
      destination: "JFK",
      departure_date: "2026-10-01",
      passengers: [{ type: "adult", count: 1 }],
    };

    const offers = await createOfferRequest(params);
    expect(offers[0].includedBaggage).toBeUndefined();
  });

  it("is undefined (not a crash) when a passenger is present but its baggages field is missing", async () => {
    const raw = makeRawOfferPayload();
    (raw.slices[0].segments[0].passengers[0] as { baggages?: unknown }).baggages = undefined;
    vi.mocked(duffelRequest).mockResolvedValueOnce({ offers: [raw] });

    const params: SearchParams = {
      origin: "LHR",
      destination: "JFK",
      departure_date: "2026-10-01",
      passengers: [{ type: "adult", count: 1 }],
    };

    const offers = await createOfferRequest(params);
    expect(offers[0].includedBaggage).toBeUndefined();
  });
});

describe("refund/change fee normalization", () => {
  it("surfaces penalty_amount/penalty_currency as refundFee/changeFee when Duffel discloses them", async () => {
    const raw = makeRawOfferPayload({
      conditions: {
        refund_before_departure: {
          allowed: true,
          penalty_amount: "75.00",
          penalty_currency: "GBP",
        },
        change_before_departure: {
          allowed: true,
          penalty_amount: "50.00",
          penalty_currency: "GBP",
        },
      },
    });
    vi.mocked(duffelRequest).mockResolvedValueOnce({ offers: [raw] });

    const params: SearchParams = {
      origin: "LHR",
      destination: "JFK",
      departure_date: "2026-10-01",
      passengers: [{ type: "adult", count: 1 }],
    };

    const offers = await createOfferRequest(params);
    expect(offers[0].conditions).toEqual({
      refundable: true,
      changeable: true,
      refundFee: { amount: "75.00", currency: "GBP" },
      changeFee: { amount: "50.00", currency: "GBP" },
    });
  });

  it("is null when Duffel doesn't disclose a penalty amount, but allowed is still surfaced via the booleans", async () => {
    const raw = makeRawOfferPayload({
      conditions: {
        refund_before_departure: { allowed: true },
        change_before_departure: { allowed: false },
      },
    });
    vi.mocked(duffelRequest).mockResolvedValueOnce({ offers: [raw] });

    const params: SearchParams = {
      origin: "LHR",
      destination: "JFK",
      departure_date: "2026-10-01",
      passengers: [{ type: "adult", count: 1 }],
    };

    const offers = await createOfferRequest(params);
    expect(offers[0].conditions.refundable).toBe(true);
    expect(offers[0].conditions.changeable).toBe(false);
    expect(offers[0].conditions.refundFee).toBeNull();
    expect(offers[0].conditions.changeFee).toBeNull();
  });

  it("is null when the whole condition object is null (existing refundable/changeable behavior unaffected)", async () => {
    const raw = makeRawOfferPayload({
      conditions: {
        refund_before_departure: null,
        change_before_departure: null,
      },
    });
    vi.mocked(duffelRequest).mockResolvedValueOnce({ offers: [raw] });

    const params: SearchParams = {
      origin: "LHR",
      destination: "JFK",
      departure_date: "2026-10-01",
      passengers: [{ type: "adult", count: 1 }],
    };

    const offers = await createOfferRequest(params);
    expect(offers[0].conditions.refundable).toBe(false);
    expect(offers[0].conditions.changeable).toBe(false);
    expect(offers[0].conditions.refundFee).toBeNull();
    expect(offers[0].conditions.changeFee).toBeNull();
  });

  it("existing refundable: false / changeable: false fixture still normalizes unchanged", async () => {
    vi.mocked(duffelRequest).mockResolvedValueOnce({
      offers: [makeRawOfferPayload()],
    });

    const params: SearchParams = {
      origin: "LHR",
      destination: "JFK",
      departure_date: "2026-10-01",
      passengers: [{ type: "adult", count: 1 }],
    };

    const offers = await createOfferRequest(params);
    expect(offers[0].conditions.refundable).toBe(false);
    expect(offers[0].conditions.changeable).toBe(false);
  });
});

describe("getOfferWithServices", () => {
  it("requests return_available_services and normalizes services", async () => {
    vi.mocked(duffelRequest).mockResolvedValueOnce(
      makeRawOfferPayload({
        available_services: [
          {
            id: "ser_bag",
            type: "baggage",
            total_amount: "35.00",
            total_currency: "GBP",
            maximum_quantity: 1,
            metadata: { maximum_weight_kg: 23 },
          },
          {
            id: "ser_seat",
            type: "seat",
            total_amount: "12.00",
            total_currency: "GBP",
            maximum_quantity: 1,
            metadata: { designator: "14C" },
          },
        ],
      })
    );

    const offer = await getOfferWithServices("off_1");

    expect(vi.mocked(duffelRequest)).toHaveBeenCalledWith(
      "/air/offers/off_1",
      expect.objectContaining({ params: { return_available_services: true } })
    );
    expect(offer.services).toEqual([
      { id: "ser_bag", type: "baggage", amount: "35.00", currency: "GBP", label: "Extra checked bag (23kg)" },
      { id: "ser_seat", type: "seat", amount: "12.00", currency: "GBP", label: "Seat 14C" },
    ]);
  });

  it("omits services entirely when the offer has none", async () => {
    vi.mocked(duffelRequest).mockResolvedValueOnce(makeRawOfferPayload());

    const offer = await getOfferWithServices("off_1");
    expect(offer.services).toBeUndefined();
  });
});
