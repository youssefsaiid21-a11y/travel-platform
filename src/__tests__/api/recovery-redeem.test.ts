import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

const mockFindUnique = vi.hoisted(() => vi.fn());
const mockTransaction = vi.hoisted(() => vi.fn());
const mockEnforceRateLimit = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    accountRecoveryToken: { findUnique: mockFindUnique, update: vi.fn(), updateMany: vi.fn() },
    user: { update: vi.fn() },
    $transaction: mockTransaction,
  },
}));

vi.mock("@/lib/rate-limit", () => ({
  enforceRateLimit: mockEnforceRateLimit,
}));

import { POST } from "@/app/api/auth/recovery/redeem/route";

const USER_ID = "usr_1";
const TOKEN_ID = "tok_1";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/auth/recovery/redeem", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeTokenRow(overrides: Record<string, unknown> = {}) {
  return {
    id: TOKEN_ID,
    userId: USER_ID,
    tokenHash: "irrelevant-in-mock",
    expiresAt: new Date(Date.now() + 60_000),
    usedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockTransaction.mockReset().mockResolvedValue([{}, {}, {}]);
  mockEnforceRateLimit.mockReset().mockResolvedValue(null);
});

describe("POST /api/auth/recovery/redeem", () => {
  it("rejects a missing token with the generic error", async () => {
    const res = await POST(makeRequest({ newPassword: "a-new-password-123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("This reset link is invalid or has expired.");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("rejects a too-short new password", async () => {
    const res = await POST(makeRequest({ token: "abc", newPassword: "short" }));
    expect(res.status).toBe(400);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns the generic error for a token that doesn't exist", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ token: "abc", newPassword: "a-new-password-123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("This reset link is invalid or has expired.");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns the same generic error for an already-used token", async () => {
    mockFindUnique.mockResolvedValueOnce(makeTokenRow({ usedAt: new Date() }));
    const res = await POST(makeRequest({ token: "abc", newPassword: "a-new-password-123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("This reset link is invalid or has expired.");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("returns the same generic error for an expired token", async () => {
    mockFindUnique.mockResolvedValueOnce(makeTokenRow({ expiresAt: new Date(Date.now() - 1000) }));
    const res = await POST(makeRequest({ token: "abc", newPassword: "a-new-password-123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("This reset link is invalid or has expired.");
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("resets the password and tears down MFA state on a valid token", async () => {
    mockFindUnique.mockResolvedValueOnce(makeTokenRow());

    const res = await POST(makeRequest({ token: "abc", newPassword: "a-new-password-123" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    expect(mockTransaction).toHaveBeenCalledTimes(1);
    const ops = mockTransaction.mock.calls[0][0];
    expect(ops).toHaveLength(3);
  });

  it("returns the rate-limited response when enforceRateLimit blocks", async () => {
    mockEnforceRateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    const res = await POST(makeRequest({ token: "abc", newPassword: "a-new-password-123" }));
    expect(res.status).toBe(429);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });
});

describe("recovery redeem password hash", () => {
  it("hashes the new password with bcrypt (not stored in plaintext)", async () => {
    const hash = await bcrypt.hash("a-new-password-123", 4);
    expect(await bcrypt.compare("a-new-password-123", hash)).toBe(true);
    expect(hash).not.toBe("a-new-password-123");
  });
});
