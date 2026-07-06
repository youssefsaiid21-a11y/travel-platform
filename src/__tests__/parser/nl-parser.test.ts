import { describe, it, expect, vi, beforeEach } from "vitest";

const mockCreate = vi.hoisted(() => vi.fn());

vi.mock("openai", () => ({
  default: class MockOpenAI {
    chat = { completions: { create: mockCreate } };
  },
}));

import { nlParse, validateParams, validateExploreParams, generateSearchReply } from "@/lib/parser/nl-parser";

function makeToolResponse(args: Record<string, unknown>, toolName = "extract_flight_search") {
  return {
    choices: [
      {
        message: {
          tool_calls: [
            {
              type: "function",
              function: {
                name: toolName,
                arguments: JSON.stringify(args),
              },
            },
          ],
        },
      },
    ],
  };
}

function makeAnswerResponse(answer: string) {
  return makeToolResponse({ answer }, "answer_travel_question");
}

describe("nlParse - 10 NL query fixtures", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("fixture 1: London to New York next Friday (LHR→JFK, 1 adult)", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "JFK",
        departure_date: "2026-07-03",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const { params, error } = await nlParse(
      "Fly from London to New York next Friday",
      [],
      null
    );
    expect(error).toBeNull();
    expect(params?.origin).toBe("LHR");
    expect(params?.destination).toBe("JFK");
    expect(params?.passengers).toEqual([{ type: "adult", count: 1 }]);
  });

  it("fixture 2: LHR to JFK December 15th 2026 (explicit IATA, exact date, one-way)", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "JFK",
        departure_date: "2026-12-15",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const { params, error } = await nlParse(
      "One-way from LHR to JFK on December 15th 2026",
      [],
      null
    );
    expect(error).toBeNull();
    expect(params?.departure_date).toBe("2026-12-15");
    expect(params?.return_date).toBeUndefined();
  });

  it("fixture 3: Business class return Paris→Dubai (CDG→DXB, cabin_class, return_date)", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "CDG",
        destination: "DXB",
        departure_date: "2027-03-10",
        return_date: "2027-03-20",
        cabin_class: "business",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const { params, error } = await nlParse(
      "Business class return Paris to Dubai, leaving March 10 back March 20",
      [],
      null
    );
    expect(error).toBeNull();
    expect(params?.origin).toBe("CDG");
    expect(params?.destination).toBe("DXB");
    expect(params?.cabin_class).toBe("business");
    expect(params?.return_date).toBeDefined();
  });

  it("fixture 4: Singapore to Tokyo sometime in October (SIN→NRT, flexible_date_note)", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "SIN",
        destination: "NRT",
        departure_date: "2026-10-01",
        passengers: [{ type: "adult", count: 1 }],
        flexible_date_note: "sometime in October",
      })
    );
    const { params, error } = await nlParse(
      "Cheapest flight from Singapore to Tokyo sometime in October",
      [],
      null
    );
    expect(error).toBeNull();
    expect(params?.origin).toBe("SIN");
    expect(params?.destination).toBe("NRT");
    expect(params?.flexible_date_note).toBeDefined();
  });

  it("fixture 5: Two adults economy London→Barcelona (2 adults, BCN)", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "BCN",
        departure_date: "2026-08-05",
        cabin_class: "economy",
        passengers: [{ type: "adult", count: 2 }],
      })
    );
    const { params, error } = await nlParse(
      "Two adults economy, London to Barcelona on August 5th",
      [],
      null
    );
    expect(error).toBeNull();
    expect(params?.passengers[0].count).toBe(2);
    expect(params?.cabin_class).toBe("economy");
    expect(params?.destination).toBe("BCN");
  });

  it("fixture 6: Non-stop Sydney→London business (max_connections: 0)", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "SYD",
        destination: "LHR",
        departure_date: "2026-08-01",
        cabin_class: "business",
        max_connections: 0,
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const { params, error } = await nlParse(
      "Non-stop from Sydney to London business class",
      [],
      null
    );
    expect(error).toBeNull();
    expect(params?.max_connections).toBe(0);
    expect(params?.cabin_class).toBe("business");
  });

  it("fixture 7: Return CDG→BKK July 1 back July 15 (return_date present)", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "CDG",
        destination: "BKK",
        departure_date: "2026-07-01",
        return_date: "2026-07-15",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const { params, error } = await nlParse(
      "Return from CDG to BKK July 1st back July 15th",
      [],
      null
    );
    expect(error).toBeNull();
    expect(params?.return_date).toMatch(/07-15/);
  });

  it("fixture 8: 3 passengers Toronto→Amsterdam economy (YYZ→AMS, 3 adults)", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "YYZ",
        destination: "AMS",
        departure_date: "2026-09-01",
        cabin_class: "economy",
        passengers: [{ type: "adult", count: 3 }],
      })
    );
    const { params, error } = await nlParse(
      "3 passengers Toronto to Amsterdam in economy",
      [],
      null
    );
    expect(error).toBeNull();
    expect(params?.origin).toBe("YYZ");
    expect(params?.destination).toBe("AMS");
    expect(params?.passengers[0].count).toBe(3);
  });

  it("fixture 9: Berlin→Lisbon this weekend return Sunday (BER→LIS, return_date)", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "BER",
        destination: "LIS",
        departure_date: "2026-07-04",
        return_date: "2026-07-06",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const { params, error } = await nlParse(
      "Fly me from Berlin to Lisbon this weekend, return Sunday",
      [],
      null
    );
    expect(error).toBeNull();
    expect(params?.origin).toBe("BER");
    expect(params?.destination).toBe("LIS");
    expect(params?.return_date).toBeDefined();
  });

  it("fixture 10: NYC to LA one-way (JFK→LAX, no return_date)", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "JFK",
        destination: "LAX",
        departure_date: "2026-07-20",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const { params, error } = await nlParse(
      "NYC to LA on the 20th, just one way",
      [],
      null
    );
    expect(error).toBeNull();
    expect(params?.destination).toBe("LAX");
    expect(params?.return_date).toBeUndefined();
  });

  it("returns error and null params when message is not a flight search", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({ error: "Not a flight search request." })
    );
    const { params, error, answer } = await nlParse(
      "What's the weather in Paris?",
      [],
      null
    );
    expect(params).toBeNull();
    expect(answer).toBeNull();
    expect(error).toContain("Not a flight search");
  });

  it("fails gracefully instead of crashing when the tool call omits required fields", async () => {
    mockCreate.mockResolvedValueOnce(
      // Malformed tool call: no origin, despite the schema marking it required
      makeToolResponse({
        destination: "JFK",
        departure_date: "2026-09-01",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const { params, error, answer } = await nlParse("fly somewhere to New York", [], null);
    expect(params).toBeNull();
    expect(answer).toBeNull();
    expect(error).toBeTruthy();
  });

  it("defaults a passenger entry's count to 1 when the model omits it", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "JFK",
        departure_date: "2026-09-01",
        passengers: [{ type: "adult" }], // missing count
      })
    );
    const { params, error } = await nlParse("London to New York", [], null);
    expect(error).toBeNull();
    expect(params?.passengers).toEqual([{ type: "adult", count: 1 }]);
  });

  it("keeps every valid passenger entry in a mixed-quality array instead of dropping the malformed one", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "JFK",
        departure_date: "2026-09-01",
        // "2 adults and 1 child" - the child entry is missing count, which
        // must NOT cause the child to disappear from the search entirely.
        passengers: [{ type: "adult", count: 2 }, { type: "child" }],
      })
    );
    const { params, error } = await nlParse("2 adults and a child, London to New York", [], null);
    expect(error).toBeNull();
    expect(params?.passengers).toEqual([
      { type: "adult", count: 2 },
      { type: "child", count: 1 },
    ]);
  });

  it("fixture 11: multi-city trip parses additional_slices in order", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "CDG",
        departure_date: "2026-10-01",
        passengers: [{ type: "adult", count: 1 }],
        additional_slices: [
          { origin: "CDG", destination: "FCO", departure_date: "2026-10-05" },
          { origin: "FCO", destination: "LHR", departure_date: "2026-10-10" },
        ],
      })
    );
    const { params, error } = await nlParse(
      "London to Paris on Oct 1, then Paris to Rome on Oct 5, then Rome back to London on Oct 10",
      [],
      null
    );
    expect(error).toBeNull();
    expect(params?.additional_slices).toEqual([
      { origin: "CDG", destination: "FCO", departure_date: "2026-10-05" },
      { origin: "FCO", destination: "LHR", departure_date: "2026-10-10" },
    ]);
  });

  it("fails gracefully instead of crashing when a multi-city leg omits a required field", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "CDG",
        departure_date: "2026-10-01",
        passengers: [{ type: "adult", count: 1 }],
        additional_slices: [
          // Second leg is missing destination - same class of
          // non-conforming-proxy response the top-level guard already
          // handles, applied per-leg.
          { origin: "CDG", departure_date: "2026-10-05" },
        ],
      })
    );
    const { params, error, answer } = await nlParse(
      "London to Paris on Oct 1, then somewhere on Oct 5",
      [],
      null
    );
    expect(params).toBeNull();
    expect(answer).toBeNull();
    expect(error).toBeTruthy();
  });

  it("drops a stale carried-forward return_date when additional_slices is set", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "CDG",
        departure_date: "2026-10-01",
        return_date: "2026-10-10",
        passengers: [{ type: "adult", count: 1 }],
        additional_slices: [
          { origin: "CDG", destination: "FCO", departure_date: "2026-10-05" },
        ],
      })
    );
    const { params, error } = await nlParse(
      "actually add a stop in Rome on the way back",
      [],
      { origin: "LHR", destination: "CDG", departure_date: "2026-10-01", return_date: "2026-10-10", passengers: [{ type: "adult", count: 1 }] }
    );
    expect(error).toBeNull();
    expect(params?.return_date).toBeUndefined();
    expect(params?.additional_slices).toHaveLength(1);
  });
});

