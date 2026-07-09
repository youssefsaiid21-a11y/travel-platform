import { describe, it, expect, vi, beforeEach } from "vitest";

const mockAuth = vi.hoisted(() => vi.fn());
const mockUserFindUnique = vi.hoisted(() => vi.fn());
const mockPassengerFindUnique = vi.hoisted(() => vi.fn());
const mockBookingFindMany = vi.hoisted(() => vi.fn());
const mockTrackedSearchFindMany = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: mockAuth }));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: mockUserFindUnique },
    passengerProfile: { findUnique: mockPassengerFindUnique },
    booking: { findMany: mockBookingFindMany },
    trackedSearch: { findMany: mockTrackedSearchFindMany },
  },
}));

import { GET } from "@/app/api/account/export/route";

const USER_ID = "usr_1";

beforeEach(() => {
  mockAuth.mockReset();
  mockUserFindUnique.mockReset();
  mockPassengerFindUnique.mockReset();
  mockBookingFindMany.mockReset();
  mockTrackedSearchFindMany.mockReset();
});

describe("GET /api/account/export", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns the user's full data with the passport number decrypted", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockUserFindUnique.mockResolvedValueOnce({
      id: USER_ID,
      email: "jane@example.com",
      name: "Jane Smith",
      createdAt: new Date("2026-01-01"),
    });
    const { encryptField } = await import("@/lib/crypto");
    mockPassengerFindUnique.mockResolvedValueOnce({
      userId: USER_ID,
      passportNumber: encryptField("123456789"),
      nationality: "GB",
    });
    mockBookingFindMany.mockResolvedValueOnce([{ id: "bkng_1" }]);
    mockTrackedSearchFindMany.mockResolvedValueOnce([]);

    const res = await GET();
    const body = await res.json();

    expect(body.user.email).toBe("jane@example.com");
    expect(body.passengerProfile.passportNumber).toBe("123456789");
    expect(body.bookings).toEqual([{ id: "bkng_1" }]);
  });

  it("returns null passengerProfile when none exists", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockUserFindUnique.mockResolvedValueOnce({ id: USER_ID, email: "x@example.com", name: null, createdAt: new Date() });
    mockPassengerFindUnique.mockResolvedValueOnce(null);
    mockBookingFindMany.mockResolvedValueOnce([]);
    mockTrackedSearchFindMany.mockResolvedValueOnce([]);

    const res = await GET();
    const body = await res.json();
    expect(body.passengerProfile).toBeNull();
  });
});
