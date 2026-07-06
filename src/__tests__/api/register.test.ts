import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

const mockFindUnique = vi.hoisted(() => vi.fn());
const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({
  db: {
    user: {
      findUnique: mockFindUnique,
      create: mockCreate,
    },
  },
}));

vi.mock("bcryptjs", () => ({
  default: {
    hash: vi.fn().mockResolvedValue("$2b$12$hashed"),
  },
}));

// Import after mocks are in place
import { POST } from "@/app/api/auth/register/route";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockFindUnique.mockReset();
  mockCreate.mockReset();
});

describe("POST /api/auth/register", () => {
  it("creates a user and returns 201 on success", async () => {
    mockFindUnique.mockResolvedValueOnce(null); // no existing user
    mockCreate.mockResolvedValueOnce({ id: "usr_1", email: "test@example.com", name: "Test" });

    const res = await POST(makeRequest({ email: "test@example.com", password: "password123", name: "Test" }));
    expect(res.status).toBe(201);

    const body = await res.json();
    expect(body.email).toBe("test@example.com");
    expect(body.passwordHash).toBeUndefined();
  });

  it("returns 400 when email is missing", async () => {
    const res = await POST(makeRequest({ password: "password123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/email/i);
  });

  it("returns 400 when password is missing", async () => {
    const res = await POST(makeRequest({ email: "test@example.com" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/password/i);
  });

  it("returns 400 for invalid email format", async () => {
    const res = await POST(makeRequest({ email: "not-an-email", password: "password123" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/email/i);
  });

  it("returns 400 when password is too short", async () => {
    const res = await POST(makeRequest({ email: "test@example.com", password: "short" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/8/);
  });

  it("returns 409 when email already exists", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "usr_existing", email: "test@example.com" });

    const res = await POST(makeRequest({ email: "test@example.com", password: "password123" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/exist/i);
  });

  it("does not call db.create if email is taken", async () => {
    mockFindUnique.mockResolvedValueOnce({ id: "usr_existing", email: "x@x.com" });
    await POST(makeRequest({ email: "x@x.com", password: "password123" }));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 when password exceeds the maximum length", async () => {
    const res = await POST(
      makeRequest({ email: "test@example.com", password: "a".repeat(129) })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/128/);
  });

  it("returns 409 (not 500) when two concurrent signups race past the existence check for the same email", async () => {
    // Simulates the race the findUnique check can't close on its own: both
    // requests pass the pre-check, and the DB's unique constraint on email
    // is what actually stops the second one.
    mockFindUnique.mockResolvedValueOnce(null);
    mockCreate.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      })
    );

    const res = await POST(
      makeRequest({ email: "race@example.com", password: "password123" })
    );
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/exist/i);
  });
});
