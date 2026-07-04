import { NextRequest, NextResponse } from "next/server";
import { nlParse, validateParams, validateExploreParams, generateSearchReply } from "@/lib/parser/nl-parser";
import { searchWithFallback, filterByPreferences, getPriceCalendar } from "@/lib/duffel/search";
import type { PriceCalendarEntry } from "@/lib/duffel/search";
import { exploreDestinations } from "@/lib/duffel/explore";
import { getOrCreate, save } from "@/lib/session/store";
import { DuffelError } from "@/lib/duffel/client";
import { enforceRateLimit } from "@/lib/rate-limit";
import type { NormalizedOffer } from "@/lib/duffel/types";
import type { ExploreDestinationResult, ExploreParams, SearchParams } from "@/lib/parser/types";

export interface ChatRequest {
  message: string;
  session_id?: string;
}

// Shape of the `done` event data - used by client and tests
export interface ChatResponse {
  session_id: string;
  offers: NormalizedOffer[];
  reply: string;
  search_params: SearchParams | null;
  price_calendar?: PriceCalendarEntry[];
  // True when the search itself couldn't be attempted (invalid params, Duffel
  // error) - as opposed to a valid search that legitimately found 0 offers.
  // Lets the client show "fix your search" hints instead of "no results" ones.
  search_failed?: boolean;
  // Populated instead of offers/search_params when the user asked for a
  // flight with no specific destination ("anywhere") - a ranked list of
  // cheapest popular destinations, plus the params used to search them (so
  // the client can start a normal search when the user picks one).
  explore_results?: ExploreDestinationResult[];
  explore_params?: ExploreParams;
}

