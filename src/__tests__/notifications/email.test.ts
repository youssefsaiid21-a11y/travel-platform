import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { BookingNotificationData } from "@/lib/notifications";
import { sendConfirmationEmail } from "@/lib/notifications/email";

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
