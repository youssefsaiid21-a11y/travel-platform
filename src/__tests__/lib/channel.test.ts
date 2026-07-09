// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { getChannelCookie } from "@/lib/channel";

afterEach(() => {
  document.cookie = "orbi_channel=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/";
});

describe("getChannelCookie", () => {
  it("returns 'direct' when no channel cookie is set", () => {
    expect(getChannelCookie()).toBe("direct");
  });

  it("returns the cookie value when set", () => {
    document.cookie = "orbi_channel=producthunt";
    expect(getChannelCookie()).toBe("producthunt");
  });

  it("decodes a URL-encoded cookie value", () => {
    document.cookie = `orbi_channel=${encodeURIComponent("r/flights")}`;
    expect(getChannelCookie()).toBe("r/flights");
  });
});
