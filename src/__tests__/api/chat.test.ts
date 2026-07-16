import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NormalizedOffer } from "@/lib/duffel/types";
import type { ChatResponse, CheckpointEvent } from "@/app/api/chat/route";

const mockCreate = vi.hoisted(() => vi.fn());
const mockSentryCaptureException = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

// Sentry.init no-ops with no DSN set (see CLAUDE.md Phase 1a), but
// captureException is still a real function call the route makes - mock it
// so BUG-0007's telemetry (which phase an unhandled stream error hit) is
// actually asserted, not just inferred from the absence of a thrown error.
// Matches the convention in src/__tests__/api/booking.test.ts.
vi.mock("@sentry/nextjs", () => ({
  captureException: mockSentryCaptureException,
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

// Parses a named SSE event's data out of a response (defaults to "done").
async function readSSEEvent<T>(res: Response, eventName = "done"): Promise<T> {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let evt = "";
  let result: T | null = null;

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
        if (evt === eventName) result = data as T;
        evt = "";
      }
    }
  }

  if (!result) throw new Error(`SSE stream ended without a "${eventName}" event`);
  return result;
}

async function readSSE(res: Response): Promise<ChatResponse> {
  return readSSEEvent<ChatResponse>(res);
}

// Drives a normal (non-explore) search through both round trips a real
// client makes post-Phase-3: the first request returns a "checkpoint"
// event with the parsed params instead of searching immediately, and the
// second (with confirmed_params) actually fires the search. Most tests
// here care about the search's outcome, not the checkpoint step itself -
// this keeps them focused on that. Explore-mode, knowledge-question, and
// parse-failure tests are unaffected and keep using POST/readSSE directly,
// since none of those paths ever reach the checkpoint gate.
async function searchViaCheckpoint(
  message: string,
  session_id?: string
): Promise<{ done: ChatResponse; session_id: string }> {
  const checkpointRes = await POST(makeRequest({ message, session_id }));
  const { params } = await readSSEEvent<CheckpointEvent>(checkpointRes, "checkpoint");
  const doneRes = await POST(makeRequest({ message, session_id, confirmed_params: params }));
  const done = await readSSE(doneRes);
  return { done, session_id: done.session_id };
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
    mockSentryCaptureException.mockReset();
    // generateSearchReply calls mockCreate a second time; let it return undefined → uses template fallback
  });

  it("returns 400 when message is missing", async () => {
    const res = await POST(makeRequest({}));
    expect(res.status).toBe(400);
  });

  it("shows a checkpoint with the parsed params before firing the real search", async () => {
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

    const { params } = await readSSEEvent<CheckpointEvent>(res, "checkpoint");
    expect(params.origin).toBe("LHR");
    expect(params.destination).toBe("JFK");
    expect(vi.mocked(searchWithFallback)).not.toHaveBeenCalled();
  });

  it("confirmed_params skips NL parsing entirely and searches directly", async () => {
    const res = await POST(
      makeRequest({
        message: "Fly London to New York September 1st",
        confirmed_params: {
          origin: "LHR",
          destination: "JFK",
          departure_date: "2026-09-01",
          passengers: [{ type: "adult", count: 1 }],
        },
      })
    );
    const body = await readSSE(res);

    expect(body.offers).toHaveLength(1);
    expect(body.search_params?.origin).toBe("LHR");
    // Only generateSearchReply's own call, not a parse call too - confirming
    // must not re-run the LLM parse on an already-understood message.
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(vi.mocked(searchWithFallback)).toHaveBeenCalledTimes(1);
  });

  it("a stale confirmed_params (not matching the session's current checkpoint) doesn't overwrite a newer checkpoint's history slot", async () => {
    // Checkpoint A: LHR -> JFK
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "JFK",
        departure_date: "2026-09-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const checkpointARes = await POST(makeRequest({ message: "LHR to JFK Sept 1" }));
    const { session_id, params: paramsA } = await readSSEEvent<CheckpointEvent>(checkpointARes, "checkpoint");

    // Edit before confirming: checkpoint B (LHR -> CDG) supersedes A in session.last_params
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "CDG",
        departure_date: "2026-09-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const checkpointBRes = await POST(makeRequest({ message: "actually Paris instead", session_id }));
    const { params: paramsB } = await readSSEEvent<CheckpointEvent>(checkpointBRes, "checkpoint");
    expect(paramsB.destination).toBe("CDG");

    // Stale confirm: resumes checkpoint A's params, which no longer match
    // session.last_params (B). Must still search (client-supplied params are
    // honored), but must NOT splice its reply into checkpoint B's placeholder
    // history slot.
    const staleConfirmRes = await POST(
      makeRequest({ message: "LHR to JFK Sept 1", session_id, confirmed_params: paramsA })
    );
    const staleDone = await readSSE(staleConfirmRes);
    expect(staleDone.search_params?.destination).toBe("JFK");

    // A subsequent follow-up's LLM call carries full history - if the stale
    // confirm had wrongly overwritten checkpoint B's "...CDG..." placeholder
    // reply, that text would be gone from history by now.
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "CDG",
        departure_date: "2026-09-02",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    await POST(makeRequest({ message: "try the next day", session_id }));

    const lastCall = mockCreate.mock.calls[mockCreate.mock.calls.length - 1][0] as {
      messages: Array<{ role: string; content: string }>;
    };
    const historyText = lastCall.messages.map((m) => m.content).join(" | ");
    expect(historyText).toContain("CDG");
  });

  it("confirmed_params is still re-validated - a tampered/stale value can't skip validation", async () => {
    const res = await POST(
      makeRequest({
        message: "Fly London to New York",
        confirmed_params: {
          origin: "LHR",
          destination: "JFK",
          departure_date: "2020-01-01", // long past
          passengers: [{ type: "adult", count: 1 }],
        },
      })
    );
    const body = await readSSE(res);

    expect(body.search_failed).toBe(true);
    expect(vi.mocked(searchWithFallback)).not.toHaveBeenCalled();
  });

  it("records an assistant turn for the checkpoint, so a follow-up edit doesn't send two consecutive user messages to the LLM", async () => {
    // Regression test: the checkpoint step used to record only a user turn
    // and no assistant turn, so a follow-up message's nlParse call ended up
    // with two "user" role messages back to back once nlParse's own
    // "[Previous search parameters: ...]" context injection was added in -
    // OpenAI-compatible APIs enforce strict role alternation, and this
    // silently degraded/broke real follow-up parsing (caught via manual
    // browser testing, not by the mocked unit tests below).
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "SYD",
        destination: "SIN",
        departure_date: "2026-08-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const checkpointRes = await POST(makeRequest({ message: "Sydney to Singapore in August" }));
    const { session_id, params } = await readSSEEvent<CheckpointEvent>(checkpointRes, "checkpoint");
    expect(params.origin).toBe("SYD");

    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "SYD",
        destination: "SIN",
        departure_date: "2026-08-01",
        cabin_class: "business",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    await POST(makeRequest({ message: "make it business class instead", session_id }));

    const followUpCall = mockCreate.mock.calls[1][0] as {
      messages: Array<{ role: string }>;
    };
    for (let i = 1; i < followUpCall.messages.length; i++) {
      expect(followUpCall.messages[i].role).not.toBe(followUpCall.messages[i - 1].role);
    }
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
    const { done: body } = await searchViaCheckpoint("Fly London to New York September 1st");

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
    const { session_id } = await searchViaCheckpoint("London to New York September 1st");

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
    const { done: secondBody } = await searchViaCheckpoint("Make it business class", session_id);

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
    const { session_id: sid1 } = await searchViaCheckpoint("LHR to JFK September 1");

    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "JFK",
        departure_date: "2026-09-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const { session_id: sid2 } = await searchViaCheckpoint("show me economy options", sid1);

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

    const { done: body } = await searchViaCheckpoint("LHR to Paris then Paris to XXX");

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

  it("explore-anywhere mode: rejects a past departure date before ever calling exploreDestinations", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        departure_date: "2020-01-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );

    const res = await POST(makeRequest({ message: "Anywhere from London, Jan 1st 2020" }));
    const body = await readSSE(res);

    expect(body.reply).toMatch(/past/i);
    expect(body.search_failed).toBe(true);
    expect(body.explore_results).toBeUndefined();
    expect(vi.mocked(exploreDestinations)).not.toHaveBeenCalled();
  });

  it("explore-anywhere mode: applies its own tighter rate limit, separate from the general chat limit", async () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      const exploreRequest = () =>
        makeRequest({ message: "Cheap flights from London this weekend, anywhere" });
      for (let i = 0; i < 3; i++) {
        mockCreate.mockResolvedValueOnce(
          makeToolResponse({
            origin: "LHR",
            departure_date: "2026-09-01",
            passengers: [{ type: "adult", count: 1 }],
          })
        );
        vi.mocked(exploreDestinations).mockResolvedValueOnce([]);
        const res = await POST(exploreRequest());
        const body = await readSSE(res);
        expect(body.search_failed).toBeFalsy();
      }

      // 4th explore-mode request in the same window is over budget (max: 3).
      // nlParse must still succeed - the rate limit check happens after parsing.
      mockCreate.mockResolvedValueOnce(
        makeToolResponse({
          origin: "LHR",
          departure_date: "2026-09-01",
          passengers: [{ type: "adult", count: 1 }],
        })
      );
      const res = await POST(exploreRequest());
      const body = await readSSE(res);
      expect(body.search_failed).toBe(true);
      expect(body.reply).toMatch(/too many/i);
      expect(vi.mocked(exploreDestinations)).toHaveBeenCalledTimes(3);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("BUG-0007: an unhandled exception during NL parsing still emits an SSE error event and reports it to Sentry tagged with the failing phase", async () => {
    // nl-parser.ts's retry loop calls client.chat.completions.create()
    // without wrapping it in a try/catch (the only internal try/catch
    // covers JSON.parse of the tool call arguments) - so a rejection here
    // propagates uncaught out of nlParse() straight to this route's outer
    // catch. This simulates that gap to verify BUG-0007's telemetry: the
    // existing SSE error behavior must be unchanged, and Sentry must now
    // see it tagged with phase: "nl_parse".
    mockCreate.mockRejectedValueOnce(new Error("simulated Z.AI outage"));

    const res = await POST(makeRequest({ message: "London to New York next Friday" }));
    const errorEvent = await readSSEEvent<{ message: string }>(res, "error");

    expect(errorEvent.message).toBeTruthy();

    expect(mockSentryCaptureException).toHaveBeenCalledTimes(1);
    expect(mockSentryCaptureException).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        tags: expect.objectContaining({ route: "api/chat", phase: "nl_parse" }),
      })
    );
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
    const { done: body } = await searchViaCheckpoint("London to JFK");

    const offer = body.offers[0] as NormalizedOffer;
    expect(offer.total_amount).toBe("350.00");
    expect(offer.total_currency).toBe("GBP");
    expect((body.search_params as unknown as Record<string, unknown>)?.total_amount).toBeUndefined();
  });
});
