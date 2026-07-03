import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
const mockPaymentIntentsCreate = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: mockAuth }));

vi.mock("stripe", () => ({
  default: class MockStripe {
    paymentIntents = { create: mockPaymentIntentsCreate };
  },
}));

import { POST } from "@/app/api/stripe/payment-intent/route";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/stripe/payment-intent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockPaymentIntentsCreate.mockReset();
});

describe("POST /api/stripe/payment-intent", () => {
  const VALID_BODY = { amount: "342.50", currency: "GBP", offerId: "off_abc123" };

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(401);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns clientSecret on success", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    mockPaymentIntentsCreate.mockResolvedValueOnce({ client_secret: "pi_test_secret_xyz" });

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.clientSecret).toBe("pi_test_secret_xyz");
  });

  it("creates payment intent with correct amount in cents", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    mockPaymentIntentsCreate.mockResolvedValueOnce({ client_secret: "pi_test_secret" });

    await POST(makeRequest({ amount: "342.50", currency: "GBP", offerId: "off_abc123" }));

    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 34250,
        currency: "gbp",
      })
    );
  });

  it("attaches userId and offerId to payment intent metadata", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_test_42" } });
    mockPaymentIntentsCreate.mockResolvedValueOnce({ client_secret: "pi_test_secret" });

    await POST(makeRequest({ amount: "100.00", currency: "USD", offerId: "off_xyz" }));

    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: { userId: "usr_test_42", offerId: "off_xyz" },
      })
    );
  });

  it("returns 400 when offerId is missing", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    const res = await POST(makeRequest({ amount: "100.00", currency: "GBP" }));
    expect(res.status).toBe(400);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when amount is missing", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    const res = await POST(makeRequest({ currency: "GBP", offerId: "off_abc" }));
    expect(res.status).toBe(400);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when amount is zero", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    const res = await POST(makeRequest({ amount: "0", currency: "GBP", offerId: "off_abc" }));
    expect(res.status).toBe(400);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when amount is not a number", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    const res = await POST(makeRequest({ amount: "not-a-number", currency: "GBP", offerId: "off_abc" }));
    expect(res.status).toBe(400);
    expect(mockPaymentIntentsCreate).not.toHaveBeenCalled();
  });

  it("returns 502 when Stripe throws", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    mockPaymentIntentsCreate.mockRejectedValueOnce(new Error("Stripe network error"));

    const res = await POST(makeRequest(VALID_BODY));
    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.error).toMatch(/Stripe network error/);
  });

  it("lowercases the currency when calling Stripe", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: "usr_1" } });
    mockPaymentIntentsCreate.mockResolvedValueOnce({ client_secret: "pi_test_secret" });

    await POST(makeRequest({ amount: "50.00", currency: "EUR", offerId: "off_abc" }));

    expect(mockPaymentIntentsCreate).toHaveBeenCalledWith(
      expect.objectContaining({ currency: "eur" })
    );
  });
});
