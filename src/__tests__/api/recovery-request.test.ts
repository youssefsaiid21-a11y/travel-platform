import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockFindUnique = vi.hoisted(() => vi.fn());
const mockUpdateMany = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockEnforceRateLimit = vi.hoisted(() => vi.fn());
const mockSendAccountRecoveryEmail = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: mockFindUnique },
    accountRecoveryToken: { updateMany: mockUpdateMany, create: mockCreate },
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mockEnforceRateLimit,
}));

vi.mock("@/lib/notifications/email", () => ({
  sendAccountRecoveryEmail: mockSendAccountRecoveryEmail,
}));

import { POST } from "@/app/api/auth/recovery/request/route";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/auth/recovery/request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdateMany.mockReset().mockResolvedValue({ count: 0 });
  mockCreate.mockReset().mockResolvedValue({});
  mockEnforceRateLimit.mockReset().mockResolvedValue(null);
  mockSendAccountRecoveryEmail.mockReset().mockResolvedValue(undefined);
});

describe("POST /api/auth/recovery/request", () => {
  it("rejects an invalid email with 400, without touching the DB", async () => {
    const res = await POST(makeRequest({ email: "not-an-email" }));
    expect(res.status).toBe(400);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns the rate-limited response when enforceRateLimit blocks", async () => {
    mockEnforceRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const res = await POST(makeRequest({ email: "user@example.com" }));
    expect(res.status).toBe(429);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns an identical 200 { ok: true } body for a real account", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "usr_1" });

    const res = await POST(makeRequest({ email: "real@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mockUpdateMany).toHaveBeenCalledWith({
      where: { userId: "usr_1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockSendAccountRecoveryEmail).toHaveBeenCalledWith(
      expect.objectContaining({ userEmail: "real@example.com" })
    );
  });

  it("returns the identical 200 { ok: true } body for a non-existent account, without creating a token or sending email", async () => {
    mockFindUnique.mockResolvedValueOnce(null);

    const res = await POST(makeRequest({ email: "nobody@example.com" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockSendAccountRecoveryEmail).not.toHaveBeenCalled();
  });
});
