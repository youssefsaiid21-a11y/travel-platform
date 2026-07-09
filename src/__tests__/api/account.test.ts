import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import bcrypt from "bcryptjs";

const mockAuth = vi.hoisted(() => vi.fn());
const mockUserFindUnique = vi.hoisted(() => vi.fn());
const mockUserUpdate = vi.hoisted(() => vi.fn());
const mockPassengerDeleteMany = vi.hoisted(() => vi.fn());
const mockTrackedSearchDeleteMany = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: mockAuth }));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: mockUserFindUnique, update: mockUserUpdate },
    passengerProfile: { deleteMany: mockPassengerDeleteMany },
    trackedSearch: { deleteMany: mockTrackedSearchDeleteMany },
  },
}));

import { DELETE } from "@/app/api/account/route";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/account", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const USER_ID = "usr_1";

beforeEach(() => {
  mockAuth.mockReset();
  mockUserFindUnique.mockReset();
  mockUserUpdate.mockReset();
  mockPassengerDeleteMany.mockReset();
  mockTrackedSearchDeleteMany.mockReset();
});

describe("DELETE /api/account", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await DELETE(makeRequest({ password: "whatever" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when no password is supplied", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    const res = await DELETE(makeRequest({}));
    expect(res.status).toBe(400);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 on an incorrect password, without deleting anything", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockUserFindUnique.mockResolvedValueOnce({ passwordHash: await bcrypt.hash("correct-password", 4) });

    const res = await DELETE(makeRequest({ password: "wrong-password" }));
    expect(res.status).toBe(400);
    expect(mockPassengerDeleteMany).not.toHaveBeenCalled();
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it("deletes passenger profile and tracked searches, then anonymizes the user, on correct password", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: USER_ID } });
    mockUserFindUnique.mockResolvedValueOnce({ passwordHash: await bcrypt.hash("correct-password", 4) });
    mockPassengerDeleteMany.mockResolvedValueOnce({ count: 1 });
    mockTrackedSearchDeleteMany.mockResolvedValueOnce({ count: 2 });
    mockUserUpdate.mockResolvedValueOnce({});

    const res = await DELETE(makeRequest({ password: "correct-password" }));

    expect(res.status).toBe(200);
    expect(mockPassengerDeleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(mockTrackedSearchDeleteMany).toHaveBeenCalledWith({ where: { userId: USER_ID } });
    expect(mockUserUpdate).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: expect.objectContaining({
        email: `deleted-${USER_ID}@deleted.orbi.invalid`,
        name: null,
        tokenVersion: { increment: 1 },
        totpSecret: null,
        totpEnabled: false,
      }),
    });
    // The replacement password hash must not just be some fixed sentinel
    // string - it should be a real, unguessable bcrypt hash.
    const newHash = mockUserUpdate.mock.calls[0][0].data.passwordHash;
    expect(newHash).not.toBe("correct-password");
    expect(await bcrypt.compare("correct-password", newHash)).toBe(false);
  });
});
