import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockConstructEvent = vi.hoisted(() => vi.fn());
const mockUpdateMany = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());

vi.mock("stripe", () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mockConstructEvent };
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    booking: { updateMany: mockUpdateMany, findFirst: mockFindFirst },
  },
}));

vi.mock("@/lib/notifications", () => ({
  sendBookingConfirmations: vi.fn().mockResolvedValue(undefined),
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

const MOCK_PI_ID = "pi_test_webhookpayment";

beforeEach(() => {
  mockConstructEvent.mockReset();
  mockUpdateMany.mockReset();
  mockFindFirst.mockReset();
  mockFindFirst.mockResolvedValue(null); // no booking by default - notifications skipped
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
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });

  it("returns 200 received:true for handled events", async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: "payment_intent.succeeded",
      data: { object: { id: MOCK_PI_ID } },
    });
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
  });

  it("updates booking status to confirmed on payment_intent.succeeded", async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: "payment_intent.succeeded",
      data: { object: { id: MOCK_PI_ID } },
    });
    mockUpdateMany.mockResolvedValueOnce({ count: 1 });

    await POST(makeRequest("{}"));

    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { stripePaymentIntentId: MOCK_PI_ID, status: "pending" },
      data: { status: "confirmed" },
    });
  });

  it("returns 200 without touching DB for unhandled event types", async () => {
    mockConstructEvent.mockReturnValueOnce({
      type: "charge.succeeded",
      data: { object: {} },
    });

    const res = await POST(makeRequest("{}"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.received).toBe(true);
    expect(mockUpdateMany).not.toHaveBeenCalled();
  });
});
