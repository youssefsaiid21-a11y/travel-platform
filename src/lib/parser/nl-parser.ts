import OpenAI from "openai";
import type { ConversationMessage, ExploreParams, SearchParams } from "./types";

const client = new OpenAI({
  apiKey: process.env.ZHIPU_API_KEY ?? "",
  baseURL: "https://api.z.ai/api/paas/v4/",
  timeout: 10_000,
});

const MODEL = "glm-4-32b-0414-128k";

const ANSWER_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "answer_travel_question",
    description:
      "Answer a general travel knowledge question - visa requirements, passport rules, " +
      "airport information, baggage policies, destination tips, best travel seasons, etc. " +
      "Use this instead of extract_flight_search when the user is NOT searching for a specific flight.",
    parameters: {
      type: "object",
      properties: {
        answer: {
          type: "string",
          description: "Helpful, concise answer in 1–3 sentences. No markdown.",
        },
      },
      required: ["answer"],
    },
  },
};

const EXTRACT_TOOL: OpenAI.Chat.Completions.ChatCompletionTool = {
  type: "function",
  function: {
    name: "extract_flight_search",
    description:
      "Extract structured flight search parameters from a natural language query. " +
      "If the message is a follow-up (e.g. 'make it business class'), merge with the " +
      "previous parameters - carry forward everything not mentioned in the new message. " +
      "If the message cannot be interpreted as a flight search, set the error field.",
    parameters: {
      type: "object",
      properties: {
        origin: {
          type: "string",
          description: "Departure airport IATA code (3 letters, e.g. LHR, JFK). Always use a real IATA code.",
        },
        destination: {
          type: "string",
          description:
            "Arrival airport IATA code (3 letters). Always use a real IATA code. " +
            "Omit this field ENTIRELY (do not guess one) when the user has no specific " +
            "destination in mind and wants to explore options - triggers: 'anywhere', " +
            "'surprise me', 'where can I go', 'flights from X, anywhere', 'somewhere cheap'. " +
            "This activates 'explore anywhere' mode, which searches many popular destinations " +
            "and returns a ranked cheapest-first list instead of a single search.",
        },
        departure_date: {
          type: "string",
          description: "Departure date in YYYY-MM-DD. Must be today or a future date.",
        },
        return_date: {
          type: "string",
          description: "Return date in YYYY-MM-DD. Must be after departure_date. Omit for one-way trips.",
        },
        passengers: {
          type: "array",
          description: "List of passenger groups",
          items: {
            type: "object",
            properties: {
              type: { type: "string", enum: ["adult", "child", "infant"] },
              count: { type: "number" },
            },
            required: ["type", "count"],
          },
        },
        cabin_class: {
          type: "string",
          enum: ["economy", "premium_economy", "business", "first"],
          description: "Cabin class (omit if not specified)",
        },
        max_connections: {
          type: "number",
          description: "Max connections. 0 = non-stop only. Omit if not specified.",
        },
        flexible_date_note: {
          type: "string",
          description:
            "If the user gave a vague date like 'sometime in October', record it here " +
            "and pick a reasonable specific date for departure_date.",
        },
        prefer_refundable: {
          type: "boolean",
          description:
            "True when user explicitly wants a refundable/cancellable ticket. " +
            "Triggers: 'refundable', 'can cancel', 'need to cancel', 'cancellable', 'fully flexible', 'want to cancel if plans change'.",
        },
        prefer_changeable: {
          type: "boolean",
          description:
            "True when user explicitly wants a changeable/amendable ticket. " +
            "Triggers: 'changeable', 'can change', 'change my flight', 'amend', 'flexible ticket' (when referring to date changes, not cancellation).",
        },
        depart_after: {
          type: "string",
          description:
            "Earliest allowed departure time as HH:MM (24h). " +
            "Examples: 'after midnight' → '00:00', 'red-eye'/'overnight' → '21:00', " +
            "'early morning' → '05:00', 'morning flight' → '06:00', " +
            "'afternoon' → '12:00', 'evening' → '17:00', 'after 3pm' → '15:00', 'late night' → '21:00'.",
        },
        depart_before: {
          type: "string",
          description:
            "Latest allowed departure time as HH:MM (24h). " +
            "Examples: 'before noon' → '12:00', 'morning flight' → '11:59', " +
            "'early departure' → '09:00', 'afternoon' → '17:59', 'evening' → '22:59', " +
            "'after midnight' → '05:59', 'not too late' → '20:00'.",
        },
        additional_slices: {
          type: "array",
          description:
            "For multi-city trips only (3+ different cities, no simple return). " +
            "The FIRST leg always goes in the top-level origin/destination/departure_date fields. " +
            "Every leg AFTER the first goes here, in chronological order. " +
            "Example: 'London to Paris on the 1st, then Paris to Rome on the 5th, then Rome back to London on the 10th' " +
            "→ top-level origin=LHR, destination=CDG, departure_date=<1st>; " +
            "additional_slices=[{origin:CDG,destination:FCO,departure_date:<5th>},{origin:FCO,destination:LHR,departure_date:<10th>}]. " +
            "Omit entirely for one-way or simple return trips - use return_date for those instead.",
          items: {
            type: "object",
            properties: {
              origin: { type: "string", description: "Departure airport IATA code for this leg." },
              destination: { type: "string", description: "Arrival airport IATA code for this leg." },
              departure_date: { type: "string", description: "Departure date for this leg, YYYY-MM-DD." },
            },
            required: ["origin", "destination", "departure_date"],
          },
        },
        max_budget: {
          type: "number",
          description:
            "Maximum total price the user is willing to pay, as a plain number in the " +
            "local currency (e.g. 'under £300' → 300, 'budget of $500' → 500). " +
            "Mainly used for explore-anywhere mode to filter out pricier destinations. " +
            "Omit if the user didn't mention a budget.",
        },
        error: {
          type: "string",
          description:
            "Set this only if the message is not a flight search at all. Leave unset for valid searches.",
        },
      },
      // destination is intentionally NOT required - omitting it is how the
      // model signals "explore anywhere" mode (see its description above).
      required: ["origin", "departure_date", "passengers"],
    },
  },
};

