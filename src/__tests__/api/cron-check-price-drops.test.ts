import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

function makeRequest() {
  return new NextRequest("http://localhost/api/cron/check-price-drops", { method: "POST" });
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
