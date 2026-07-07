import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  it("allows requests below the max", async () => {
    for (let i = 0; i < 5; i++) {
      expect((await checkRateLimit("ip-a", { max: 5, windowMs: 60_000 })).ok).toBe(true);
    }
  });

  it("blocks the (max+1)th request", async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit("ip-b", { max: 3, windowMs: 60_000 });
    }
    const result = await checkRateLimit("ip-b", { max: 3, windowMs: 60_000 });
    expect(result.ok).toBe(false);
    expect(result.retryAfter).toBeGreaterThan(0);
  });

  it("different keys are tracked independently", async () => {
    for (let i = 0; i < 3; i++) {
      await checkRateLimit("ip-x", { max: 3, windowMs: 60_000 });
    }
    // ip-x is exhausted; ip-y should still be allowed
    expect((await checkRateLimit("ip-x", { max: 3, windowMs: 60_000 })).ok).toBe(false);
    expect((await checkRateLimit("ip-y", { max: 3, windowMs: 60_000 })).ok).toBe(true);
  });

  it("resets after the window expires", async () => {
    await checkRateLimit("ip-c", { max: 1, windowMs: 10 });
    await checkRateLimit("ip-c", { max: 1, windowMs: 10 }); // exhausted

    await new Promise((r) => setTimeout(r, 15));

    expect((await checkRateLimit("ip-c", { max: 1, windowMs: 10 })).ok).toBe(true);
  });

  it("retryAfter is a positive integer in seconds", async () => {
    await checkRateLimit("ip-d", { max: 1, windowMs: 5_000 });
    const result = await checkRateLimit("ip-d", { max: 1, windowMs: 5_000 });
    expect(result.ok).toBe(false);
    expect(Number.isInteger(result.retryAfter)).toBe(true);
    expect(result.retryAfter).toBeGreaterThan(0);
    expect(result.retryAfter).toBeLessThanOrEqual(5);
  });
});

describe("checkRateLimit with Upstash Redis configured", () => {
  const ORIGINAL_URL = process.env.UPSTASH_REDIS_REST_URL;
  const ORIGINAL_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;

  afterEach(() => {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", ORIGINAL_URL ?? "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", ORIGINAL_TOKEN ?? "");
    vi.doUnmock("@upstash/redis");
  });

  async function loadWithMockedRedis(redisImpl: Record<string, unknown>) {
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://fake.upstash.io");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "fake-token");
    vi.doMock("@upstash/redis", () => ({
      Redis: class {
        incr = redisImpl.incr;
        expire = redisImpl.expire;
        ttl = redisImpl.ttl;
      },
    }));
    vi.resetModules();
    return import("@/lib/rate-limit");
  }

  it("uses the Redis-backed count when Redis responds normally", async () => {
    const incr = vi.fn().mockResolvedValue(1);
    const expire = vi.fn().mockResolvedValue(1);
    const ttl = vi.fn().mockResolvedValue(60);
    const { checkRateLimit: checkRateLimitWithRedis } = await loadWithMockedRedis({
      incr,
      expire,
      ttl,
    });

    const result = await checkRateLimitWithRedis("redis-key", { max: 3, windowMs: 60_000 });

    expect(result.ok).toBe(true);
    expect(incr).toHaveBeenCalledWith("redis-key");
  });

  it("fails open to the in-memory limiter when Redis errors", async () => {
    const incr = vi.fn().mockRejectedValue(new Error("connection refused"));
    const { checkRateLimit: checkRateLimitWithRedis } = await loadWithMockedRedis({
      incr,
      expire: vi.fn(),
      ttl: vi.fn(),
    });

    // Redis errors on every call, so this exercises the exact fallback path -
    // the in-memory limiter must still enforce the max, not silently allow
    // everything through because the "real" backend is unreachable.
    for (let i = 0; i < 2; i++) {
      expect((await checkRateLimitWithRedis("redis-fallback-key", { max: 2, windowMs: 60_000 })).ok).toBe(
        true
      );
    }
    const result = await checkRateLimitWithRedis("redis-fallback-key", { max: 2, windowMs: 60_000 });
    expect(result.ok).toBe(false);
  });

  it("fails open to the in-memory limiter when Redis times out", async () => {
    const incr = vi.fn().mockImplementation(() => new Promise(() => {})); // never resolves
    const { checkRateLimit: checkRateLimitWithRedis } = await loadWithMockedRedis({
      incr,
      expire: vi.fn(),
      ttl: vi.fn(),
    });

    const result = await checkRateLimitWithRedis("redis-timeout-key", { max: 5, windowMs: 60_000 });
    expect(result.ok).toBe(true);
  });
});
