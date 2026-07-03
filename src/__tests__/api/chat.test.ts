import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NormalizedOffer } from "@/lib/duffel/types";
import type { ChatResponse } from "@/app/api/chat/route";

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

vi.mock("@/lib/duffel/search", () => ({
  searchWithFallback: vi.fn(),
  rankOffers: (offers: NormalizedOffer[]) => offers,
  filterByPreferences: (offers: NormalizedOffer[]) => ({ offers, note: null }),
  getPriceCalendar: vi.fn().mockResolvedValue([]),
}));

vi.mock("@/lib/duffel/explore", () => ({
  exploreDestinations: vi.fn(),
}));

import { searchWithFallback } from "@/lib/duffel/search";
import { exploreDestinations } from "@/lib/duffel/explore";
import { POST } from "@/app/api/chat/route";
import { NextRequest } from "next/server";

function makeRequest(body: object) {
  return new NextRequest("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeToolResponse(args: Record<string, unknown>) {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            {
              type: "function",
              function: {
                name: "extract_flight_search",
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
  };
}

// Parse the SSE stream from a POST response and return the `done` event data
async function readSSE(res: Response): Promise<ChatResponse> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let evt = "";
  let result: ChatResponse | null = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        evt = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        const data = JSON.parse(line.slice(6));
        if (evt === "done") result = data as ChatResponse;
        evt = "";
      }
    }
  }

  if (!result) throw new Error("SSE stream ended without a done event");
  return result;
}

const MOCK_OFFER: NormalizedOffer = {
  id: "off_test_001",
  expires_at: "2026-08-01T12:00:00Z",
  total_amount: "350.00",
  total_currency: "GBP",
  base_amount: "300.00",
  tax_amount: "50.00",
  owner: { iata_code: "BA", name: "British Airways" },
  slices: [
    {
      duration: "PT7H30M",
      stops: 0,
      segments: [
        {
          departing_at: "2026-09-01T08:00:00",
          arriving_at: "2026-09-01T15:30:00",
          duration: "PT7H30M",
          origin: { iata_code: "LHR", name: "Heathrow" },
          destination: { iata_code: "JFK", name: "John F Kennedy" },
          marketing_carrier: { iata_code: "BA", name: "British Airways" },
          operating_carrier: { iata_code: "BA", name: "British Airways" },
          flight_number: "117",
        },
      ],
    },
  ],
  conditions: { refundable: false, changeable: true },
  passengers: [{ id: "pas_test_001", type: "adult" }],
};

const MOCK_SEARCH_RESULT = {
  offers: [MOCK_OFFER],
  usedParams: {
    origin: "LHR",
    destination: "JFK",
    departure_date: "2026-09-01",
    passengers: [{ type: "adult" as const, count: 1 }],
  },
  dateAdjusted: false,
};