describe("nlParse - explore anywhere (destination omitted)", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("builds exploreParams instead of params when destination is omitted", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        departure_date: "2026-07-04",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const { params, error, answer, exploreParams } = await nlParse(
      "Cheap flights from London this weekend, anywhere",
      [],
      null
    );
    expect(params).toBeNull();
    expect(error).toBeNull();
    expect(answer).toBeNull();
    expect(exploreParams).toEqual({
      origin: "LHR",
      departure_date: "2026-07-04",
      passengers: [{ type: "adult", count: 1 }],
    });
  });

  it("carries max_budget, cabin_class and return_date into exploreParams when given", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        departure_date: "2026-08-01",
        return_date: "2026-08-08",
        cabin_class: "business",
        max_budget: 300,
        passengers: [{ type: "adult", count: 2 }],
      })
    );
    const { exploreParams } = await nlParse(
      "Business class flights from London for under £300, anywhere, leaving Aug 1 back Aug 8",
      [],
      null
    );
    expect(exploreParams).toEqual({
      origin: "LHR",
      departure_date: "2026-08-01",
      return_date: "2026-08-08",
      cabin_class: "business",
      max_budget: 300,
      passengers: [{ type: "adult", count: 2 }],
    });
  });

  it("treats an empty-string destination the same as an omitted one", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        origin: "LHR",
        destination: "",
        departure_date: "2026-07-04",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const { params, exploreParams } = await nlParse("Anywhere from London this weekend", [], null);
    expect(params).toBeNull();
    expect(exploreParams?.origin).toBe("LHR");
  });

  it("still requires origin even in explore mode - fails gracefully if missing", async () => {
    mockCreate.mockResolvedValueOnce(
      makeToolResponse({
        departure_date: "2026-07-04",
        passengers: [{ type: "adult", count: 1 }],
      })
    );
    const { params, exploreParams, error } = await nlParse("Anywhere this weekend", [], null);
    expect(params).toBeNull();
    expect(exploreParams).toBeNull();
    expect(error).toBeTruthy();
  });
});

