import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextRequest } from "next/server";

let enforceRateLimit: typeof import("@/lib/rate-limit").enforceRateLimit;

function makeRequest(ip: string) {
  return new NextRequest("http://localhost/api/test", {
    headers: { "x-forwarded-for": ip },
  });
}

beforeEach(async () => {
  vi.resetModules();
  ({ enforceRateLimit } = await import("@/lib/rate-limit"));
  // enforceRateLimit no-ops in test mode - force it "on" to exercise real behavior
  vi.stubEnv("NODE_ENV", "development");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("enforceRateLimit", () => {
  it("namespaces budgets by routeKey so one route can't starve another's quota", () => {
    const ip = "203.0.113.5";
    for (let i = 0; i < 8; i++) {
      expect(enforceRateLimit(makeRequest(ip), "chat")).toBeNull();
    }
    // "chat" budget is exhausted for this IP...
    expect(enforceRateLimit(makeRequest(ip), "chat")).not.toBeNull();
    // ...but "offer-services" has its own independent budget for the same IP.
    expect(enforceRateLimit(makeRequest(ip), "offer-services")).toBeNull();
  });

  it("returns a 429 with a Retry-After header once a route's budget is exhausted", () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < 8; i++) {
      enforceRateLimit(makeRequest(ip), "chat");
    }
    const res = enforceRateLimit(makeRequest(ip), "chat");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(429);
    expect(res!.headers.get("Retry-After")).toBeTruthy();
  });
});