describe("POST /api/chat", () => {
  beforeEach(() => {
    mockCreate.mockReset();
    vi.mocked(searchWithFallback).mockReset();
    vi.mocked(searchWithFallback).mockResolvedValue(MOCK_SEARCH_RESULT);
    vi.mocked(exploreDestinations).mockReset();
    // generateSearchReply calls mockCreate a second time; let it return undefined → uses template fallback
  });

  it("returns 400 when message is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("initial search: parses NL, calls Duffel, returns offers via SSE", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "JFK",
        departure_date: "2026-09-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const res = await POST(
      makeRequest({ message: "Fly London to New York September 1st" })
    );

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const body = await readSSE(res);
    expect(body.session_id).toBeTruthy();
    expect(body.offers).toHaveLength(1);
    expect(body.offers[0].id).toBe("off_test_001");
    expect(body.search_params?.origin).toBe("LHR");
    expect(vi.mocked(searchWithFallback)).toHaveBeenCalledTimes(1);
  });

  it("follow-up triggers a FRESH Duffel call, not a cached result", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "JFK",
        departure_date: "2026-09-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const first = await POST(
      makeRequest({ message: "London to New York September 1st" })
    );
    const { session_id } = await readSSE(first);

    const businessResult = {
      ...MOCK_SEARCH_RESULT,
      usedParams: { ...MOCK_SEARCH_RESULT.usedParams, cabin_class: "business" as const },
    };
    vi.mocked(searchWithFallback).mockResolvedValueOnce(businessResult);

    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "JFK",
        departure_date: "2026-09-01",
        cabin_class: "business",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const second = await POST(
      makeRequest({ message: "Make it business class", session_id })
    );
    const secondBody = await readSSE(second);

    expect(secondBody.search_params?.cabin_class).toBe("business");
    expect(vi.mocked(searchWithFallback)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(searchWithFallback).mock.calls[1][0].cabin_class).toBe("business");
  });

  it("preserves session across turns - same session_id returned", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "JFK",
        departure_date: "2026-09-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const first = await POST(makeRequest({ message: "LHR to JFK September 1" }));
    const { session_id: sid1 } = await readSSE(first);

    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "JFK",
        departure_date: "2026-09-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const second = await POST(
      makeRequest({ message: "show me economy options", session_id: sid1 })
    );
    const { session_id: sid2 } = await readSSE(second);

    expect(sid1).toBe(sid2);
  });

  it("returns friendly reply when NL parse fails, no Duffel call made", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({ error: "Not a flight search." })
    );
    const res = await POST(makeRequest({ message: "Tell me a joke" }));
    const body = await readSSE(res);

    expect(body.offers).toHaveLength(0);
    expect(body.reply).toBeTruthy();
    expect(vi.mocked(searchWithFallback)).not.toHaveBeenCalled();
  });

  it("returns validation error for past departure date, no Duffel call", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "JFK",
        departure_date: "2020-01-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const res = await POST(makeRequest({ message: "London to New York January 1st 2020" }));
    const body = await readSSE(res);

    expect(body.offers).toHaveLength(0);
    expect(body.reply).toMatch(/past/i);
    expect(body.search_failed).toBe(true);
    expect(vi.mocked(searchWithFallback)).not.toHaveBeenCalled();
  });

  it("flags search_failed and gives a generic airport message when Duffel rejects a multi-city search", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "CDG",
        departure_date: "2026-09-01",
        passengers: [{ type: "adult", count: 1 }],
        additional_slices: [
          { origin: "CDG", destination: "XXX", departure_date: "2026-09-05" },
        ],
      })
    );
    const { DuffelError } = await import("@/lib/duffel/client");
    vi.mocked(searchWithFallback).mockRejectedValueOnce(
      new DuffelError(
        {
          errors: [{
            code: "destination_airport_not_found",
            type: "validation_error",
            title: "Invalid destination",
            message: "Invalid destination",
            documentation_url: "",
          }],
          meta: { request_id: "req_1", status: 422 },
        },
        422
      )
    );

    const res = await POST(makeRequest({ message: "LHR to Paris then Paris to XXX" }));
    const body = await readSSE(res);

    expect(body.offers).toHaveLength(0);
    expect(body.search_failed).toBe(true);
    expect(body.reply).toMatch(/one of the destination airports/i);
    expect(body.reply).not.toContain("CDG"); // doesn't misattribute the error to the valid top-level destination
  });

  it("explore-anywhere mode: no destination in the parsed tool call skips validateParams/searchWithFallback and returns ranked destinations", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        departure_date: "2026-09-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    vi.mocked(exploreDestinations).mockResolvedValueOnce([
      { destination: "CDG", city: "Paris", country: "France", cheapestAmount: "80.00", currency: "GBP", airline: "Air France" },
      { destination: "JFK", city: "New York", country: "United States", cheapestAmount: "350.00", currency: "GBP", airline: "British Airways" },
    ]);

    const res = await POST(
      makeRequest({ message: "Cheap flights from London this weekend, anywhere" })
    );
    const body = await readSSE(res);

    expect(body.offers).toHaveLength(0);
    expect(body.search_params).toBeNull();
    expect(body.explore_results).toHaveLength(2);
    expect(body.explore_results?.[0].destination).toBe("CDG");
    expect(body.explore_params?.origin).toBe("LHR");
    expect(body.reply).toMatch(/Paris/);
    expect(vi.mocked(searchWithFallback)).not.toHaveBeenCalled();
    expect(vi.mocked(exploreDestinations)).toHaveBeenCalledTimes(1);
  });

  it("explore-anywhere mode: empty results still returns a friendly reply instead of an error", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        departure_date: "2026-09-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    vi.mocked(exploreDestinations).mockResolvedValueOnce([]);

    const res = await POST(makeRequest({ message: "Anywhere from London this weekend" }));
    const body = await readSSE(res);

    expect(body.explore_results).toEqual([]);
    expect(body.reply).toBeTruthy();
    expect(body.search_params).toBeNull();
  });

  it("offer prices are raw strings from Duffel - no computed price in response", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "JFK",
        departure_date: "2026-09-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const res = await POST(makeRequest({ message: "London to JFK" }));
    const body = await readSSE(res);

    const offer = body.offers[0] as NormalizedOffer;
    expect(offer.total_amount).toBe("350.00");
    expect(offer.total_currency).toBe("GBP");
    expect((body.search_params as unknown as Record<string, unknown>)?.total_amount).toBeUndefined();
  });
});
