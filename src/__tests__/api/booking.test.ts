import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import type { NormalizedOffer } from "@/lib/duffel/types";

const mockAuth = vi.hoisted(() => vi.fn());
const mockDuffelRequest = vi.hoisted(() => vi.fn());
const mockGetOfferWithServices = vi.hoisted(() => vi.fn());
const mockPaymentIntentsRetrieve = vi.hoisted(() => vi.fn());
const mockBookingCreate = vi.hoisted(() => vi.fn());
const mockBookingUpdate = vi.hoisted(() => vi.fn());
const mockBookingFindFirst = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: mockAuth }));

vi.mock("@/lib/db", () => ({
  db: {
    booking: {
      create: mockBookingCreate,
      update: mockBookingUpdate,
      findFirst: mockBookingFindFirst,
    },
  },
}));

vi.mock("@/lib/duffel/client", async () => {
  const actual = await vi.importActual<typeof import("@/lib/duffel/client")>(
    "@/lib/duffel/client"
  );
  return {
    ...actual,
    duffelRequest: mockDuffelRequest,
  };
});

vi.mock("@/lib/duffel/search", () => ({
  getOfferWithServices: mockGetOfferWithServices,
}));

vi.mock("stripe", () => ({
  default: class MockStripe {
    paymentIntents = { retrieve: mockPaymentIntentsRetrieve };
  },
}));

import { POST } from "@/app/api/booking/route";
import { DuffelError } from "@/lib/duffel/client";

const USER_ID = "usr_owner_001";
const OFFER_ID = "off_abc123";
const PI_ID = "pi_test_001";
const PENDING_BOOKING_ID = "bkng_pending_001";

function uniqueConstraintError() {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "6.19.3",
  });
}

function makeOffer(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    id: OFFER_ID,
    expires_at: "2026-08-01T00:00:00Z",
    total_amount: "342.50",
    total_currency: "GBP",
    base_amount: "300.00",
    tax_amount: "42.50",
    owner: { iata_code: "ZZ", name: "Duffel Airways" },
    slices: [],
    conditions: { refundable: false, changeable: false },
    passengers: [{ id: "pas_1", type: "adult" }],
    ...overrides,
  };
}

function makeSucceededPaymentIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: PI_ID,
    status: "succeeded",
    amount: 34250,
    currency: "gbp",
    metadata: { userId: USER_ID, offerId: OFFER_ID },
    ...overrides,
  };
}

const PASSENGER = {
  id: "pas_1",
  given_name: "Jane",
  family_name: "Smith",
  born_on: "1990-01-01",
  gender: "f" as const,
  title: "ms" as const,
  email: "jane@example.com",
  phone_number: "+15555550100",
  nationality: "GB",
  passport_number: "123456789",
  passport_expiry: "2035-01-01",
};

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/booking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function baseBody(overrides: Record<string, unknown> = {}) {
  return {
    offerId: OFFER_ID,
    searchParams: { origin: "LHR", destination: "JFK" },
    passengers: [PASSENGER],
    stripePaymentIntentId: PI_ID,
    ...overrides,
  };
}

beforeEach(() => {
  mockAuth.mockReset();
  mockDuffelRequest.mockReset();
  mockGetOfferWithServices.mockReset();
  mockPaymentIntentsRetrieve.mockReset();
  mockBookingCreate.mockReset();
  mockBookingUpdate.mockReset();
  mockBookingFindFirst.mockReset();
  // Default: claiming the PaymentIntent succeeds (no concurrent request has
  // already claimed it), producing a fresh "pending" row.
  mockBookingCreate.mockImplementation(async ({ data }: { data: object }) => ({
    id: PENDING_BOOKING_ID,
    status: "pending",
    ...data,
  }));
  mockBookingUpdate.mockImplementation(async ({ data }: { data: object }) => ({
    id: PENDING_BOOKING_ID,
    ...data,
  }));
});

