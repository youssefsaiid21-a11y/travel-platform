import { describe, it, expect, vi, beforeEach } from "vitest";

// Regression test: a booking whose payment succeeded but whose offer could
// never be verified (see POST /api/booking's failure paths) stores a
// minimal { offerId, reason } offerSnapshot instead of a full NormalizedOffer.
// Both pages that render offerSnapshot must degrade gracefully instead of
// throwing when they hit one of these rows.

const mockAuth = vi.hoisted(() => vi.fn());
const mockFindUnique = vi.hoisted(() => vi.fn());
const mockFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  db: {
    booking: { findUnique: mockFindUnique, findMany: mockFindMany },
  },
}));
vi.mock("@/lib/duffel/orders", () => ({
  getOrderStatus: vi.fn(),
  checkForScheduleChanges: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }),
  redirect: vi.fn(() => { throw new Error("NEXT_REDIRECT"); }),
}));

import BookingDetailPage from "@/app/booking/[id]/page";
import BookingsPage from "@/app/bookings/page";

const USER_ID = "usr_owner_001";
const BOOKING_ID = "bkng_failed_001";

const UNVERIFIABLE_OFFER_SNAPSHOT = {
  offerId: "off_gone",
  reason: "offer_unavailable",
};

function baseBooking(overrides: Record<string, unknown> = {}) {
  return {
    id: BOOKING_ID,
    userId: USER_ID,
    status: "failed",
    totalAmount: "342.50",
    totalCurrency: "GBP",
    offerSnapshot: UNVERIFIABLE_OFFER_SNAPSHOT,
    searchParams: { origin: "LHR", destination: "JFK" },
    passengerNames: ["Jane Smith"],
    duffelBookingRef: null,
    duffelOrderId: null,
    stripePaymentIntentId: "pi_test_001",
    specialRequests: null,
    createdAt: new Date("2026-07-01"),
    updatedAt: new Date("2026-07-01"),
    ...overrides,
  };
}

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockAuth.mockReset();
  mockFindUnique.mockReset();
  mockFindMany.mockReset();
});

describe("BookingDetailPage with an unverifiable offer snapshot", () => {
  it("renders without throwing instead of crashing on offer.slices", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockFindUnique.mockResolvedValueOnce(baseBooking());

    await expect(BookingDetailPage(makeParams(BOOKING_ID))).resolves.toBeTruthy();
  });
});

describe("BookingsPage with an unverifiable offer snapshot in the list", () => {
  it("renders the whole list without throwing when one booking has no real offer", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockFindMany.mockResolvedValueOnce([
      baseBooking(),
      baseBooking({ id: "bkng_ok_001", status: "confirmed", offerSnapshot: {
        owner: { name: "Duffel Airways" },
        slices: [
          { segments: [{ origin: { iata_code: "LHR" }, destination: { iata_code: "JFK" }, departing_at: "2026-08-01T10:00:00Z" }] },
        ],
      } }),
    ]);

    await expect(BookingsPage()).resolves.toBeTruthy();
  });
});
