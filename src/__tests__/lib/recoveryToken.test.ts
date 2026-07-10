import { describe, it, expect } from "vitest";
import { generateRecoveryToken, hashRecoveryToken, RECOVERY_TOKEN_TTL_MS } from "@/lib/recoveryToken";

describe("recoveryToken", () => {
  it("generates a random raw token and its matching hash", () => {
    const { raw, hash } = generateRecoveryToken();
    expect(raw.length).toBeGreaterThan(20);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashRecoveryToken(raw)).toBe(hash);
  });

  it("generates a different token every time", () => {
    expect(generateRecoveryToken().raw).not.toBe(generateRecoveryToken().raw);
  });

  it("hashes deterministically for the same raw token", () => {
    const { raw } = generateRecoveryToken();
    expect(hashRecoveryToken(raw)).toBe(hashRecoveryToken(raw));
  });

  it("produces different hashes for different raw tokens", () => {
    const a = generateRecoveryToken();
    const b = generateRecoveryToken();
    expect(hashRecoveryToken(a.raw)).not.toBe(hashRecoveryToken(b.raw));
  });

  it("has a 60-minute TTL", () => {
    expect(RECOVERY_TOKEN_TTL_MS).toBe(60 * 60_000);
  });
});
