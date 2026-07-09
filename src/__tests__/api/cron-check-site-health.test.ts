import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockSendAlertEmail = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/notifications/email", () => ({
  sendAlertEmail: mockSendAlertEmail,
}));

import { POST } from "@/app/api/cron/check-site-health/route";

function makeRequest() {
  return new NextRequest("http://localhost/api/cron/check-site-health", { method: "POST" });
}

const originalFetch = global.fetch;

beforeEach(() => {
  mockSendAlertEmail.mockReset().mockResolvedValue(undefined);
  mockFetch.mockReset();
  global.fetch = mockFetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

describe("POST /api/cron/check-site-health", () => {
  it("reports ok and does not alert when the site responds successfully", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(mockSendAlertEmail).not.toHaveBeenCalled();
  });

  it("alerts when the site responds with a non-ok status", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(mockSendAlertEmail).toHaveBeenCalledWith(
      expect.stringContaining("health check failed"),
      expect.stringContaining("HTTP 500")
    );
  });

  it("alerts when the fetch itself throws (network error/timeout)", async () => {
    mockFetch.mockRejectedValueOnce(new Error("timeout"));

    const res = await POST(makeRequest());
    const body = await res.json();

    expect(body.ok).toBe(false);
    expect(mockSendAlertEmail).toHaveBeenCalledWith(
      expect.stringContaining("health check failed"),
      expect.stringContaining("timeout")
    );
  });
});
