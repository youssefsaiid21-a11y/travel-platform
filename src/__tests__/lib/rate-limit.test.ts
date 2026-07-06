import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Isolate the module so each describe block gets a fresh store
let checkRateLimit: typeof import("@/lib/rate-limit").checkRateLimit;
let getClientIp: typeof import("@/lib/rate-limit").getClientIp;

beforeEach(async () => {
  vi.resetModules();
  ({ checkRateLimit, getClientIp } = await import("@/lib/rate-limit"));
});

function makeRequest(headers: Record<string, string>) {
  return new NextRequest("http://localhost/api/test", { headers });
}

describe("getClientIp", () => {
  it("uses the LAST entry of x-forwarded-for, not the first", () => {
    // A reverse proxy appends the IP it actually observed onto the end of
    // whatever x-forwarded-for it received - the first entry is whatever
    // the client itself claimed, which is exactly what a spoofing client
    // controls. Trusting index 0 (the old bug) makes the rate-limit key
    // attacker-chosen.
    const ip = getClientIp(
      makeRequest({ "x-forwarded-for": "1.2.3.4, 9.9.9.9" })
    );
    expect(ip).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const ip = getClientIp(makeRequest({ "x-real-ip": "5.6.7.8" }));
    expect(ip).toBe("5.6.7.8");
  });

  it("falls back to \"unknown\" when neither header is present", () => {
    expect(getClientIp(makeRequest({}))).toBe("unknown");
  });

  it("trims whitespace around the trusted entry", () => {
    const ip = getClientIp(
      makeRequest({ "x-forwarded-for": "1.2.3.4,   9.9.9.9  " })
    );
    expect(ip).toBe("9.9.9.9");
  });
});

describe("checkRateLimit", () => {
  it("allows requests below the max", () => {
    for (let i = 0; i < 5; i++) {
      expect(checkRateLimit("ip-a", { max: 5, windowMs: 60_000 }).ok).toBe(true);
    }
  });

  it("blocks the (max+1)th request", () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit("ip-b", { max: 3, windowMs: 60_000 });
    }
    const result = checkRateLimit("ip-b", { max: 3, windowMs: 60_000 });
    expect(result.ok).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("different keys are tracked independently", () => {
    for (let i = 0; i < 3; i++) {
      checkRateLimit("ip-x", { max: 3, windowMs: 60_000 });
    }
    // ip-x is exhausted; ip-y should still be allowed
    expect(checkRateLimit("ip-x", { max: 3, windowMs: 60_000 }).ok).toBe(false);
    expect(checkRateLimit("ip-y", { max: 3, windowMs: 60_000 }).ok).toBe(true);
  });

  it("resets after the window expires", async () => {
    checkRateLimit("ip-c", { max: 1, windowMs: 10 });
    checkRateLimit("ip-c", { max: 1, windowMs: 10 }); // exhausted

    await new Promise((r) => setTimeout(r, 15));

    expect(checkRateLimit("ip-c", { max: 1, windowMs: 10 }).ok).toBe(true);
  });

  it("retryAfter is a positive integer in seconds", () => {
    checkRateLimit("ip-d", { max: 1, windowMs: 5_000 });
    const result = checkRateLimit("ip-d", { max: 1, windowMs: 5_000 });
    expect(result.ok).toBe(false);
    expect(Number.isInteger(result.retryAfter)).toBe(true);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(5);
  });
});
