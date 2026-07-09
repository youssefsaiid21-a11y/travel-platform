import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const mockCreate = vi.hoisted(() => vi.fn());
const mockEnforceRateLimit = vi.hoisted(() => vi.fn());
const mockTrack = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    waitlistSignup: {
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

import { POST } from "@/app/api/waitlist/route";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/waitlist", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockCreate.mockReset();
  mockEnforceRateLimit.mockReset().mockResolvedValue(null);
  mockTrack.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/waitlist", () => {
  it("creates a signup and returns 201 on valid input", async () => {
    mockCreate.mockResolvedValueOnce({ id: "wl_1" });

    const res = await POST(makeRequest({ email: "user@example.com", channel: "seo" }));

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith({
      data: { email: "user@example.com", channel: "seo" },
    });
  });

  it("defaults channel to 'direct' when omitted", async () => {
    mockCreate.mockResolvedValueOnce({ id: "wl_1" });

    await POST(makeRequest({ email: "user@example.com" }));

    expect(mockCreate).toHaveBeenCalledWith({
      data: { email: "user@example.com", channel: "direct" },
    });
  });

  it("rejects an invalid email", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("treats a duplicate email as success, not an error", async () => {
    mockCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "6.19.3",
      })
    );

    const res = await POST(makeRequest({ email: "user@example.com" }));
    expect(res.status).toBe(201);
  });

  it("returns the rate-limited response when enforceRateLimit blocks", async () => {
    const limited = new Response(null, { status: 429 });
    mockEnforceRateLimit.mockResolvedValueOnce(limited);

    const res = await POST(makeRequest({ email: "user@example.com" }));
    expect(res.status).toBe(429);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
