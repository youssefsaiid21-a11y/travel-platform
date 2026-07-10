// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CookieConsentBanner } from "@/components/CookieConsentBanner";

function clearCookies() {
  document.cookie = "orbi_cookie_consent=; path=/; max-age=0";
}

afterEach(() => {
  cleanup();
  clearCookies();
});

describe("CookieConsentBanner", () => {
  it("shows the banner when no consent decision has been made yet", () => {
    render(<CookieConsentBanner />);
    expect(screen.getByRole("dialog", { name: "Cookie consent" })).toBeTruthy();
  });

  it("does not show the banner when consent was already accepted", () => {
    document.cookie = "orbi_cookie_consent=accepted; path=/";
    render(<CookieConsentBanner />);
    expect(screen.queryByRole("dialog", { name: "Cookie consent" })).toBeNull();
  });

  it("does not show the banner when consent was already declined", () => {
    document.cookie = "orbi_cookie_consent=declined; path=/";
    render(<CookieConsentBanner />);
    expect(screen.queryByRole("dialog", { name: "Cookie consent" })).toBeNull();
  });

  it("sets an accepted consent cookie and hides the banner on Accept", () => {
    render(<CookieConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(document.cookie).toContain("orbi_cookie_consent=accepted");
    expect(screen.queryByRole("dialog", { name: "Cookie consent" })).toBeNull();
  });

  it("sets a declined consent cookie and hides the banner on Decline", () => {
    render(<CookieConsentBanner />);
    fireEvent.click(screen.getByRole("button", { name: "Decline non-essential" }));
    expect(document.cookie).toContain("orbi_cookie_consent=declined");
    expect(screen.queryByRole("dialog", { name: "Cookie consent" })).toBeNull();
  });

  it("moves focus to the dialog when it appears", () => {
    render(<CookieConsentBanner />);
    expect(document.activeElement).toBe(screen.getByRole("dialog", { name: "Cookie consent" }));
  });

  it("treats Escape as a decline decision", () => {
    render(<CookieConsentBanner />);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Cookie consent" }), { key: "Escape" });
    expect(document.cookie).toContain("orbi_cookie_consent=declined");
    expect(screen.queryByRole("dialog", { name: "Cookie consent" })).toBeNull();
  });
});
