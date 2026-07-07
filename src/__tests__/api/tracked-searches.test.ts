import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import type { SearchParams } from "@/lib/parser/types";

const mockAuth = vi.hoisted(() => vi.fn());
const mockFindFirst = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  db: {
    trackedSearch: {
      findFirst: mockFindFirst,
      create: mockCreate,
      update: mockUpdate,
      findMany: mockFindMany,
    },
  },
}));

import { POST, GET } from "@/app/api/tracked-searches/route";

const MOCK_USER_ID = "usr_test_001";

const SEARCH_PARAMS: SearchParams = {
  origin: "LHR",
  destination: "JFK",
  departure_date: "2026-10-01",
  passengers: [{ type: "adult", count: 1 }],
};

function makePostRequest(body: object) {
  return new NextRequest("http://localhost/api/tracked-searches", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockFindFirst.mockReset();
  mockCreate.mockReset();
  mockUpdate.mockReset();
  mockFindMany.mockReset();
});

describe("POST /api/tracked-searches", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await POST(
      makePostRequest({ searchParams: SEARCH_PARAMS, cheapestAmount: "200.00", cheapestCurrency: "GBP" })
    );
    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when search params are missing required fields", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    const res = await POST(
      makePostRequest({ searchParams: { origin: "LHR" }, cheapestAmount: "200.00", cheapestCurrency: "GBP" })
    );
    expect(res.status).toBe(400);
  });

  it("creates a new tracked search when none exists yet", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockResolvedValueOnce({ id: "trk_1" });

    const res = await POST(
      makePostRequest({ searchParams: SEARCH_PARAMS, cheapestAmount: "200.00", cheapestCurrency: "GBP" })
    );

    expect(res.status).toBe(201);
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: MOCK_USER_ID,
        origin: "LHR",
        destination: "JFK",
        departureDate: "2026-10-01",
        lastKnownPrice: "200.00",
        lastKnownCurrency: "GBP",
      }),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("returns 401 (not 500) when the session's userId no longer exists in the DB", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Foreign key constraint failed", {
        code: "P2003",
        clientVersion: "test",
      })
    );

    const res = await POST(
      makePostRequest({ searchParams: SEARCH_PARAMS, cheapestAmount: "200.00", cheapestCurrency: "GBP" })
    );

    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toMatch(/sign in again/i);
  });

  it("updates the existing row instead of creating a duplicate", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindFirst.mockResolvedValueOnce({ id: "trk_existing" });
    mockUpdate.mockResolvedValueOnce({ id: "trk_existing" });

    const res = await POST(
      makePostRequest({ searchParams: SEARCH_PARAMS, cheapestAmount: "180.00", cheapestCurrency: "GBP" })
    );

    expect(res.status).toBe(200);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "trk_existing" },
      data: expect.objectContaining({ lastKnownPrice: "180.00" }),
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("matches on passengers so tracking the same route with a different party size creates a new row", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockResolvedValueOnce({ id: "trk_family" });

    const familyParams: SearchParams = {
      ...SEARCH_PARAMS,
      passengers: [{ type: "adult", count: 2 }, { type: "child", count: 3 }],
    };

    await POST(
      makePostRequest({ searchParams: familyParams, cheapestAmount: "900.00", cheapestCurrency: "GBP" })
    );

    // The lookup must include passengers - otherwise this would match (and
    // silently overwrite) an existing 1-adult tracked search for the same route/date.
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        passengers: { equals: familyParams.passengers },
      }),
    });
  });

  it("matches on preference filters so a refundable-only tracked search doesn't collide with a plain one", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindFirst.mockResolvedValueOnce(null);
    mockCreate.mockResolvedValueOnce({ id: "trk_refundable" });

    const refundableParams: SearchParams = { ...SEARCH_PARAMS, prefer_refundable: true };

    await POST(
      makePostRequest({ searchParams: refundableParams, cheapestAmount: "450.00", cheapestCurrency: "GBP" })
    );

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({ preferRefundable: true, preferChangeable: false }),
    });
    expect(mockCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ preferRefundable: true }),
    });
  });
});

describe("GET /api/tracked-searches", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the current user's tracked searches", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindMany.mockResolvedValueOnce([{ id: "trk_1" }]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.trackedSearches).toEqual([{ id: "trk_1" }]);
    expect(mockFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: MOCK_USER_ID } })
    );
  });
});
