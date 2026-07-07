import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
const mockFindUnique = vi.hoisted(() => vi.fn());
const mockUpdate = vi.hoisted(() => vi.fn());
const mockBcryptCompare = vi.hoisted(() => vi.fn());
const mockBcryptHash = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: mockAuth }));
vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: mockFindUnique,
      update: mockUpdate,
    },
  },
}));
vi.mock("bcryptjs", () => ({
  default: {
    compare: mockBcryptCompare,
    hash: mockBcryptHash,
  },
}));

import { POST } from "@/app/api/auth/change-password/route";

const MOCK_USER_ID = "usr_test_001";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/auth/change-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockFindUnique.mockReset();
  mockUpdate.mockReset();
  mockBcryptCompare.mockReset();
  mockBcryptHash.mockReset();
});

describe("POST /api/auth/change-password", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await POST(makeRequest({ currentPassword: "old123456", newPassword: "new123456" }));
    expect(res.status).toBe(401);
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("returns 400 when currentPassword is missing", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    const res = await POST(makeRequest({ newPassword: "new123456" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when newPassword is missing", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    const res = await POST(makeRequest({ currentPassword: "old123456" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 when newPassword is too short", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    const res = await POST(makeRequest({ currentPassword: "old123456", newPassword: "short" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/8/);
  });

  it("returns 400 when new password equals current password", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    const res = await POST(makeRequest({ currentPassword: "samePass1", newPassword: "samePass1" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/differ/i);
  });

  it("returns 400 when current password is incorrect", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindUnique.mockResolvedValueOnce({ passwordHash: "$2b$12$hashed_old" });
    mockBcryptCompare.mockResolvedValueOnce(false);

    const res = await POST(makeRequest({ currentPassword: "wrongPass", newPassword: "newPass123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/incorrect/i);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("updates passwordHash and returns ok on success", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindUnique.mockResolvedValueOnce({ passwordHash: "$2b$12$hashed_old" });
    mockBcryptCompare.mockResolvedValueOnce(true);
    mockBcryptHash.mockResolvedValueOnce("$2b$12$hashed_new");
    mockUpdate.mockResolvedValueOnce({});

    const res = await POST(makeRequest({ currentPassword: "oldPass123", newPassword: "newPass456" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: MOCK_USER_ID },
      data: { passwordHash: "$2b$12$hashed_new", tokenVersion: { increment: 1 } },
    });
  });

  it("bumps tokenVersion on password change - this is what revokes other sessions", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindUnique.mockResolvedValueOnce({ passwordHash: "$2b$12$hashed_old" });
    mockBcryptCompare.mockResolvedValueOnce(true);
    mockBcryptHash.mockResolvedValueOnce("$2b$12$hashed_new");
    mockUpdate.mockResolvedValueOnce({});

    await POST(makeRequest({ currentPassword: "oldPass123", newPassword: "newPass456" }));
    expect(mockUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ tokenVersion: { increment: 1 } }) })
    );
  });

  it("hashes new password with cost factor 12", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: MOCK_USER_ID } });
    mockFindUnique.mockResolvedValueOnce({ passwordHash: "$2b$12$hashed_old" });
    mockBcryptCompare.mockResolvedValueOnce(true);
    mockBcryptHash.mockResolvedValueOnce("$2b$12$hashed_new");
    mockUpdate.mockResolvedValueOnce({});

    await POST(makeRequest({ currentPassword: "oldPass123", newPassword: "newPass456" }));
    expect(mockBcryptHash).toHaveBeenCalledWith("newPass456", 12);
  });
});

describe("POST /api/auth/change-password rate limiting (outside test NODE_ENV)", () => {
  const RATE_LIMITED_USER = "usr_rate_limit_target";

  beforeEach(() => {
    vi.stubEnv("NODE_ENV", "production");
  });

  afterEach(() => {
    vi.stubEnv("NODE_ENV", "test");
  });

  it("returns 429 after too many attempts from the same user", async () => {
    mockAuth.mockResolvedValue({ user: { id: RATE_LIMITED_USER } });
    mockFindUnique.mockResolvedValue({ passwordHash: "$2b$12$hashed_old" });
    mockBcryptCompare.mockResolvedValue(false);

    let lastRes;
    for (let i = 0; i < 6; i++) {
      lastRes = await POST(
        makeRequest({ currentPassword: "wrongPass", newPassword: "newPass456" })
      );
    }

    expect(lastRes!.status).toBe(429);
  });
});
