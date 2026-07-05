import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockHandlersPost = vi.hoisted(() => vi.fn());
const mockHandlersGet = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({
  handlers: { GET: mockHandlersGet, POST: mockHandlersPost },
}));

import { POST } from "@/app/api/auth/[...nextauth]/route";

function makeRequest(path: string) {
  return new NextRequest(`http://localhost${path}`, { method: "POST" });
}

beforeEach(() => {
  mockHandlersPost.mockReset();
  mockHandlersPost.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.stubEnv("NODE_ENV", "test");
});

describe("POST /api/auth/[...nextauth]", () => {
  it("does not rate-limit non-credentials paths (e.g. signout)", async () => {
    const res = await POST(makeRequest("/api/auth/signout"));
    expect(mockHandlersPost).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it("returns 429 after too many login attempts from the same client", async () => {
    let lastRes;
    for (let i = 0; i < 9; i++) {
      lastRes = await POST(makeRequest("/api/auth/callback/credentials"));
    }
    expect(lastRes!.status).toBe(429);
    // The underlying NextAuth handler should never see the requests once
    // the budget is exhausted.
    expect(mockHandlersPost.mock.calls.length).toBeLessThan(9);
  });
});