function sse(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const rateLimited = enforceRateLimit(req, "chat");
  if (rateLimited) return rateLimited;

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { message, session_id } = body;

  if (!message?.trim()) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const push = (event: string, data: object) => {
        controller.enqueue(encoder.encode(sse(event, data)));
      };

      try {
        const session = await getOrCreate(session_id);

        // ── Step 1: parse ──────────────────────────────────────────────
        push("status", { step: "parsing", message: "Understanding your request…" });

        const { params, error, answer, exploreParams } = await nlParse(
          message.trim(),
          session.history,
          session.last_params
        );

        // Knowledge question - answer directly, no Duffel call
        if (answer) {
          session.history.push({ role: "user", content: message.trim() });
          session.history.push({ role: "assistant", content: answer });
          await save(session);
          push("done", {
            session_id: session.id,
            offers: [],
            reply: answer,
            search_params: null,
          } satisfies ChatResponse);
          controller.close();
          return;
        }

        // No specific destination - "explore anywhere" mode. Skips
        // validateParams (there's no single destination to validate) but
        // still validates origin/date/passengers via validateExploreParams,
        // then fans out to exploreDestinations() instead of searchWithFallback().
        if (exploreParams) {
          const exploreValidationError = validateExploreParams(exploreParams);
          if (exploreValidationError) {
            session.history.push({ role: "user", content: message.trim() });
            session.history.push({ role: "assistant", content: exploreValidationError });
            await save(session);
            push("done", {
              session_id: session.id,
              offers: [],
              reply: exploreValidationError,
              search_params: null,
              search_failed: true,
            } satisfies ChatResponse);
            controller.close();
            return;
          }

          push("status", {
            step: "searching",
            message: `Searching popular destinations from ${exploreParams.origin}…`,
          });

          let exploreResults: ExploreDestinationResult[] = [];
          try {
            exploreResults = await exploreDestinations(exploreParams);
          } catch {
            // Fall through with an empty list - reported as "no results"
            // below rather than a hard error, since individual destination
            // failures are already swallowed inside exploreDestinations.
          }

          const reply =
            exploreResults.length > 0
              ? `Found ${exploreResults.length} destination${exploreResults.length !== 1 ? "s" : ""} from ${exploreParams.origin} on ${exploreParams.departure_date}. Cheapest: ${exploreResults[0].city} from ${exploreResults[0].cheapestAmount} ${exploreResults[0].currency}.`
              : `I couldn't find any flights from ${exploreParams.origin} around ${exploreParams.departure_date}. Try a different date or budget.`;

          session.history.push({ role: "user", content: message.trim() });
          session.history.push({ role: "assistant", content: reply });
          await save(session);
          push("done", {
            session_id: session.id,
            offers: [],
            reply,
            search_params: null,
            explore_results: exploreResults,
            explore_params: exploreParams,
          } satisfies ChatResponse);
          controller.close();
          return;
        }

        if (!params || error) {
          const reply =
            error ??
            "I couldn't understand that as a flight search. Try something like: 'London to New York next Friday'.";
          session.history.push({ role: "user", content: message.trim() });
          session.history.push({ role: "assistant", content: reply });
          await save(session);
          push("done", {
            session_id: session.id,
            offers: [],
            reply,
            search_params: null,
          } satisfies ChatResponse);
          controller.close();
          return;
        }

        // ── Step 2: validate ───────────────────────────────────────────
        const validationError = validateParams(params);
        if (validationError) {
          session.history.push({ role: "user", content: message.trim() });
          session.history.push({ role: "assistant", content: validationError });
          await save(session);
          push("done", {
            session_id: session.id,
            offers: [],
            reply: validationError,
            search_params: params,
            search_failed: true,
          } satisfies ChatResponse);
          controller.close();
          return;
        }

        // ── Step 3: search ─────────────────────────────────────────────
        push("status", {
          step: "searching",
          message: `Searching ${params.origin} → ${params.destination} on ${params.departure_date}${params.return_date ? ` · return ${params.return_date}` : ""}…`,
        });

        let offers: NormalizedOffer[] = [];
        let usedParams: SearchParams = params;
        let dateAdjusted = false;
        let searchError: string | null = null;

        try {
          const result = await searchWithFallback(params);
          offers = result.offers;
          usedParams = result.usedParams;
          dateAdjusted = result.dateAdjusted;
        } catch (err) {
          if (err instanceof DuffelError) {
            const code = err.response.errors[0]?.code ?? "";
            const isMultiCity = (params.additional_slices?.length ?? 0) > 0;
            if (code.includes("origin") || code.includes("departure")) {
              searchError = isMultiCity
                ? "We couldn't find one of the departure airports in your trip. Please check each city and try again."
                : `We couldn't find the airport "${params.origin}". Please try a different departure city.`;
            } else if (code.includes("destination") || code.includes("arrival")) {
              searchError = isMultiCity
                ? "We couldn't find one of the destination airports in your trip. Please check each city and try again."
                : `We couldn't find the airport "${params.destination}". Please try a different destination.`;
            } else if (code.includes("date")) {
              searchError = `That date doesn't seem right. Please try a different departure date.`;
            } else if (err.status === 429) {
              searchError = "We're seeing heavy traffic right now. Please try again in a few seconds.";
            } else {
              searchError = "Our flight search hit a snag. Please try a slightly different search.";
            }
          } else {
            searchError = "Flight search is temporarily unavailable. Please try again shortly.";
          }
        }

        if (searchError) {
          const reply = searchError;
          session.history.push({ role: "user", content: message.trim() });
          session.history.push({ role: "assistant", content: reply });
          await save(session);
          push("done", {
            session_id: session.id,
            offers: [],
            reply,
            search_params: params,
            search_failed: true,
          } satisfies ChatResponse);
          controller.close();
          return;
        }

        // ── Step 4: apply preference filters + generate reply ─────────
        if (offers.length > 0) {
          push("status", { step: "ranking", message: `Ranking ${offers.length} flights…` });
        }

        const { offers: filteredOffers, note: filterNote } = filterByPreferences(offers, usedParams);
        offers = filteredOffers;

        const cheapest = offers[0] ?? null;

        // The calendar's exact-date tile must show the same price the reply text
        // and offer list show - i.e. the post-filter cheapest, not the raw one -
        // otherwise a preference filter (e.g. refundable-only) makes the calendar
        // contradict what's actually on screen for that date.
        const [priceCalendar, reply] = await Promise.all([
          offers.length > 0
            ? getPriceCalendar(usedParams, 3, {
                cheapestAmount: cheapest?.total_amount ?? null,
                currency: cheapest?.total_currency ?? null,
              }).catch(() => [])
            : Promise.resolve([]),
          generateSearchReply(
            message.trim(),
            usedParams,
            offers.length,
            cheapest?.total_amount ?? null,
            cheapest?.total_currency ?? null,
            cheapest?.owner.name ?? null,
            dateAdjusted,
            filterNote
          ),
        ]);

        session.history.push({ role: "user", content: message.trim() });
        session.history.push({ role: "assistant", content: reply });
        session.last_params = usedParams;
        session.last_offers = offers;
        await save(session);

        push("done", {
          session_id: session.id,
          offers,
          reply,
          search_params: usedParams,
          price_calendar: priceCalendar,
        } satisfies ChatResponse);

        controller.close();
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Something went wrong";
        push("error", { message: msg });
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
