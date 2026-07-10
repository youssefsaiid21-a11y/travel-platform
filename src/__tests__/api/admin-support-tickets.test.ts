import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.hoisted(() => vi.fn());
const mockUserFindUnique = vi.hoisted(() => vi.fn());
const mockTicketFindMany = vi.hoisted(() => vi.fn());
const mockTicketUpdate = vi.hoisted(() => vi.fn());

vi.mock("@/auth", () => ({ auth: mockAuth }));

vi.mock("@/lib/db", () => ({
  db: {
    user: { findUnique: mockUserFindUnique },
    supportTicket: { findMany: mockTicketFindMany, update: mockTicketUpdate },
  },
}));

import { GET } from "@/app/api/admin/support-tickets/route";
import { PATCH } from "@/app/api/admin/support-tickets/[id]/route";

const ADMIN_ID = "usr_admin";

function makeGetRequest(query = "") {
  return new NextRequest(`http://localhost/api/admin/support-tickets${query}`);
}

function makePatchRequest(body: object) {
  return new NextRequest("http://localhost/api/admin/support-tickets/tick_1", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mockAuth.mockReset();
  mockUserFindUnique.mockReset();
  mockTicketFindMany.mockReset();
  mockTicketUpdate.mockReset();
});

describe("GET /api/admin/support-tickets", () => {
  it("returns 401 when there is no session", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(401);
    expect(mockTicketFindMany).not.toHaveBeenCalled();
  });

  it("returns 403 when the session's isAdmin claim is false", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: ADMIN_ID, isAdmin: false } });
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(403);
    expect(mockTicketFindMany).not.toHaveBeenCalled();
  });

  it("returns 403 when the JWT claims isAdmin but the DB re-check says otherwise (demoted admin)", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: ADMIN_ID, isAdmin: true } });
    mockUserFindUnique.mockResolvedValueOnce({ isAdmin: false });
    const res = await GET(makeGetRequest());
    expect(res.status).toBe(403);
    expect(mockTicketFindMany).not.toHaveBeenCalled();
  });

  it("returns tickets for a real admin", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: ADMIN_ID, isAdmin: true } });
    mockUserFindUnique.mockResolvedValueOnce({ isAdmin: true });
    mockTicketFindMany.mockResolvedValueOnce([{ id: "tick_1", status: "open" }]);

    const res = await GET(makeGetRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tickets).toHaveLength(1);
    expect(mockTicketFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined })
    );
  });

  it("filters by status when provided", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: ADMIN_ID, isAdmin: true } });
    mockUserFindUnique.mockResolvedValueOnce({ isAdmin: true });
    mockTicketFindMany.mockResolvedValueOnce([]);

    await GET(makeGetRequest("?status=resolved"));
    expect(mockTicketFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: "resolved" } })
    );
  });
});

describe("PATCH /api/admin/support-tickets/[id]", () => {
  function params() {
    return { params: Promise.resolve({ id: "tick_1" }) };
  }

  it("returns 401 when there is no session", async () => {
    mockAuth.mockResolvedValueOnce(null);
    const res = await PATCH(makePatchRequest({ status: "resolved" }), params());
    expect(res.status).toBe(401);
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });

  it("returns 403 for a non-admin session", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: ADMIN_ID, isAdmin: false } });
    const res = await PATCH(makePatchRequest({ status: "resolved" }), params());
    expect(res.status).toBe(403);
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });

  it("rejects an invalid status value", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: ADMIN_ID, isAdmin: true } });
    mockUserFindUnique.mockResolvedValueOnce({ isAdmin: true });
    const res = await PATCH(makePatchRequest({ status: "deleted" }), params());
    expect(res.status).toBe(400);
    expect(mockTicketUpdate).not.toHaveBeenCalled();
  });

  it("updates the ticket status for a real admin", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: ADMIN_ID, isAdmin: true } });
    mockUserFindUnique.mockResolvedValueOnce({ isAdmin: true });
    mockTicketUpdate.mockResolvedValueOnce({ id: "tick_1", status: "resolved" });

    const res = await PATCH(makePatchRequest({ status: "resolved" }), params());
    expect(res.status).toBe(200);
    expect(mockTicketUpdate).toHaveBeenCalledWith({
      where: { id: "tick_1" },
      data: { status: "resolved" },
    });
  });

  it("returns 404 when the ticket doesn't exist", async () => {
    mockAuth.mockResolvedValueOnce({ user: { id: ADMIN_ID, isAdmin: true } });
    mockUserFindUnique.mockResolvedValueOnce({ isAdmin: true });
    mockTicketUpdate.mockRejectedValueOnce(new Error("Record not found"));

    const res = await PATCH(makePatchRequest({ status: "resolved" }), params());
    expect(res.status).toBe(404);
  });
});
