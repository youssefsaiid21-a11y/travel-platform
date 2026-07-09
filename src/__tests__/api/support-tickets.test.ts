import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockCreate = vi.hoisted(() => vi.fn());
const mockEnforceRateLimit = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());
const mockSendAlertEmail = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    supportTicket: {
      create: mockCreate,
    },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mockEnforceRateLimit,
}));

vi.mock("@vercel/analytics/server", () => ({
  track: mockTrack,
}));

vi.mock("@/lib/notifications/email", () => ({
  sendAlertEmail: mockSendAlertEmail,
}));

import { POST } from "@/app/api/support-tickets/route";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/support-tickets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCreate.mockReset();
  mockEnforceRateLimit.mockReset().mockResolvedValue(null);
  mockTrack.mockReset().mockResolvedValue(undefined);
  mockSendAlertEmail.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/support-tickets", () => {
  it("creates a ticket and returns 201 on valid input", async () => {
    mockCreate.mockResolvedValueOnce({ id: "tick_1", bookingRef: null });

    const res = await POST(
      makeRequest({ email: "user@example.com", subject: "Help", message: "Something is broken" })
    );

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toBe("tick_1");
    expect(mockCreate).toHaveBeenCalledWith({
      data: {
        email: "user@example.com",
        subject: "Help",
        message: "Something is broken",
        bookingRef: null,
      },
    });
    expect(mockSendAlertEmail).toHaveBeenCalledWith(
      expect.stringContaining("Help"),
      expect.stringContaining("user@example.com")
    );
  });

  it("rejects an invalid email", async () => {
    const res = await POST(
      makeRequest({ email: "not-an-email", subject: "Help", message: "Something is broken" })
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects an empty subject", async () => {
    const res = await POST(
      makeRequest({ email: "user@example.com", subject: "  ", message: "Something is broken" })
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a message over 5000 characters", async () => {
    const res = await POST(
      makeRequest({
        email: "user@example.com",
        subject: "Help",
        message: "x".repeat(5001),
      })
    );
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns the rate-limited response when enforceRateLimit blocks", async () => {
    const limited = new Response(null, { status: 429 });
    mockEnforceRateLimit.mockResolvedValueOnce(limited);

    const res = await POST(
      makeRequest({ email: "user@example.com", subject: "Help", message: "Something is broken" })
    );
    expect(res.status).toBe(429);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
