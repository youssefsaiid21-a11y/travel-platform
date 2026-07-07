import { describe, it, expect, vi, beforeEach } from "vitest";
import type { JWT } from "next-auth/jwt";

const mockFindUnique = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: { user: { findUnique: mockFindUnique } },
}));

// auth.ts calls NextAuth(...) at module load time, which needs real provider
// config - mocking next-auth itself keeps this test scoped to just
// verifyTokenVersion without needing a full NextAuth setup.
vi.mock("next-auth", () => ({
  default: () => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
}));
vi.mock("next-auth/providers/credentials", () => ({ default: vi.fn() }));

import { verifyTokenVersion } from "@/auth";

const MOCK_TOKEN: JWT = { id: "usr_test_001", tokenVersion: 2 };

beforeEach(() => {
  mockFindUnique.mockReset();
});

describe("verifyTokenVersion", () => {
  it("returns the token unchanged when the DB's tokenVersion still matches", async () => {
    mockFindUnique.mockResolvedValueOnce({ tokenVersion: 2 });
    const result = await verifyTokenVersion(MOCK_TOKEN);
    expect(result).toEqual(MOCK_TOKEN);
  });

  it("returns null when the DB's tokenVersion has moved on (e.g. password changed)", async () => {
    mockFindUnique.mockResolvedValueOnce({ tokenVersion: 3 });
    const result = await verifyTokenVersion(MOCK_TOKEN);
    expect(result).toBeNull();
  });

  it("returns null when the user no longer exists", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const result = await verifyTokenVersion(MOCK_TOKEN);
    expect(result).toBeNull();
  });
});