function buildSystemPrompt(): string {
  const today = new Date().toISOString().split("T")[0];
  return `You are Orbi, an AI travel assistant. You can search for flights AND answer travel knowledge questions.

Today is ${today}. All departure_date values MUST be on or after ${today}.

Use extract_flight_search when the user wants to find or book a flight.
Use answer_travel_question when the user asks a general travel question (visas, airports, baggage, destinations, travel tips, etc.).

Flight search rules:
- Always convert city/country names to the primary IATA airport code (London→LHR, New York→JFK, Paris→CDG, Tokyo→NRT, Sydney→SYD, Dubai→DXB, Bangkok→BKK, Los Angeles→LAX, Chicago→ORD, Amsterdam→AMS, Toronto→YYZ, Singapore→SIN, Berlin→BER, Lisbon→LIS, Barcelona→BCN).
- For vague dates ("next Friday", "sometime in October"), pick the nearest upcoming occurrence and record it in flexible_date_note.
- For a specific month/day given with no year ("March 10", "June 20th"), assume the nearest future occurrence: if that month/day has already passed this year, use next year instead of this year.
- Default to 1 adult passenger if not specified.
- On follow-up messages, carry forward ALL parameters from the previous search that the user did not explicitly change.
- If the user says "add return" or "make it a return", add return_date approximately 7 days after departure.
- Set error only if the message is completely unrelated to travel (e.g. "tell me a joke").
- For refundable/cancellable requests, set prefer_refundable=true; for changeable/amendable, set prefer_changeable=true.
- For time preferences: 'after midnight' → depart_after '00:00' + depart_before '05:59'; 'morning' → depart_after '06:00' + depart_before '11:59'; 'afternoon' → depart_after '12:00' + depart_before '17:59'; 'evening' → depart_after '18:00' + depart_before '22:59'; 'overnight'/'red-eye' → depart_after '21:00'; 'before noon' → depart_before '11:59'; specific time like 'after 3pm' → depart_after '15:00'.
- For seat/legroom/meal preferences, baggage requests, or specific seat numbers: ignore them (these are booked after selection, not searchable) and proceed with the flight search normally.
- For multi-city trips (3+ different cities in one journey), put the first leg in origin/destination/departure_date and every subsequent leg in additional_slices, in order. Do not set return_date on a multi-city trip.
- If the user has no specific destination in mind ('anywhere', 'surprise me', 'where can I go from London this weekend', 'somewhere cheap in Europe'), omit the destination field entirely - this triggers explore-anywhere mode, which searches many popular destinations and returns a ranked list. Still fill in origin, departure_date (and return_date if implied), passengers, cabin_class, and max_budget if a budget was mentioned.
- If the user mentions a budget or price ceiling ('under £300', 'budget of $500', 'cheap flights'), set max_budget to the numeric amount when a specific number is given.
- Always call one of the two tools - never reply in plain text.`;
}

