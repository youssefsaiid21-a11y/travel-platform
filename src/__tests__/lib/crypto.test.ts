import { describe, it, expect } from "vitest";
import { encryptField, decryptField, safeDecryptPassport } from "@/lib/crypto";

describe("encryptField / decryptField", () => {
  it("round-trips a plaintext value", () => {
    const encrypted = encryptField("123456789");
    expect(encrypted).not.toBe("123456789");
    expect(decryptField(encrypted)).toBe("123456789");
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptField("123456789");
    const b = encryptField("123456789");
    expect(a).not.toBe(b);
    expect(decryptField(a)).toBe(decryptField(b));
  });

  it("throws on a tampered ciphertext (GCM auth tag)", () => {
    const encrypted = encryptField("123456789");
    const tampered = encrypted.slice(0, -4) + "abcd";
    expect(() => decryptField(tampered)).toThrow();
  });
});

describe("safeDecryptPassport", () => {
  it("decrypts a properly encrypted value", () => {
    const encrypted = encryptField("987654321");
    expect(safeDecryptPassport(encrypted)).toBe("987654321");
  });

  it("passes through legacy plaintext that predates encryption", () => {
    expect(safeDecryptPassport("PLAINTEXT123")).toBe("PLAINTEXT123");
  });

  it("passes through null", () => {
    expect(safeDecryptPassport(null)).toBeNull();
  });
});
