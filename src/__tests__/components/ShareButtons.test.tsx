// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { ShareButtons } from "@/components/ShareButtons";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const PROPS = {
  bookingRef: "ABCD12",
  route: "LHR → JFK",
  airline: "British Airways",
  departsAt: "1 Sep, 08:00",
  arrivesAt: "1 Sep, 15:30",
  passengers: ["John Smith"],
  totalAmount: "350.00",
  totalCurrency: "GBP",
};

describe("ShareButtons", () => {
  it("includes a link back to the site in the WhatsApp share message", () => {
    render(<ShareButtons {...PROPS} />);
    const whatsapp = screen.getByLabelText("Share via WhatsApp") as HTMLAnchorElement;
    const decoded = decodeURIComponent(whatsapp.href);
    expect(decoded).toContain("http");
    expect(decoded).toContain("utm_source=share");
  });

  it("uses the iOS sms: format on an iOS user agent", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
      maxTouchPoints: 5,
      share: undefined,
      clipboard: undefined,
    });
    render(<ShareButtons {...PROPS} />);
    const text = screen.getByLabelText("Share via text message") as HTMLAnchorElement;
    expect(text.href.startsWith("sms:&body=")).toBe(true);
    expect(text.textContent).toContain("iMessage");
  });

  it("uses the standard sms: format on a non-iOS user agent", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent: "Mozilla/5.0 (Linux; Android 14)",
      maxTouchPoints: 5,
      share: undefined,
      clipboard: undefined,
    });
    render(<ShareButtons {...PROPS} />);
    const text = screen.getByLabelText("Share via text message") as HTMLAnchorElement;
    expect(text.href.startsWith("sms:?body=")).toBe(true);
    expect(text.textContent).toContain("Text");
  });

  it("shows a native Share button only when navigator.share is supported", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent: "Mozilla/5.0 (Linux; Android 14)",
      maxTouchPoints: 5,
      share: vi.fn(),
    });
    render(<ShareButtons {...PROPS} />);
    expect(screen.getByLabelText("Share")).toBeTruthy();
  });

  it("does not show a native Share button when navigator.share is unsupported", () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      userAgent: "Mozilla/5.0 (Linux; Android 14)",
      maxTouchPoints: 5,
      share: undefined,
    });
    render(<ShareButtons {...PROPS} />);
    expect(screen.queryByLabelText("Share")).toBeNull();
  });

  it("includes an email share option", () => {
    render(<ShareButtons {...PROPS} />);
    const email = screen.getByLabelText("Share via email") as HTMLAnchorElement;
    expect(email.href.startsWith("mailto:")).toBe(true);
  });
});