export interface ParseResult {
  params: SearchParams | null;
  error: string | null;
  answer: string | null; // non-null when the model answered a knowledge question
  // Non-null when the user asked for a flight with no specific destination
  // ("anywhere", "surprise me") - the caller should run explore-anywhere
  // search instead of a normal single-destination search/validation.
  exploreParams: ExploreParams | null;
}

export async function nlParse(
  message: string,
  history: ConversationMessage[],
  previousParams: SearchParams | null
): Promise<ParseResult> {
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: buildSystemPrompt() },
    ...history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  if (previousParams) {
    messages.push({
      role: "user",
      content:
        `[Previous search parameters: ${JSON.stringify(previousParams)}. ` +
        `Carry forward all fields not explicitly changed in the next message.]`,
    });
    messages.push({
      role: "assistant",
      content: "Understood. I will carry forward the previous search parameters.",
    });
  }

  messages.push({ role: "user", content: message });

  // tool_choice: "required" (not "auto") is the actual fix here - "auto"
  // lets the model reply with plain text instead of calling either tool,
  // which it did intermittently even for unambiguous queries like "Non-stop
  // Sydney to London in August" (same input, parsed one attempt and failed
  // the next). There's no valid case where neither tool applies - a
  // non-flight message is meant to go through answer_travel_question, and
  // an unparseable flight-shaped message goes through extract_flight_search's
  // own `error` field - so forcing one of the two removes that failure mode
  // instead of just retrying around it.
  //
  // The retry loop below is a second layer for the cases forcing tool_choice
  // doesn't cover: some OpenAI-compatible proxies don't enforce "required"
  // 100% of the time, and a model can still return malformed JSON in
  // function.arguments. Bounded at 3 attempts (not a loop), so a genuinely
  // broken request still fails fast instead of hanging - bumped from 2 after
  // real usage showed occasional back-to-back "no tool call" responses that
  // exhausted the original single retry; isolated repeated testing against
  // the real API couldn't reproduce it on demand, consistent with a
  // transient burst in the model/proxy's tool-call enforcement rather than
  // something deterministic about any particular prompt shape.
  const MAX_ATTEMPTS = 3;
  let toolCallName: string | null = null;
  let input: Record<string, unknown> | null = null;
  let lastFailureReason = "";
  for (let attempt = 0; attempt < MAX_ATTEMPTS && !input; attempt++) {
    const response = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: [EXTRACT_TOOL, ANSWER_TOOL],
      tool_choice: "required",
    });

    const toolCall = response.choices[0]?.message?.tool_calls?.[0];
    if (!toolCall || toolCall.type !== "function") {
      lastFailureReason = "model returned no tool call";
      continue;
    }
    try {
      input = JSON.parse(toolCall.function.arguments) as Record<string, unknown>;
      toolCallName = toolCall.function.name;
    } catch {
      lastFailureReason = "model returned malformed tool-call JSON";
    }
  }

  if (!input || !toolCallName) {
    console.error(`nlParse: giving up after ${MAX_ATTEMPTS} attempts (${lastFailureReason})`);
    return { params: null, error: "Could not parse flight search from your message.", answer: null, exploreParams: null };
  }

  if (toolCallName === "answer_travel_question") {
    return { params: null, error: null, answer: (input.answer as string) ?? "", exploreParams: null };
  }

  if (input.error) {
    return { params: null, error: input.error as string, answer: null, exploreParams: null };
  }

  // The tool schema's "required" fields are a hint to the model, not an
  // enforced contract - an OpenAI-compatible proxy can still return a
  // tool call missing them. Fail with the same friendly message as an
  // unparseable message rather than crashing on `undefined.toUpperCase()`.
  // Note: destination is deliberately NOT checked here - it's optional
  // (omitting it is how explore-anywhere mode is triggered, handled below).
  if (
    typeof input.origin !== "string" ||
    typeof input.departure_date !== "string"
  ) {
    return { params: null, error: "Could not parse flight search from your message.", answer: null, exploreParams: null };
  }

  // A passenger entry naming a valid type but missing/malformed `count` still
  // means "at least one of them" - default to 1 rather than silently dropping
  // the whole entry (which would search for fewer passengers than requested).
  const rawPassengers = Array.isArray(input.passengers) ? input.passengers : [];
  const parsedPassengers = rawPassengers
    .filter(
      (p): p is Record<string, unknown> =>
        typeof p === "object" && p !== null && typeof p.type === "string"
    )
    .map((p) => ({
      type: p.type as SearchParams["passengers"][number]["type"],
      count: typeof p.count === "number" && p.count > 0 ? p.count : 1,
    }));
  const passengers = parsedPassengers.length > 0 ? parsedPassengers : [{ type: "adult" as const, count: 1 }];

  const hasDestination = typeof input.destination === "string" && input.destination.trim() !== "";

  // No destination given - the user wants to explore, not search a specific
  // route. Skip the normal SearchParams path (and its IATA validation)
  // entirely; the caller runs exploreDestinations() against a curated list
  // of popular destinations instead.
  if (!hasDestination) {
    const exploreParams: ExploreParams = {
      origin: input.origin.toUpperCase().slice(0, 3),
      departure_date: input.departure_date,
      ...(input.return_date ? { return_date: input.return_date as string } : {}),
      passengers,
      ...(input.cabin_class
        ? { cabin_class: input.cabin_class as SearchParams["cabin_class"] }
        : {}),
      ...(typeof input.max_budget === "number" ? { max_budget: input.max_budget } : {}),
    };
    return { params: null, error: null, answer: null, exploreParams };
  }

  const hasAdditionalSlices =
    Array.isArray(input.additional_slices) && input.additional_slices.length > 0;

  // Same reasoning as the top-level origin/departure_date check above - the
  // tool schema's per-leg "required" fields aren't an enforced contract
  // either. Without this, a leg missing origin/destination throws an
  // uncaught TypeError on `.toUpperCase()` below (surfaces as a generic
  // "Something went wrong" instead of the friendly retry path), and a leg
  // missing departure_date silently produces `departure_date: undefined`
  // that skips validateParams' chronological-order check entirely
  // (`undefined < string` is always false in JS) and would reach Duffel
  // with a slice missing a required field.
  if (
    hasAdditionalSlices &&
    (input.additional_slices as unknown[]).some(
      (s) =>
        typeof s !== "object" ||
        s === null ||
        typeof (s as Record<string, unknown>).origin !== "string" ||
        typeof (s as Record<string, unknown>).destination !== "string" ||
        typeof (s as Record<string, unknown>).departure_date !== "string"
    )
  ) {
    return { params: null, error: "Could not parse flight search from your message.", answer: null, exploreParams: null };
  }

  const params: SearchParams = {
    origin: input.origin.toUpperCase().slice(0, 3),
    destination: (input.destination as string).toUpperCase().slice(0, 3),
    departure_date: input.departure_date,
    // A trip is either a return trip or a multi-city trip, never both - if the
    // model (or carried-forward state) produced a stale return_date alongside
    // additional_slices, the multi-city itinerary wins.
    ...(input.return_date && !hasAdditionalSlices
      ? { return_date: input.return_date as string }
      : {}),
    passengers,
    ...(input.cabin_class
      ? { cabin_class: input.cabin_class as SearchParams["cabin_class"] }
      : {}),
    ...(input.max_connections !== undefined
      ? { max_connections: input.max_connections as number }
      : {}),
    ...(input.flexible_date_note
      ? { flexible_date_note: input.flexible_date_note as string }
      : {}),
    ...(input.prefer_refundable ? { prefer_refundable: true } : {}),
    ...(input.prefer_changeable ? { prefer_changeable: true } : {}),
    ...(input.depart_after ? { depart_after: input.depart_after as string } : {}),
    ...(input.depart_before ? { depart_before: input.depart_before as string } : {}),
    ...(hasAdditionalSlices
      ? {
          additional_slices: (input.additional_slices as Array<Record<string, unknown>>).map(
            (s) => ({
              origin: (s.origin as string).toUpperCase().slice(0, 3),
              destination: (s.destination as string).toUpperCase().slice(0, 3),
              departure_date: s.departure_date as string,
            })
          ),
        }
      : {}),
  };

  return { params, error: null, answer: null, exploreParams: null };
}

