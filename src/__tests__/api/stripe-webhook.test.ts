import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockConstructEvent = vi.hoisted(() => vi.fn());

vi.mock("stripe", () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mockConstructEvent };
  },
}));

import { POST } from "@/app/api/stripe/webhook/route";

function makeRequest(body: string, sig = "valid-sig") {
  return new NextRequest("http://localhost/api/stripe/webhook", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "stripe-signature": sig,
    },
    body,
  });
}

beforeEach(() => {
  mockConstructEvent.mockReset();
});

describe("POST /api/stripe/webhook", () => {
  it("returns 400 when signature is invalid", async () => {
    mockConstructEvent.mockImplementation(() => {
      throw new Error("No signatures found");
    });
    const res = await POST(makeRequest("{}", "bad-sig"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/signature/i);
  });

  // Booking confirmation (status transition + notifications) moved to
  // POST /api/booking, the only place that actually knows a Duffel order
  // succeeded - see src/app/api/booking/route.ts and its tests. This
  // handler's only remaining job is verifying the request came from Stripe.
  it("returns 200 received:true once the signature verifies, regardless of event type", async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: "payment_intent.succeeded",
      data: { object: { id: "pi_test_webhookpayment" } },
    });

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });

  it("returns 200 for unhandled event types too", async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: "charge.succeeded",
      data: { object: {} },
    });

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });
});
