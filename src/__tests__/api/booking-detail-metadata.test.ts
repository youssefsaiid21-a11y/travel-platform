import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.hoisted(() => vi.fn());
const mockFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  db: { booking: { findUnique: mockFindUnique } },
}));
vi.mock("@/lib/duffel/orders", () => ({
  getOrderStatus: vi.fn(),
  checkForScheduleChanges: vi.fn(),
}));

import { generateMetadata } from "@/app/booking/[id]/page";

const OWNER_ID = "usr_owner_001";
const OTHER_ID = "usr_other_002";
const BOOKING_ID = "bkng_abc123";

const OFFER_SNAPSHOT = JSON.stringify({
  slices: [
    {
      segments: [
        { origin: { iata_code: "LHR" }, destination: { iata_code: "JFK" } },
      ],
    },
  ],
});

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

beforeEach(() => {
  mockAuth.mockReset();
  mockFindUnique.mockReset();
});

describe("generateMetadata for /booking/[id]", () => {
  it("does not leak the route or PNR when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const meta = await generateMetadata(makeParams(BOOKING_ID));
    expect(meta.title).toBe("Booking · Orbi");
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("does not leak the route or PNR to a user who does not own the booking", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: OTHER_ID } });
    mockFindUnique.mockResolvedValueOnce({
      offerSnapshot: OFFER_SNAPSHOT,
      duffelBookingRef: "DUF123",
      userId: OWNER_ID,
    });
    const meta = await generateMetadata(makeParams(BOOKING_ID));
    expect(meta.title).toBe("Booking · Orbi");
  });

  it("shows the route and PNR to the booking's owner", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: OWNER_ID } });
    mockFindUnique.mockResolvedValueOnce({
      offerSnapshot: OFFER_SNAPSHOT,
      duffelBookingRef: "DUF123",
      userId: OWNER_ID,
    });
    const meta = await generateMetadata(makeParams(BOOKING_ID));
    expect(meta.title).toBe("LHR → JFK · DUF123 · Orbi");
  });

  it("returns a generic title when the booking does not exist", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: OWNER_ID } });
    mockFindUnique.mockResolvedValueOnce(null);
    const meta = await generateMetadata(makeParams("nonexistent"));
    expect(meta.title).toBe("Booking · Orbi");
  });
});