export function validateParams(params: SearchParams): string | null {
  const today = new Date().toISOString().split("T")[0];

  if (!/^[A-Z]{3}$/.test(params.origin)) {
    return `I couldn't identify the departure airport (got "${params.origin}"). Could you be more specific - e.g. "London Heathrow" or use the airport code?`;
  }

  if (!/^[A-Z]{3}$/.test(params.destination)) {
    return `I couldn't identify the destination airport (got "${params.destination}"). Could you clarify - e.g. "New York JFK"?`;
  }

  if (params.origin === params.destination) {
    return `Origin and destination are the same (${params.origin}). Where would you like to fly to?`;
  }

  if (params.departure_date < today) {
    return `That departure date (${params.departure_date}) is in the past. Which upcoming date did you mean?`;
  }

  if (params.return_date) {
    if (params.return_date <= params.departure_date) {
      return `The return date (${params.return_date}) must be after the departure date (${params.departure_date}). Can you clarify?`;
    }
  }

  const totalPassengers = params.passengers.reduce((s, p) => s + p.count, 0);
  if (totalPassengers < 1) {
    return `At least 1 passenger is required.`;
  }
  if (totalPassengers > 9) {
    return `Duffel supports up to 9 passengers per booking (you specified ${totalPassengers}).`;
  }

  if (params.additional_slices && params.additional_slices.length > 0) {
    if (params.return_date) {
      return `A trip can't be both a return trip and a multi-city trip - did you mean one or the other?`;
    }
    if (params.additional_slices.length > 5) {
      return `Multi-city trips support up to 6 flights total (you specified ${params.additional_slices.length + 1}).`;
    }
    let previousDate = params.departure_date;
    let previousDestination = params.destination;
    for (const leg of params.additional_slices) {
      if (!/^[A-Z]{3}$/.test(leg.origin) || !/^[A-Z]{3}$/.test(leg.destination)) {
        return `I couldn't identify an airport in one of the multi-city legs (got "${leg.origin}" → "${leg.destination}"). Could you use airport codes or full city names?`;
      }
      if (leg.origin === leg.destination) {
        return `One of the multi-city legs has the same origin and destination (${leg.origin}).`;
      }
      if (leg.origin !== previousDestination) {
        return `Your multi-city trip doesn't connect - the previous leg ends in ${previousDestination}, but the next one departs from ${leg.origin}. Did you mean ${previousDestination} → ${leg.destination}?`;
      }
      if (leg.departure_date < previousDate) {
        return `Multi-city legs must be in chronological order - ${leg.origin} → ${leg.destination} on ${leg.departure_date} comes before the previous leg.`;
      }
      previousDate = leg.departure_date;
      previousDestination = leg.destination;
    }
  }

  return null;
}