describe("POST /api/booking", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(baseBody()));
    expect(res.status).toBe(401);
    expect(mockGetOfferWithServices).not.toHaveBeenCalled();
  });

  it("returns 400 when the payment has not succeeded", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(
      makeSucceededPaymentIntent({ status: "requires_payment_method" })
    );
    const res = await POST(makeRequest(baseBody()));
    expect(res.status).toBe(400);
    expect(mockGetOfferWithServices).not.toHaveBeenCalled();
  });

  it("returns 403 when the payment intent belongs to a different user", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(
      makeSucceededPaymentIntent({ metadata: { userId: "usr_other", offerId: OFFER_ID } })
    );
    const res = await POST(makeRequest(baseBody()));
    expect(res.status).toBe(403);
  });

  it("returns 400 when the payment intent was created for a different offer", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(
      makeSucceededPaymentIntent({ metadata: { userId: USER_ID, offerId: "off_different" } })
    );
    const res = await POST(makeRequest(baseBody()));
    expect(res.status).toBe(400);
    expect(mockGetOfferWithServices).not.toHaveBeenCalled();
  });

  it("returns 410 when the offer is no longer available on Duffel, but still records the charge for audit/refund", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(makeSucceededPaymentIntent());
    mockGetOfferWithServices.mockRejectedValueOnce(
      new DuffelError(
        {
          errors: [{ code: "not_found", type: "invalid_request_error", title: "Not found", message: "Not found", documentation_url: "" }],
          meta: { request_id: "req_1", status: 404 },
        },
        404
      )
    );
    const res = await POST(makeRequest(baseBody()));
    expect(res.status).toBe(410);
    expect(mockDuffelRequest).not.toHaveBeenCalled();
    // Stripe already charged the card by this point - refusing the booking
    // must not also lose the paper trail for a manual refund.
    expect(mockBookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PENDING_BOOKING_ID },
        data: expect.objectContaining({ status: "failed" }),
      })
    );
  });

  it("returns 502 when the offer cannot otherwise be verified, but still records the charge", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(makeSucceededPaymentIntent());
    mockGetOfferWithServices.mockRejectedValueOnce(new Error("network down"));
    const res = await POST(makeRequest(baseBody()));
    expect(res.status).toBe(502);
    expect(mockBookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "failed" }),
      })
    );
  });

  it("rejects the booking when the charged amount does not match the offer's real price (tamper protection), but still records the charge", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    // Attacker charged only $0.01 but presents a genuine, expensive offerId.
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(
      makeSucceededPaymentIntent({ amount: 1, currency: "gbp" })
    );
    mockGetOfferWithServices.mockResolvedValueOnce(
      makeOffer({ total_amount: "342.50", total_currency: "GBP" })
    );

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/does not match/i);
    expect(mockDuffelRequest).not.toHaveBeenCalled();
    expect(mockBookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "failed",
          totalAmount: "342.50",
          totalCurrency: "GBP",
        }),
      })
    );
  });

  it("rejects the booking when the charged currency does not match the offer's currency", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(
      makeSucceededPaymentIntent({ amount: 34250, currency: "usd" })
    );
    mockGetOfferWithServices.mockResolvedValueOnce(
      makeOffer({ total_amount: "342.50", total_currency: "GBP" })
    );

    const res = await POST(makeRequest(baseBody()));
    expect(res.status).toBe(400);
    expect(mockDuffelRequest).not.toHaveBeenCalled();
  });

  it("claims the payment intent with a pending row, then updates it to confirmed when the amount matches", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(makeSucceededPaymentIntent());
    mockGetOfferWithServices.mockResolvedValueOnce(makeOffer());
    mockDuffelRequest.mockResolvedValueOnce({ id: "ord_001", booking_reference: "DUF123" });

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.booking.duffelOrderId).toBe("ord_001");
    expect(body.booking.status).toBe("confirmed");
    expect(mockBookingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: USER_ID, status: "pending", stripePaymentIntentId: PI_ID }),
      })
    );
    expect(mockBookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: PENDING_BOOKING_ID },
        data: expect.objectContaining({
          totalAmount: "342.50",
          totalCurrency: "GBP",
          duffelOrderId: "ord_001",
          duffelBookingRef: "DUF123",
          status: "confirmed",
        }),
      })
    );
  });

  it("uses the server-verified offer price for the Duffel order payment, not any client input", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(makeSucceededPaymentIntent());
    mockGetOfferWithServices.mockResolvedValueOnce(
      makeOffer({ total_amount: "342.50", total_currency: "GBP" })
    );
    mockDuffelRequest.mockResolvedValueOnce({ id: "ord_001", booking_reference: "DUF123" });

    await POST(makeRequest(baseBody()));

    expect(mockDuffelRequest).toHaveBeenCalledWith(
      "/air/orders",
      expect.objectContaining({
        body: expect.objectContaining({
          data: expect.objectContaining({
            payments: [{ type: "balance", amount: "342.50", currency: "GBP" }],
          }),
        }),
      })
    );
  });

  it("sends the passenger's passport as an identity_documents entry on the Duffel order", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(makeSucceededPaymentIntent());
    mockGetOfferWithServices.mockResolvedValueOnce(makeOffer());
    mockDuffelRequest.mockResolvedValueOnce({ id: "ord_001", booking_reference: "DUF123" });

    await POST(makeRequest(baseBody()));

    expect(mockDuffelRequest).toHaveBeenCalledWith(
      "/air/orders",
      expect.objectContaining({
        body: expect.objectContaining({
          data: expect.objectContaining({
            passengers: [
              expect.objectContaining({
                identity_documents: [
                  {
                    type: "passport",
                    unique_identifier: "123456789",
                    expires_on: "2035-01-01",
                    issuing_country_code: "GB",
                  },
                ],
              }),
            ],
          }),
        }),
      })
    );
  });

  it("trims whitespace from the passport number before sending it to Duffel", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(makeSucceededPaymentIntent());
    mockGetOfferWithServices.mockResolvedValueOnce(makeOffer());
    mockDuffelRequest.mockResolvedValueOnce({ id: "ord_001", booking_reference: "DUF123" });

    await POST(makeRequest(baseBody({
      passengers: [{ ...PASSENGER, passport_number: "  123456789  " }],
    })));

    expect(mockDuffelRequest).toHaveBeenCalledWith(
      "/air/orders",
      expect.objectContaining({
        body: expect.objectContaining({
          data: expect.objectContaining({
            passengers: [
              expect.objectContaining({
                identity_documents: [
                  expect.objectContaining({ unique_identifier: "123456789" }),
                ],
              }),
            ],
          }),
        }),
      })
    );
  });

  it("rejects the booking before touching Stripe or Duffel when a passenger is missing passport info", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    const noDocs = {
      id: PASSENGER.id,
      given_name: PASSENGER.given_name,
      family_name: PASSENGER.family_name,
      born_on: PASSENGER.born_on,
      gender: PASSENGER.gender,
      title: PASSENGER.title,
      email: PASSENGER.email,
      phone_number: PASSENGER.phone_number,
    };

    const res = await POST(makeRequest(baseBody({ passengers: [noDocs] })));

    expect(res.status).toBe(400);
    expect(mockPaymentIntentsRetrieve).not.toHaveBeenCalled();
    expect(mockBookingCreate).not.toHaveBeenCalled();
    expect(mockDuffelRequest).not.toHaveBeenCalled();
  });

  it("rejects the booking when the passenger's passport is already expired", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    const res = await POST(
      makeRequest(baseBody({ passengers: [{ ...PASSENGER, passport_expiry: "2020-01-01" }] }))
    );

    expect(res.status).toBe(400);
    expect(mockBookingCreate).not.toHaveBeenCalled();
  });

  it("rejects the booking when nationality isn't a valid country code", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    const res = await POST(
      makeRequest(baseBody({ passengers: [{ ...PASSENGER, nationality: "United Kingdom" }] }))
    );

    expect(res.status).toBe(400);
    expect(mockBookingCreate).not.toHaveBeenCalled();
  });

  it("still records a failed booking when Duffel order creation fails, without erroring the request", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(makeSucceededPaymentIntent());
    mockGetOfferWithServices.mockResolvedValueOnce(makeOffer());
    mockDuffelRequest.mockRejectedValueOnce(new Error("Duffel is down"));

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.booking.status).toBe("failed");
    expect(body.booking.duffelOrderId).toBeNull();
  });

  it("returns the existing confirmed booking instead of creating a duplicate when the payment intent was already fully processed (idempotency)", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(makeSucceededPaymentIntent());
    // Simulates a concurrent/earlier request having already claimed and
    // completed this exact PaymentIntent - the DB's unique constraint
    // rejects this request's own claim attempt.
    mockBookingCreate.mockRejectedValueOnce(uniqueConstraintError());
    mockBookingFindFirst.mockResolvedValueOnce({ id: "bkng_existing_001", status: "confirmed" });

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.booking.id).toBe("bkng_existing_001");
    expect(mockBookingFindFirst).toHaveBeenCalledWith({
      where: { stripePaymentIntentId: PI_ID, userId: USER_ID },
    });
    expect(mockGetOfferWithServices).not.toHaveBeenCalled();
    expect(mockDuffelRequest).not.toHaveBeenCalled();
  });

  it("returns 409 (not 200) when the existing booking for this payment intent never completed", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(makeSucceededPaymentIntent());
    mockBookingCreate.mockRejectedValueOnce(uniqueConstraintError());
    mockBookingFindFirst.mockResolvedValueOnce({ id: "bkng_existing_001", status: "failed" });

    const res = await POST(makeRequest(baseBody()));

    expect(res.status).toBe(409);
    expect(mockGetOfferWithServices).not.toHaveBeenCalled();
  });

  it("propagates an unexpected error from the claim step instead of swallowing it as a duplicate", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockPaymentIntentsRetrieve.mockResolvedValueOnce(makeSucceededPaymentIntent());
    mockBookingCreate.mockRejectedValueOnce(new Error("connection reset"));

    await expect(POST(makeRequest(baseBody()))).rejects.toThrow("connection reset");
  });
});

describe("POST /api/booking rate limiting (outside test NODE_ENV)", () => {
  const RATE_LIMITED_USER = "usr_rate_limit_target";

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.stubEnv("NODE_ENV", "test");
  });

  it("returns 429 after too many booking attempts from the same user", async () => {
    mockAuth.mockResolvedValue({ user: { id: RATE_LIMITED_USER } });
    mockPaymentIntentsRetrieve.mockResolvedValue(
      makeSucceededPaymentIntent({ metadata: { userId: RATE_LIMITED_USER, offerId: OFFER_ID } })
    );
    mockGetOfferWithServices.mockResolvedValue(makeOffer());
    mockDuffelRequest.mockResolvedValue({ id: "ord_001", booking_reference: "DUF123" });

    let lastRes;
    for (let i = 0; i < 6; i++) {
      lastRes = await POST(makeRequest(baseBody()));
    }

    expect(lastRes!.status).toBe(429);
  });
});
