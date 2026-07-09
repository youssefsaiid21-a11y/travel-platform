import { describe, it, expect, vi, afterEach } from "vitest";
import crypto from "node:crypto";
import {
  generateTotpSecret,
  generateOtpAuthUrl,
  verifyTotp,
  generateBackupCodes,
} from "@/lib/totp";

afterEach(() => {
  vi.useRealTimers();
});

describe("generateTotpSecret", () => {
  it("generates a base32 string with no ambiguous characters", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(secret.length).toBeGreaterThan(20);
  });

  it("generates a different secret every time", () => {
    expect(generateTotpSecret()).not.toBe(generateTotpSecret());
  });
});

describe("generateOtpAuthUrl", () => {
  it("produces a valid otpauth:// URL containing the secret and issuer", () => {
    const url = generateOtpAuthUrl("JBSWY3DPEHPK3PXP", "jane@example.com");
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(url).toContain("issuer=Orbi");
    expect(url).toContain(encodeURIComponent("jane@example.com"));
  });
});

describe("verifyTotp", () => {
  it("matches the RFC 6238 Appendix B test vector at T=59s", () => {
    // RFC 6238's test vectors use the raw ASCII string "12345678901234567890"
    // as the HMAC-SHA1 key. Base32-encoding it and feeding it through the
    // same public API this app actually uses is a stronger correctness
    // check than testing hotp()/base32 helpers in isolation.
    const asciiKey = "12345678901234567890";
    const base32Key = base32EncodeForTest(Buffer.from(asciiKey, "ascii"));

    vi.useFakeTimers();
    vi.setSystemTime(new Date(59 * 1000));

    // RFC 6238's published 8-digit code at T=59s is 94287082; this app only
    // ever produces 6-digit codes (truncated the same way authenticator
    // apps commonly display), i.e. 94287082 % 1_000_000 = 287082.
    expect(verifyTotp(base32Key, "287082").valid).toBe(true);
    expect(verifyTotp(base32Key, "000000").valid).toBe(false);
  });

  it("rejects a non-6-digit token", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "12345").valid).toBe(false);
    expect(verifyTotp(secret, "abcdef").valid).toBe(false);
  });

  it("accepts a code from one time-step in the past (clock drift tolerance)", () => {
    const secret = generateTotpSecret();
    const codeAtStepZero = totpAtCounter(secret, 0);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(30 * 1000)); // one 30s step after counter 0
    expect(verifyTotp(secret, codeAtStepZero).valid).toBe(true);
  });

  it("rejects a code from far outside the drift window", () => {
    const secret = generateTotpSecret();
    const codeAtStepZero = totpAtCounter(secret, 0);
    vi.useFakeTimers();
    vi.setSystemTime(new Date(10 * 60 * 1000)); // 10 minutes later
    expect(verifyTotp(secret, codeAtStepZero).valid).toBe(false);
  });

  it("returns the matched time step alongside valid: true, for replay-protection callers", () => {
    // Counter 1 (not 0) deliberately - the drift check below tries
    // counter-1, and a counter of 0 would make that negative, which
    // BigInt-based counters can't represent (see hotp()). Real systems
    // never run anywhere near the Unix epoch, so this isn't a scenario
    // worth handling in the implementation - just avoided in the fixture.
    const secret = generateTotpSecret();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(30 * 1000));
    const code = totpAtCounter(secret, 1);
    const result = verifyTotp(secret, code);
    expect(result.valid).toBe(true);
    expect(result.step).toBe(1);
  });
});

describe("generateBackupCodes", () => {
  it("generates 8 unique codes by default", () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(8);
    expect(new Set(codes).size).toBe(8);
  });

  it("generates the requested count", () => {
    expect(generateBackupCodes(3)).toHaveLength(3);
  });
});

// --- test-only helpers (not exported from src/lib/totp.ts) ---

function base32EncodeForTest(buffer: Buffer): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += alphabet[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder > 0) {
    const lastChunk = bits.slice(bits.length - remainder).padEnd(5, "0");
    output += alphabet[parseInt(lastChunk, 2)];
  }
  return output;
}

function base32DecodeForTest(input: string): Buffer {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const clean = input.toUpperCase().replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const idx = alphabet.indexOf(char);
    if (idx === -1) continue;
    bits += idx.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

// Computes the exact HOTP value for a given counter, independently of
// verifyTotp's drift-window search - deterministic, unlike brute-forcing.
function totpAtCounter(secret: string, counter: number): string {
  const key = base32DecodeForTest(secret);
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