// Explore-anywhere skips validateParams entirely (there's no single
// destination to validate), but the same class of bad input - an invalid
// origin, a past date, a garbage passenger count - would otherwise sail
// straight into ~40 parallel Duffel searches (one per candidate destination),
// each failing individually and producing a misleading generic "no flights
// found" reply instead of a clear, immediate error like the normal path gives.
export function validateExploreParams(params: ExploreParams): string | null {
  const today = new Date().toISOString().split("T")[0];

  if (!/^[A-Z]{3}$/.test(params.origin)) {
    return `I couldn't identify the departure airport (got "${params.origin}"). Could you be more specific - e.g. "London Heathrow" or use the airport code?`;
  }

  if (params.departure_date < today) {
    return `That departure date (${params.departure_date}) is in the past. Which upcoming date did you mean?`;
  }

  if (params.return_date && params.return_date <= params.departure_date) {
    return `The return date (${params.return_date}) must be after the departure date (${params.departure_date}). Can you clarify?`;
  }

  const totalPassengers = params.passengers.reduce((s, p) => s + p.count, 0);
  if (totalPassengers < 1) {
    return `At least 1 passenger is required.`;
  }
  if (totalPassengers > 9) {
    return `Duffel supports up to 9 passengers per booking (you specified ${totalPassengers}).`;
  }

  return null;
}

