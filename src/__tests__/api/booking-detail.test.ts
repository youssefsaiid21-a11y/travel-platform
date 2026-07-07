import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
const mockFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  db: {
    booking: { findUnique: mockFindUnique },
  },
}));

import { GET } from "@/app/api/booking/[id]/route";

const MOCK_USER_ID = "usr_owner_001";
const OTHER_USER_ID = "usr_other_002";
const BOOKING_ID = "bkng_abc123";

const MOCK_BOOKING = {
  id: BOOKING_ID,
  userId: MOCK_USER_ID,
  status: "confirmed",
  totalAmount: "342.50",
  totalCurrency: "GBP",
  offerSnapshot: {},
  searchParams: {},
  passengerNames: ["Jane Smith"],
  duffelBookingRef: "DUF123",
  duffelOrderId: "ord_001",
  stripePaymentIntentId: "pi_test_001",
  specialRequests: null,
  createdAt: new Date("2026-07-01"),
  updatedAt: new Date("2026-07-01"),
};

function makeRequest(id: string) {
  return new NextRequest(`http://localhost/api/booking/${id}`, { method: "GET" });
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockAuth.mockReset();
  mockFindUnique.mockReset();
});

describe("GET /api/booking/[id]", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await GET(makeRequest(BOOKING_ID), makeParams(BOOKING_ID));
    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns 404 when booking does not exist", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindUnique.mockResolvedValueOnce(null);
    const res = await GET(makeRequest("nonexistent"), makeParams("nonexistent"));
    expect(res.status).toBe(404);
  });

  it("returns 404 (not 403) when booking belongs to a different user, indistinguishable from not existing", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: OTHER_USER_ID } });
    mockFindUnique.mockResolvedValueOnce(MOCK_BOOKING);
    const res = await GET(makeRequest(BOOKING_ID), makeParams(BOOKING_ID));
    expect(res.status).toBe(404);
  });

  it("returns the booking when owner requests it", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindUnique.mockResolvedValueOnce(MOCK_BOOKING);
    const res = await GET(makeRequest(BOOKING_ID), makeParams(BOOKING_ID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.booking.id).toBe(BOOKING_ID);
    expect(body.booking.status).toBe("confirmed");
  });

  it("queries by the correct booking id", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindUnique.mockResolvedValueOnce(MOCK_BOOKING);
    await GET(makeRequest(BOOKING_ID), makeParams(BOOKING_ID));
    expect(mockFindUnique).toHaveBeenCalledWith({ where: { id: BOOKING_ID } });
  });
});
