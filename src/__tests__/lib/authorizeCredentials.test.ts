import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";

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
});
