import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import type { NormalizedOffer } from "@/lib/duffel/types";

const mockAuth = vi.hoisted(() => vi.fn());
const mockPaymentIntentsCreate = vi.hoisted(() => vi.fn());
const mockGetOfferWithServices = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: mockAuth }));

vi.mock("stripe", () => ({
  default: class MockStripe {
    paymentIntents = { create: mockPaymentIntentsCreate };
  },
}));

vi.mock("@/lib/duffel/search", () => ({
  getOfferWithServices: mockGetOfferWithServices,
}));

import { POST } from "@/app/api/stripe/payment-intent/route";
import { DuffelError } from "@/lib/duffel/client";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/stripe/payment-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeOffer(overrides: Partial<NormalizedOffer> = {}): NormalizedOffer {
  return {
    id: "off_abc123",
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

beforeEach(() => {
  mockAuth.mockReset();
  mockPaymentIntentsCreate.mockReset();
  mockGetOfferWithServices.mockReset();
});

describe("POST /api/stripe/payment-intent", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ offerId: "off_abc123" }));
    expect(res.status).toBe(401);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns clientSecret on success", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    mockGetOfferWithServices.mockResolvedValueOnce(makeOffer());
    mockPaymentIntentsCreate.mockResolvedValueOnce({ client_secret: "pi_test_secret_xyz" });

    const res = await POST(makeRequest({ offerId: "off_abc123" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clientSecret).toBe("pi_test_secret_xyz");
  });

  it("uses the server-fetched offer's price, ignoring any client-supplied amount", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    mockGetOfferWithServices.mockResolvedValueOnce(
      makeOffer({ total_amount: "342.50", total_currency: "GBP" })
    );
    mockPaymentIntentsCreate.mockResolvedValueOnce({ client_secret: "pi_test_secret" });

    // A tampered request trying to pay $0.01 for the same real offerId.
    await POST(makeRequest({ offerId: "off_abc123", amount: "0.01", currency: "USD" }));

    expect(mockGetOfferWithServices).toHaveBeenCalledWith("off_abc123");
    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 34250, currency: "gbp" })
    );
  });

  it("attaches userId and offerId to payment intent metadata", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_test_42" } });
    mockGetOfferWithServices.mockResolvedValueOnce(makeOffer({ id: "off_xyz" }));
    mockPaymentIntentsCreate.mockResolvedValueOnce({ client_secret: "pi_test_secret" });

    await POST(makeRequest({ offerId: "off_xyz" }));

    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { userId: "usr_test_42", offerId: "off_xyz" },
      })
    );
  });

  it("returns 400 when offerId is missing", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockGetOfferWithServices).not.toHaveBeenCalled();
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns 410 when the offer no longer exists on Duffel", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    mockGetOfferWithServices.mockRejectedValueOnce(
      new DuffelError(
        {
          errors: [{ code: "not_found", type: "invalid_request_error", title: "Not found", message: "Not found", documentation_url: "" }],
          meta: { request_id: "req_1", status: 404 },
        },
        404
      )
    );

    const res = await POST(makeRequest({ offerId: "off_expired" }));
    expect(res.status).toBe(410);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when the offer's amount is invalid", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    mockGetOfferWithServices.mockResolvedValueOnce(makeOffer({ total_amount: "not-a-number" }));

    const res = await POST(makeRequest({ offerId: "off_abc123" }));
    expect(res.status).toBe(400);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns 502 when Stripe throws", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    mockGetOfferWithServices.mockResolvedValueOnce(makeOffer());
    mockPaymentIntentsCreate.mockRejectedValueOnce(new Error("Stripe network error"));

    const res = await POST(makeRequest({ offerId: "off_abc123" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Stripe network error/);
  });

  it("returns 502 when the offer lookup fails for a non-Duffel-error reason", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    mockGetOfferWithServices.mockRejectedValueOnce(new Error("network timeout"));

    const res = await POST(makeRequest({ offerId: "off_abc123" }));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Could not verify the offer price/);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("lowercases the currency when calling Stripe", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    mockGetOfferWithServices.mockResolvedValueOnce(makeOffer({ total_currency: "EUR" }));
    mockPaymentIntentsCreate.mockResolvedValueOnce({ client_secret: "pi_test_secret" });

    await POST(makeRequest({ offerId: "off_abc123" }));

    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "eur" })
    );
  });
});