describe("validateExploreParams - explore-anywhere input validation", () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

  const base = {
    origin: "LHR",
    departure_date: tomorrow,
    passengers: [{ type: "adult" as const, count: 1 }],
  };

  it("returns null for valid explore params", () => {
    expect(validateExploreParams(base)).toBeNull();
  });

  it("rejects an invalid origin instead of letting it hit ~40 Duffel searches", () => {
    const err = validateExploreParams({ ...base, origin: "12" });
    expect(err).toMatch(/departure airport/i);
  });

  it("rejects a past departure date", () => {
    const err = validateExploreParams({ ...base, departure_date: "2020-01-01" });
    expect(err).toMatch(/past/i);
  });

  it("rejects a return_date before departure_date", () => {
    const err = validateExploreParams({ ...base, return_date: "2020-01-01" });
    expect(err).toMatch(/return date/i);
  });

  it("accepts a valid return_date after departure_date", () => {
    expect(validateExploreParams({ ...base, return_date: nextWeek })).toBeNull();
  });

  it("rejects more than 9 passengers", () => {
    const err = validateExploreParams({ ...base, passengers: [{ type: "adult" as const, count: 10 }] });
    expect(err).toMatch(/9 passengers/i);
  });
});

describe("nlParse - knowledge questions (answer_travel_question)", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("knowledge 1: visa question triggers answer, not flight search", async () => {
    const answerText = "UK citizens do not need a visa to visit Japan for stays up to 90 days.";
    mockCreate.mockResolvedValueOnce(makeAnswerResponse(answerText));
    const { params, error, answer } = await nlParse(
      "Do I need a visa to visit Japan as a UK citizen?",
      [],
      null
    );
    expect(params).toBeNull();
    expect(error).toBeNull();
    expect(answer).toBe(answerText);
  });

  it("knowledge 2: destination tip question triggers answer", async () => {
    const answerText = "The best time to visit Thailand is November to February, during the cool dry season.";
    mockCreate.mockResolvedValueOnce(makeAnswerResponse(answerText));
    const { params, error, answer } = await nlParse(
      "What is the best time of year to visit Thailand?",
      [],
      null
    );
    expect(params).toBeNull();
    expect(error).toBeNull();
    expect(answer).toContain("Thailand");
  });

  it("knowledge 3: baggage policy question triggers answer", async () => {
    const answerText = "Economy class baggage allowances vary by airline, typically 20–23 kg for checked luggage.";
    mockCreate.mockResolvedValueOnce(makeAnswerResponse(answerText));
    const { params, error, answer } = await nlParse(
      "How many kg of luggage can I bring on economy flights?",
      [],
      null
    );
    expect(params).toBeNull();
    expect(error).toBeNull();
    expect(answer?.toLowerCase()).toContain("kg");
  });
});

