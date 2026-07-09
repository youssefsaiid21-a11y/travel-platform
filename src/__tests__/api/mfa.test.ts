import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const mockAuth = vi.hoisted(() => vi.fn());
const mockFindUnique = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: mockFindUnique, update: mockUpdate },
  },
}));

import { POST as setupPOST } from "@/app/api/auth/mfa/setup/route";
import { POST as confirmPOST } from "@/app/api/auth/mfa/confirm/route";
import { POST as disablePOST } from "@/app/api/auth/mfa/disable/route";

// Computes the exact current TOTP code directly (matches src/lib/totp.ts's
// own algorithm) rather than brute-forcing the 6-digit space against
// verifyTotp - brute-forcing up to 1,000,000 HMAC computations per test
// timed out when run alongside the rest of the suite under load.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32DecodeForTest(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}
function currentTotpCode(secret: string): string {
  const key = base32DecodeForTest(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (code % 1_000_000).toString().padStart(6, "0");
}

const USER_ID = "usr_1";

function makeRequest(url: string, body: object) {
  return new NextRequest(`http://localhost${url}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
});

describe("POST /api/auth/mfa/setup", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await setupPOST();
    expect(res.status).toBe(401);
  });

  it("generates and stores a secret, without enabling MFA yet", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockFindUnique.mockResolvedValueOnce({ email: "jane@example.com" });
    mockUpdate.mockResolvedValueOnce({});

    const res = await setupPOST();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.secret).toMatch(/^[A-Z2-7]+$/);
    expect(body.otpauthUrl).toContain(body.secret);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: expect.objectContaining({ totpSecret: body.secret, totpEnabled: false }),
    });
  });
});

describe("POST /api/auth/mfa/confirm", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await confirmPOST(makeRequest("/api/auth/mfa/confirm", { code: "123456" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when there's no setup in progress", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockFindUnique.mockResolvedValueOnce({ totpSecret: null });
    const res = await confirmPOST(makeRequest("/api/auth/mfa/confirm", { code: "123456" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 on an incorrect code", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockFindUnique.mockResolvedValueOnce({ totpSecret: "JBSWY3DPEHPK3PXP" });
    const res = await confirmPOST(makeRequest("/api/auth/mfa/confirm", { code: "000000" }));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("enables MFA and returns 8 backup codes on a correct code", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockFindUnique.mockResolvedValueOnce({ totpSecret: secret });
    mockUpdate.mockResolvedValueOnce({});

    const validCode = currentTotpCode(secret);
    const res = await confirmPOST(makeRequest("/api/auth/mfa/confirm", { code: validCode }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backupCodes).toHaveLength(8);
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: USER_ID },
        data: expect.objectContaining({ totpEnabled: true }),
      })
    );
  });
});

describe("POST /api/auth/mfa/disable", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await disablePOST(makeRequest("/api/auth/mfa/disable", { password: "x" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 on an incorrect password", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockFindUnique.mockResolvedValueOnce({ passwordHash: await bcrypt.hash("correct", 4) });
    const res = await disablePOST(makeRequest("/api/auth/mfa/disable", { password: "wrong" }));
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("clears MFA fields on a correct password", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockFindUnique.mockResolvedValueOnce({ passwordHash: await bcrypt.hash("correct", 4) });
    mockUpdate.mockResolvedValueOnce({});

    const res = await disablePOST(makeRequest("/api/auth/mfa/disable", { password: "correct" }));
    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: expect.objectContaining({ totpSecret: null, totpEnabled: false }),
    });
  });
});
