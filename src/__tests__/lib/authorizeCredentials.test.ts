import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

// Computes the exact current TOTP code/step directly (matches
// src/lib/totp.ts's own algorithm) - see src/__tests__/api/mfa.test.ts for
// why this is deterministic rather than brute-forced.
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
function currentTotpCodeAndStep(secret: string): { code: string; step: number } {
  const key = base32DecodeForTest(secret);
  const step = Math.floor(Date.now() / 1000 / 30);
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", key).update(counterBuf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return { code: (code % 1_000_000).toString().padStart(6, "0"), step };
}

const mockFindUnique = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));

import { authorizeCredentials } from "@/lib/authorizeCredentials";

const PASSWORD = "correct-password";
const USER_ID = "usr_1";

async function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    email: "jane@example.com",
    name: "Jane",
    passwordHash: await bcrypt.hash(PASSWORD, 4),
    tokenVersion: 0,
    totpEnabled: false,
    totpSecret: null,
    totpLastUsedStep: null,
    backupCodes: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
});

describe("authorizeCredentials", () => {
  it("returns null when email or password is missing", async () => {
    expect(await authorizeCredentials({ email: "jane@example.com" })).toBeNull();
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns null when the user does not exist", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    expect(
      await authorizeCredentials({ email: "nobody@example.com", password: "x" })
    ).toBeNull();
  });

  it("returns null on an incorrect password", async () => {
    mockFindUnique.mockResolvedValueOnce(await makeUser());
    expect(
      await authorizeCredentials({ email: "jane@example.com", password: "wrong" })
    ).toBeNull();
  });

  it("returns the user directly when the password is correct and MFA is not enabled", async () => {
    mockFindUnique.mockResolvedValueOnce(await makeUser());
    const result = await authorizeCredentials({
      email: "jane@example.com",
      password: PASSWORD,
    });
    expect(result).toEqual({ id: USER_ID, email: "jane@example.com", name: "Jane", tokenVersion: 0 });
  });

  it("throws MfaRequiredError when MFA is enabled and no code is supplied", async () => {
    mockFindUnique.mockResolvedValueOnce(
      await makeUser({ totpEnabled: true, totpSecret: "JBSWY3DPEHPK3PXP" })
    );
    await expect(
      authorizeCredentials({ email: "jane@example.com", password: PASSWORD })
    ).rejects.toMatchObject({ code: "mfa_required" });
  });

  it("throws InvalidMfaCodeError when the code is wrong and no backup code matches", async () => {
    mockFindUnique.mockResolvedValueOnce(
      await makeUser({ totpEnabled: true, totpSecret: "JBSWY3DPEHPK3PXP", backupCodes: [] })
    );
    await expect(
      authorizeCredentials({ email: "jane@example.com", password: PASSWORD, otp: "000000" })
    ).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("accepts a valid backup code and removes it (single-use)", async () => {
    const backupCode = "a1b2c3d4e5";
    const hashedBackupCodes = [await bcrypt.hash(backupCode, 4), await bcrypt.hash("other-code", 4)];
    mockFindUnique.mockResolvedValueOnce(
      await makeUser({ totpEnabled: true, totpSecret: "JBSWY3DPEHPK3PXP", backupCodes: hashedBackupCodes })
    );
    mockUpdate.mockResolvedValueOnce({});

    const result = await authorizeCredentials({
      email: "jane@example.com",
      password: PASSWORD,
      otp: backupCode,
    });

    expect(result).toEqual({ id: USER_ID, email: "jane@example.com", name: "Jane", tokenVersion: 0 });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { backupCodes: [hashedBackupCodes[1]] },
    });
  });

  it("rejects a backup code that was already used (not in the stored list)", async () => {
    mockFindUnique.mockResolvedValueOnce(
      await makeUser({ totpEnabled: true, totpSecret: "JBSWY3DPEHPK3PXP", backupCodes: [] })
    );
    await expect(
      authorizeCredentials({ email: "jane@example.com", password: PASSWORD, otp: "a1b2c3d4e5" })
    ).rejects.toMatchObject({ code: "invalid_code" });
  });

  it("accepts a valid TOTP code and records the step it was used at", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const { code, step } = currentTotpCodeAndStep(secret);
    mockFindUnique.mockResolvedValueOnce(
      await makeUser({ totpEnabled: true, totpSecret: secret, totpLastUsedStep: step - 5 })
    );
    mockUpdate.mockResolvedValueOnce({});

    const result = await authorizeCredentials({ email: "jane@example.com", password: PASSWORD, otp: code });

    expect(result).toEqual({ id: USER_ID, email: "jane@example.com", name: "Jane", tokenVersion: 0 });
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { totpLastUsedStep: step },
    });
  });

  it("rejects a valid TOTP code that was already used at this exact step (replay protection)", async () => {
    const secret = "JBSWY3DPEHPK3PXP";
    const { code, step } = currentTotpCodeAndStep(secret);
    // totpLastUsedStep already equals the step this code matches - as if
    // this exact code was already accepted once.
    mockFindUnique.mockResolvedValueOnce(
      await makeUser({ totpEnabled: true, totpSecret: secret, totpLastUsedStep: step, backupCodes: [] })
    );

    await expect(
      authorizeCredentials({ email: "jane@example.com", password: PASSWORD, otp: code })
    ).rejects.toMatchObject({ code: "invalid_code" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