describe("validateParams - parameter validation", () => {
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const nextWeek = new Date(Date.now() + 7 * 86400000).toISOString().split("T")[0];

  const base = {
    origin: "LHR",
    destination: "JFK",
    departure_date: tomorrow,
    passengers: [{ type: "adult" as const, count: 1 }],
  };

  it("returns null for valid one-way params", () => {
    expect(validateParams(base)).toBeNull();
  });

  it("returns null for valid round-trip params", () => {
    expect(validateParams({ ...base, return_date: nextWeek })).toBeNull();
  });

  it("rejects invalid origin IATA (too short)", () => {
    const err = validateParams({ ...base, origin: "LH" });
    expect(err).toMatch(/departure/i);
  });

  it("rejects invalid destination IATA (number)", () => {
    const err = validateParams({ ...base, destination: "123" });
    expect(err).toMatch(/destination/i);
  });

  it("rejects same origin and destination", () => {
    const err = validateParams({ ...base, destination: "LHR" });
    expect(err).toMatch(/same/i);
  });

  it("rejects past departure date", () => {
    const err = validateParams({ ...base, departure_date: "2020-01-01" });
    expect(err).toMatch(/past/i);
  });

  it("rejects return_date before departure_date", () => {
    const err = validateParams({ ...base, return_date: "2020-01-01" });
    expect(err).toMatch(/return date/i);
  });

  it("rejects zero passengers", () => {
    const err = validateParams({ ...base, passengers: [{ type: "adult" as const, count: 0 }] });
    expect(err).toMatch(/at least 1/i);
  });

  it("rejects more than 9 passengers", () => {
    const err = validateParams({ ...base, passengers: [{ type: "adult" as const, count: 10 }] });
    expect(err).toMatch(/9 passengers/i);
  });

  it("rejects params that set both return_date and additional_slices", () => {
    const err = validateParams({
      ...base,
      return_date: nextWeek,
      additional_slices: [{ origin: "JFK", destination: "LAX", departure_date: nextWeek }],
    });
    expect(err).toMatch(/return trip and a multi-city trip/i);
  });

  it("accepts a valid multi-city itinerary in chronological order", () => {
    const err = validateParams({
      ...base,
      additional_slices: [
        { origin: "JFK", destination: "LAX", departure_date: nextWeek },
        { origin: "LAX", destination: "LHR", departure_date: nextWeek },
      ],
    });
    expect(err).toBeNull();
  });

  it("rejects a multi-city leg out of chronological order", () => {
    const err = validateParams({
      ...base,
      additional_slices: [
        { origin: "JFK", destination: "LAX", departure_date: "2020-01-01" },
      ],
    });
    expect(err).toMatch(/chronological/i);
  });

  it("rejects a multi-city leg with an invalid airport code", () => {
    const err = validateParams({
      ...base,
      additional_slices: [{ origin: "JFK", destination: "12", departure_date: nextWeek }],
    });
    expect(err).toMatch(/airport/i);
  });

  it("rejects more than 6 total legs", () => {
    const err = validateParams({
      ...base,
      additional_slices: Array.from({ length: 6 }, () => ({
        origin: "JFK",
        destination: "LAX",
        departure_date: nextWeek,
      })),
    });
    expect(err).toMatch(/6 flights/i);
  });

  it("accepts exactly 6 total legs (the documented maximum)", () => {
    const cities = ["JFK", "LAX", "ORD", "SEA", "MIA", "BOS"];
    const err = validateParams({
      ...base,
      additional_slices: cities.slice(0, 5).map((origin, i) => ({
        origin,
        destination: cities[i + 1],
        departure_date: nextWeek,
      })),
    });
    expect(err).toBeNull();
  });

  it("rejects a multi-city leg that doesn't connect to the previous one", () => {
    const err = validateParams({
      ...base,
      additional_slices: [
        { origin: "JFK", destination: "LAX", departure_date: nextWeek },
        // Should depart from LAX (where the previous leg ended), not NRT.
        { origin: "NRT", destination: "SYD", departure_date: nextWeek },
      ],
    });
    expect(err).toMatch(/doesn't connect/i);
  });
});

describe("generateSearchReply - token streaming", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  const params = {
    origin: "LHR",
    destination: "NRT",
    departure_date: "2026-08-01",
    passengers: [{ type: "adult" as const, count: 1 }],
  };

  function makeStream(chunks: string[], thenThrow?: Error) {
    return {
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) {
          yield { choices: [{ delta: { content: c } }] };
        }
        if (thenThrow) throw thenThrow;
      },
    };
  }

  it("streams every chunk via onDelta and resolves to the full assembled text", async () => {
    mockCreate.mockResolvedValueOnce(makeStream(["Found ", "3 flights ", "to Tokyo."]));
    const deltas: string[] = [];

    const result = await generateSearchReply(
      "flights to Tokyo", params, 3, "500.00", "GBP", "ANA", false, null,
      (delta) => deltas.push(delta)
    );

    expect(deltas.join("")).toBe("Found 3 flights to Tokyo.");
    expect(result).toBe("Found 3 flights to Tokyo.");
  });

  it("prefers already-streamed partial content over the template when the stream errors mid-way", async () => {
    mockCreate.mockResolvedValueOnce(
      makeStream(["Found 3 flights"], new Error("connection dropped"))
    );
    const deltas: string[] = [];

    const result = await generateSearchReply(
      "flights to Tokyo", params, 3, "500.00", "GBP", "ANA", false, null,
      (delta) => deltas.push(delta)
    );

    // The user already watched this text stream in - falling back to the
    // unrelated template here would contradict what they just saw.
    expect(deltas.join("")).toBe("Found 3 flights");
    expect(result).toBe("Found 3 flights");
  });

  it("falls back to the template when the stream errors before anything arrives", async () => {
    mockCreate.mockResolvedValueOnce(makeStream([], new Error("immediate failure")));

    const result = await generateSearchReply(
      "flights to Tokyo", params, 3, "500.00", "GBP", "ANA", false, null
    );

    expect(result).toMatch(/Found 3 flights/i);
  });
});
