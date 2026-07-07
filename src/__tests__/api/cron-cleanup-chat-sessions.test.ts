import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const CRON_SECRET = "test_cron_secret";

function makeRequest(authHeader?: string) {
  return new NextRequest("http://localhost/api/cron/cleanup-chat-sessions", {
    method: "POST",
    ...(authHeader ? { headers: { authorization: authHeader } } : {}),
  });
}

const mockDeleteMany = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    chatSession: { deleteMany: mockDeleteMany },
  },
}));

import { POST } from "@/app/api/cron/cleanup-chat-sessions/route";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  mockDeleteMany.mockReset();
});

describe("POST /api/cron/cleanup-chat-sessions", () => {
  it("deletes sessions not updated in the last 30 days and reports the count", async () => {
    mockDeleteMany.mockResolvedValueOnce({ count: 12 });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ deleted: 12 });
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { updatedAt: { lt: expect.any(Date) } },
    });

    // The cutoff must actually be ~30 days back, not e.g. accidentally the
    // current time (which would delete every session including active ones).
    const cutoff = mockDeleteMany.mock.calls[0][0].where.updatedAt.lt as Date;
    const daysAgo = (Date.now() - cutoff.getTime()) / (24 * 60 * 60 * 1000);
    expect(daysAgo).toBeGreaterThan(29.9);
    expect(daysAgo).toBeLessThan(30.1);
  });
});

describe("POST /api/cron/cleanup-chat-sessions auth (outside test NODE_ENV)", () => {
  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("CRON_SECRET", CRON_SECRET);
  });

  afterEach(() => {
    vi.stubEnv("NODE_ENV", ORIGINAL_NODE_ENV ?? "test");
    vi.stubEnv("CRON_SECRET", ORIGINAL_CRON_SECRET ?? "");
  });

  it("rejects requests with no Authorization header", async () => {
    const res = await POST(makeRequest());
    expect(res.status).toBe(401);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("rejects requests with the wrong bearer token", async () => {
    const res = await POST(makeRequest("Bearer wrong_secret"));
    expect(res.status).toBe(401);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("allows requests with the correct bearer token", async () => {
    mockDeleteMany.mockResolvedValueOnce({ count: 0 });
    const res = await POST(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
  });
});
