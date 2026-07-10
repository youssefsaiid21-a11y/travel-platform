import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BookingNotificationData } from "@/lib/notifications";
import { sendConfirmationEmail, sendAccountRecoveryEmail } from "@/lib/notifications/email";

const ORIGINAL_FETCH = global.fetch;
const ORIGINAL_KEY = process.env.RESEND_API_KEY;

function makeData(overrides: Partial<BookingNotificationData> = {}): BookingNotificationData {
  return {
    bookingId: "bkng_1",
    bookingRef: "ABC123",
    passengerName: "Jane Doe",
    origin: "LHR",
    destination: "JFK",
    departureDate: "1 Sep 2026",
    totalAmount: "342.50",
    totalCurrency: "GBP",
    userEmail: "jane@example.com",
    userPhone: null,
    appUrl: "https://orbi.travel",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.RESEND_API_KEY = "test_key";
  global.fetch = vi.fn().mockResolvedValue({ ok: true, text: async () => "" }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_KEY === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = ORIGINAL_KEY;
});

describe("sendConfirmationEmail - HTML escaping", () => {
  it("escapes HTML-significant characters in the passenger's name before it reaches the email body", async () => {
    // given_name/family_name are only checked for non-emptiness
    // (passengerValidation.ts), not restricted to a character allowlist -
    // this is what a passenger name containing markup would look like by
    // the time it reaches the email template.
    await sendConfirmationEmail(
      makeData({ passengerName: '<img src=x onerror=alert(1)> & "quoted"' })
    );

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);

    expect(body.html).not.toContain("<img src=x onerror=alert(1)>");
    expect(body.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(body.html).toContain("&amp;");
    expect(body.html).toContain("&quot;quoted&quot;");
  });

  it("escapes an apostrophe in the passenger's name", async () => {
    await sendConfirmationEmail(makeData({ passengerName: "Jane O'Brien" }));

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.html).toContain("Jane O&#39;Brien");
  });
});

describe("sendAccountRecoveryEmail", () => {
  it("fails open (no throw) when RESEND_API_KEY is unset", async () => {
    delete process.env.RESEND_API_KEY;
    await expect(
      sendAccountRecoveryEmail({ userEmail: "jane@example.com", recoveryUrl: "https://orbi.travel/reset-password?token=abc" })
    ).resolves.toBeUndefined();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("sends to the requesting user with the recovery link embedded", async () => {
    await sendAccountRecoveryEmail({
      userEmail: "jane@example.com",
      recoveryUrl: "https://orbi.travel/reset-password?token=abc123",
    });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);

    expect(body.to).toEqual(["jane@example.com"]);
    expect(body.from).toContain("security@orbi.travel");
    expect(body.html).toContain("https://orbi.travel/reset-password?token=abc123");
  });

  it("logs a truncated error on a non-ok Resend response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 422,
      text: async () => "x".repeat(1000),
    }) as unknown as typeof fetch;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    await sendAccountRecoveryEmail({ userEmail: "jane@example.com", recoveryUrl: "https://orbi.travel/reset-password?token=abc" });

    expect(errSpy).toHaveBeenCalled();
    const loggedBody = errSpy.mock.calls[0][2] as string;
    expect(loggedBody.length).toBeLessThanOrEqual(300);
    errSpy.mockRestore();
  });
});
