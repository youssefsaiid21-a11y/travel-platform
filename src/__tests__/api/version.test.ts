import { describe, it, expect, afterEach } from "vitest";
import { GET } from "@/app/api/version/route";

const ORIGINAL_SHA = process.env.VERCEL_GIT_COMMIT_SHA;

afterEach(() => {
  if (ORIGINAL_SHA === undefined) delete process.env.VERCEL_GIT_COMMIT_SHA;
  else process.env.VERCEL_GIT_COMMIT_SHA = ORIGINAL_SHA;
});

describe("GET /api/version", () => {
  it("returns the deployed commit SHA when VERCEL_GIT_COMMIT_SHA is set", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "abc123";
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ commit: "abc123" });
  });

  it("returns commit: null rather than throwing when unset (e.g. local dev)", async () => {
    delete process.env.VERCEL_GIT_COMMIT_SHA;
    const res = await GET();
    const body = await res.json();
    expect(body).toEqual({ commit: null });
  });
});
