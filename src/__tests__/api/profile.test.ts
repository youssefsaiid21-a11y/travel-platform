import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
const mockFindUnique = vi.hoisted(() => vi.fn());
const mockDeleteMany = vi.hoisted(() => vi.fn());
const mockUpsert = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  db: {
    passengerProfile: {
      findUnique: mockFindUnique,
      deleteMany: mockDeleteMany,
      upsert: mockUpsert,
    },
  },
}));

import { GET, DELETE, POST } from "@/app/api/profile/passenger/route";

const MOCK_USER_ID = "usr_test_001";
const MOCK_PROFILE = {
  id: "prof_1",
  userId: MOCK_USER_ID,
  givenName: "Jane",
  familyName: "Smith",
  bornOn: "1990-05-15",
  gender: "f",
  title: "ms",
  phone: "+44 7700 900123",
  specialRequests: null,
  createdAt: new Date("2026-07-01"),
  updatedAt: new Date("2026-07-01"),
};

function makeRequest(method = "GET", body?: object) {
  return new NextRequest("http://localhost/api/profile/passenger", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockFindUnique.mockReset();
  mockDeleteMany.mockReset();
  mockUpsert.mockReset();
});

describe("GET /api/profile/passenger", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("returns null when no profile exists", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindUnique.mockResolvedValueOnce(null);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toBeNull();
  });

  it("returns the profile when it exists", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindUnique.mockResolvedValueOnce(MOCK_PROFILE);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.givenName).toBe("Jane");
    expect(body.familyName).toBe("Smith");
  });
});

describe("DELETE /api/profile/passenger", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await DELETE();
    expect(res.status).toBe(401);
  });

  it("deletes the profile and returns ok", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockDeleteMany.mockResolvedValueOnce({ count: 1 });
    const res = await DELETE();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockDeleteMany).toHaveBeenCalledWith({ where: { userId: MOCK_USER_ID } });
  });
});

describe("POST /api/profile/passenger", () => {
  const VALID_BODY = {
    givenName: "Jane",
    familyName: "Smith",
    bornOn: "1990-05-15",
    gender: "f",
    title: "ms",
    phone: "+44 7700 900123",
  };

  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await POST(makeRequest("POST", VALID_BODY));
    expect(res.status).toBe(401);
  });

  it("creates/updates profile with valid data", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockUpsert.mockResolvedValueOnce(MOCK_PROFILE);
    const res = await POST(makeRequest("POST", VALID_BODY));
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: MOCK_USER_ID },
      })
    );
  });

  it("returns 400 when required fields are missing", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    const res = await POST(makeRequest("POST", { givenName: "Jane" }));
    expect(res.status).toBe(400);
  });

  it("saves passport/nationality fields when provided", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockUpsert.mockResolvedValueOnce(MOCK_PROFILE);
    const res = await POST(makeRequest("POST", {
      ...VALID_BODY,
      nationality: "GB",
      passportNumber: "987654321",
      passportExpiry: "2035-01-01",
    }));
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          nationality: "GB",
          passportNumber: "987654321",
          passportExpiry: "2035-01-01",
        }),
      })
    );
  });

  it("still saves the profile with null passport fields when they're omitted (partial save is allowed)", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockUpsert.mockResolvedValueOnce(MOCK_PROFILE);
    const res = await POST(makeRequest("POST", VALID_BODY));
    expect(res.status).toBe(200);
    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({
          nationality: null,
          passportNumber: null,
          passportExpiry: null,
        }),
      })
    );
  });

  it("rejects a nationality that isn't a valid 2-letter code, even though passport fields are otherwise optional", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    const res = await POST(
      makeRequest("POST", { ...VALID_BODY, nationality: "United Kingdom" })
    );
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });

  it("rejects an unparseable passport expiry date", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    const res = await POST(
      makeRequest("POST", { ...VALID_BODY, passportExpiry: "not-a-date" })
    );
    expect(res.status).toBe(400);
    expect(mockUpsert).not.toHaveBeenCalled();
  });
});
