import { describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { requireCronSecret } from "@/lib/cronAuth";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

afterEach(() => {
  vi.stubEnv("NODE_ENV", ORIGINAL_NODE_ENV ?? "test");
  vi.stubEnv("CRON_SECRET", ORIGINAL_CRON_SECRET ?? "");
});

function makeRequest(authHeader?: string) {
  return new NextRequest("http://localhost/api/cron/whatever", {
    method: "POST",
    ...(authHeader ? { headers: { authorization: authHeader } } : {}),
  });
}

describe("requireCronSecret", () => {
  it("allows any request when NODE_ENV is test (existing cron test files rely on this)", () => {
    vi.stubEnv("NODE_ENV", "test");
    expect(requireCronSecret(makeRequest())).toBeNull();
  });

  describe("outside test NODE_ENV", () => {
    it("rejects when CRON_SECRET isn't configured on the server at all", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CRON_SECRET", "");
      const res = requireCronSecret(makeRequest("Bearer anything"));
      expect(res?.status).toBe(401);
    });

    it("rejects a missing Authorization header", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CRON_SECRET", "real_secret");
      const res = requireCronSecret(makeRequest());
      expect(res?.status).toBe(401);
    });

    it("rejects a non-Bearer Authorization header", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CRON_SECRET", "real_secret");
      const res = requireCronSecret(makeRequest("Basic dXNlcjpwYXNz"));
      expect(res?.status).toBe(401);
    });

    it("rejects the wrong bearer token", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CRON_SECRET", "real_secret");
      const res = requireCronSecret(makeRequest("Bearer wrong"));
      expect(res?.status).toBe(401);
    });

    it("allows the correct bearer token", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("CRON_SECRET", "real_secret");
      expect(requireCronSecret(makeRequest("Bearer real_secret"))).toBeNull();
    });
  });
});
