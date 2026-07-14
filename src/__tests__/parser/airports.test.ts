import { describe, it, expect } from "vitest";
import { normalizeAirportCode, METRO_TO_AIRPORT } from "@/lib/parser/airports";

describe("normalizeAirportCode", () => {
  it("maps a known IATA metro code to its primary airport (ROM -> FCO)", () => {
    expect(normalizeAirportCode("ROM")).toBe("FCO");
  });

  it("is case-insensitive", () => {
    expect(normalizeAirportCode("rom")).toBe("FCO");
  });

  it("leaves a real (non-metro) airport code unchanged", () => {
    expect(normalizeAirportCode("FCO")).toBe("FCO");
    expect(normalizeAirportCode("LHR")).toBe("LHR");
    expect(normalizeAirportCode("JFK")).toBe("JFK");
  });

  it("uppercases and slices to 3 chars like every existing call site did", () => {
    expect(normalizeAirportCode("mad")).toBe("MAD");
    expect(normalizeAirportCode("madx")).toBe("MAD");
  });

  it("maps every entry in METRO_TO_AIRPORT to its declared primary airport", () => {
    for (const [metro, airport] of Object.entries(METRO_TO_AIRPORT)) {
      expect(normalizeAirportCode(metro)).toBe(airport);
    }
  });
});