export async function generateSearchReply(
  userMessage: string,
  params: SearchParams,
  offersCount: number,
  cheapestAmount: string | null,
  cheapestCurrency: string | null,
  cheapestAirline: string | null,
  dateWasAdjusted: boolean,
  preferenceNote?: string | null,
  // Called with each token chunk as it streams in, so the client can render
  // the reply progressively instead of waiting for the whole thing - the
  // returned Promise still resolves to the complete text (for session
  // history and the SSE "done" event's authoritative reply field).
  onDelta?: (delta: string) => void
): Promise<string> {
  const routeDescription = params.additional_slices?.length
    ? [params.origin, params.destination, ...params.additional_slices.map((s) => s.destination)].join(" → ")
    : `${params.origin} to ${params.destination}`;

  let cheapestFormatted = `${cheapestAmount} ${cheapestCurrency}`;
  if (cheapestAmount && cheapestCurrency) {
    try {
      cheapestFormatted = new Intl.NumberFormat("en-GB", {
        style: "currency", currency: cheapestCurrency, minimumFractionDigits: 2,
      }).format(parseFloat(cheapestAmount));
    } catch { /* keep raw */ }
  }
  const offerContext =
    offersCount > 0
      ? `${offersCount} flight${offersCount !== 1 ? "s" : ""} found for ${routeDescription} starting ${params.departure_date}${params.return_date ? ` (return ${params.return_date})` : ""}. Cheapest: ${cheapestFormatted} on ${cheapestAirline}.${params.cabin_class ? ` Cabin: ${params.cabin_class}.` : ""}`
      : `No flights found for ${routeDescription} starting ${params.departure_date}.`;

  const dateNote = dateWasAdjusted
    ? ` Note: no flights on the requested date - these are the closest available.`
    : "";
  const prefNote = preferenceNote ? ` ${preferenceNote}` : "";

  // Declared outside the try so a mid-stream error can still recover
  // whatever was already streamed to the client - see catch block below.
  let content = "";
  try {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages: [
        {
          role: "system",
          content:
            "You are Orbi, a friendly AI flight assistant. Write exactly 1–2 short sentences (max 30 words total) " +
            "summarising the search results. Be specific with numbers, prices, and airlines. " +
            "If the date was adjusted, mention it naturally. No markdown, no bullet points, no filler phrases like 'Great news!'.",
        },
        {
          role: "user",
          content: `User said: "${userMessage}"\nResults: ${offerContext}${dateNote}${prefNote}`,
        },
      ],
      max_tokens: 80,
      stream: true,
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        content += delta;
        onDelta?.(delta);
      }
    }
    content = content.trim();
    // Once tokens have already streamed to the client, replacing a
    // suspiciously-short result with the template would flicker/contradict
    // what the user just watched appear - only bail out to the template
    // when the model produced nothing at all (e.g. request errored).
    if (content) return content;
  } catch {
    // A mid-stream error (e.g. the connection drops) after real tokens
    // already streamed to the client is different from an error before
    // anything arrived: falling back to an unrelated template here would
    // contradict what the user just watched appear, so prefer whatever
    // was already accumulated over the template if it's non-empty.
    const partial = content.trim();
    if (partial) return partial;
    // else fall through to template - nothing was ever shown to the user
  }

  // Template fallback
  const cabin = params.cabin_class ? ` (${params.cabin_class.replace("_", " ")})` : "";
  if (offersCount === 0) {
    return `No flights found for ${routeDescription} on ${params.departure_date}${cabin}. Try different dates or nearby airports.`;
  }
  const prefix = [
    dateWasAdjusted ? `No flights on that date - showing results for ${params.departure_date} instead.` : "",
    preferenceNote ?? "",
  ].filter(Boolean).join(" ");
  const prefixStr = prefix ? prefix + " " : "";
  let priceStr = `${cheapestAmount} ${cheapestCurrency}`;
  if (cheapestAmount && cheapestCurrency) {
    try {
      priceStr = new Intl.NumberFormat("en-GB", {
        style: "currency", currency: cheapestCurrency, minimumFractionDigits: 0, maximumFractionDigits: 0,
      }).format(parseFloat(cheapestAmount));
    } catch { /* keep raw */ }
  }
  return `${prefixStr}Found ${offersCount} flight${offersCount !== 1 ? "s" : ""}${cabin} for ${routeDescription}, from ${priceStr}.`;
}
