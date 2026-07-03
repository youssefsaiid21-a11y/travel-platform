import { describe, it, expect } from "vitest";
import { layoverMinutes, formatLayover, getLayovers } from "@/lib/duffel/layover";
import type { NormalizedOffer, NormalizedSegment } from "@/lib/duffel/types";

function makeSegment(params: {
  origin: string;
  destination: string;
  departing_at: string;
  arriving_at: string;
}): NormalizedSegment {
  return {
    duration: "PT2H0M",
    origin: { iata_code: params.origin, name: params.origin },
    destination: { iata_code: params.destination, name: params.destination },
    marketing_carrier: { iata_code: "ZZ", name: "Duffel Airways" },
    operating_carrier: { iata_code: "ZZ", name: "Duffel Airways" },
    flight_number: "001",
    departing_at: params.departing_at,
    arriving_at: params.arriving_at,
  };
}

function makeOffer(slicesSegments: NormalizedSegment[][]): NormalizedOffer {
  return {
    id: "off_1",
    expires_at: "2026-08-01T00:00:00Z",
    total_amount: "100.00",
    total_currency: "GBP",
    base_amount: "100.00",
    tax_amount: null,
    owner: { iata_code: "ZZ", name: "Duffel Airways" },
    slices: slicesSegments.map((segments) => ({
      duration: "PT10H0M",
      stops: segments.length - 1,
      segments,
    })),
    conditions: { refundable: false, changeable: false },
    passengers: [{ id: "pas_1", type: "adult" }],
  };
}

describe("layoverMinutes", () => {
  it("computes the gap in whole minutes between arrival and the next departure", () => {
    expect(layoverMinutes("2026-10-01T10:00:00", "2026-10-01T11:30:00")).toBe(90);
  });

  it("returns 0 for a back-to-back connection", () => {
    expect(layoverMinutes("2026-10-01T10:00:00", "2026-10-01T10:00:00")).toBe(0);
  });
});

describe("formatLayover", () => {
  it("formats sub-hour layovers as minutes only", () => {
    expect(formatLayover(45)).toBe("45m");
  });

  it("formats layovers over an hour as hours and minutes", () => {
    expect(formatLayover(135)).toBe("2h 15m");
  });

  it("keeps the '0m' suffix for exact-hour layovers", () => {
    expect(formatLayover(120)).toBe("2h 0m");
  });
});

describe("getLayovers", () => {
  it("returns an empty array for a nonstop offer", () => {
    const offer = makeOffer([
      [makeSegment({ origin: "LHR", destination: "JFK", departing_at: "2026-10-01T08:00:00", arriving_at: "2026-10-01T15:00:00" })],
    ]);
    expect(getLayovers(offer)).toEqual([]);
  });

  it("extracts a single layover from a one-stop slice", () => {
    const offer = makeOffer([
      [
        makeSegment({ origin: "LHR", destination: "CDG", departing_at: "2026-10-01T08:00:00", arriving_at: "2026-10-01T09:00:00" }),
        makeSegment({ origin: "CDG", destination: "JFK", departing_at: "2026-10-01T11:00:00", arriving_at: "2026-10-01T18:00:00" }),
      ],
    ]);
    expect(getLayovers(offer)).toEqual([{ airport: "CDG", minutes: 120 }]);
  });

  it("extracts layovers across multiple slices (e.g. outbound + return)", () => {
    const offer = makeOffer([
      [
        makeSegment({ origin: "LHR", destination: "CDG", departing_at: "2026-10-01T08:00:00", arriving_at: "2026-10-01T09:00:00" }),
        makeSegment({ origin: "CDG", destination: "JFK", departing_at: "2026-10-01T11:00:00", arriving_at: "2026-10-01T18:00:00" }),
      ],
      [
        makeSegment({ origin: "JFK", destination: "BOS", departing_at: "2026-10-08T08:00:00", arriving_at: "2026-10-08T09:15:00" }),
        makeSegment({ origin: "BOS", destination: "LHR", departing_at: "2026-10-08T10:00:00", arriving_at: "2026-10-08T20:00:00" }),
      ],
    ]);
    expect(getLayovers(offer)).toEqual([
      { airport: "CDG", minutes: 120 },
      { airport: "BOS", minutes: 45 },
    ]);
  });
});
