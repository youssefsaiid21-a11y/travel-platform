import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const CRON_SECRET = "test_cron_secret";

function makeRequest(authHeader?: string) {
  return new NextRequest("http://localhost/api/cron/check-price-drops", {
    method: "POST",
    ...(authHeader ? { headers: { authorization: authHeader } } : {}),
  });
}

const mockFindMany = vi.hoisted(() => vi.fn());
const mockCheckTrackedSearchForPriceDrop = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    trackedSearch: { findMany: mockFindMany },
  },
}));

vi.mock("@/lib/priceTracking/checkPriceDrop", () => ({
  checkTrackedSearchForPriceDrop: mockCheckTrackedSearchForPriceDrop,
}));

import { POST } from "@/app/api/cron/check-price-drops/route";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const ORIGINAL_CRON_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  mockFindMany.mockReset();
  mockCheckTrackedSearchForPriceDrop.mockReset();
});

describe("POST /api/cron/check-price-drops", () => {
  it("only queries tracked searches with a departure date today or later", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    await POST(makeRequest());
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { departureDate: { gte: expect.any(String) } },
      })
    );
  });

  it("checks every due tracked search and tallies drops", async () => {
    mockFindMany.mockResolvedValueOnce([{ id: "trk_1" }, { id: "trk_2" }, { id: "trk_3" }]);
    mockCheckTrackedSearchForPriceDrop
      .mockResolvedValueOnce({ trackedSearchId: "trk_1", checked: true, dropped: true })
      .mockResolvedValueOnce({ trackedSearchId: "trk_2", checked: true, dropped: false })
      .mockResolvedValueOnce({ trackedSearchId: "trk_3", checked: false, dropped: false });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ total: 3, checked: 3, dropped: 1, failed: 0 });
  });

  it("does not let one failing check take down the whole batch", async () => {
    mockFindMany.mockResolvedValueOnce([{ id: "trk_1" }, { id: "trk_2" }]);
    mockCheckTrackedSearchForPriceDrop
      .mockRejectedValueOnce(new Error("Duffel timeout"))
      .mockResolvedValueOnce({ trackedSearchId: "trk_2", checked: true, dropped: true });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ total: 2, checked: 1, dropped: 1, failed: 1 });
  });
});

describe("POST /api/cron/check-price-drops auth (outside test NODE_ENV)", () => {
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
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects requests with the wrong bearer token", async () => {
    const res = await POST(makeRequest("Bearer wrong_secret"));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("rejects requests when CRON_SECRET is not configured on the server", async () => {
    vi.stubEnv("CRON_SECRET", "");
    const res = await POST(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(401);
    expect(mockFindMany).not.toHaveBeenCalled();
  });

  it("allows requests with the correct bearer token", async () => {
    mockFindMany.mockResolvedValueOnce([]);
    const res = await POST(makeRequest(`Bearer ${CRON_SECRET}`));
    expect(res.status).toBe(200);
  });
});
