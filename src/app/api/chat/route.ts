import { NextRequest, NextResponse } from "next/server";
import { nlParse, validateParams, validateExploreParams, generateSearchReply } from "@/lib/parser/nl-parser";
import { searchWithFallback, filterByPreferences, getPriceCalendar } from "@/lib/duffel/search";
import type { PriceCalendarEntry } from "@/lib/duffel/search";
import { exploreDestinations } from "@/lib/duffel/explore";
import { getOrCreate, save } from "@/lib/session/store";
import { DuffelError } from "@/lib/duffel/client";
import { enforceRateLimit, checkRateLimit, getClientIp } from "@/lib/rate-limit";
import type { NormalizedOffer } from "@/lib/duffel/types";
import type { ExploreDestinationResult, ExploreParams, SearchParams } from "@/lib/parser/types";
import { track } from "@vercel/analytics/server";

// Parses (LLM) + Duffel search + price calendar can each take up to the
// client-level 10s timeout; give this route enough headroom to not get cut
// off mid-request by the platform default before those calls even finish.
export const maxDuration = 30;

export interface ChatRequest {
  message: string;
  session_id?: string;
  // Present only when the client is resuming after a "checkpoint" event
  // (see below) - skips NL parsing entirely and searches these exact
  // params instead, since re-running the LLM parse on a message that's
  // already been correctly understood would be wasted work (and could
  // theoretically parse differently the second time). Still re-validated
  // with validateParams below - this is client-supplied data, and the
  // client could be anything, not just this app's own frontend.
  confirmed_params?: SearchParams;
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

// Shape of the `checkpoint` event data - a normal (non-explore) search's
// parsed params, surfaced for the user to confirm or edit before the real
// Duffel search fires. See ChatRequest.confirmed_params for the resume path.
export interface CheckpointEvent {
  session_id: string;
  params: SearchParams;
}

function sse(event: string, data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  // Doubled from the default 8/60s: the checkpoint step (see below) splits
  // one logical search into two requests (checkpoint + confirm), so the
  // same effective per-minute search budget as before Phase 3 now needs
  // roughly double the raw request budget. An edit before confirming costs
  // one more request still, which is fair - it's genuinely extra parse work.
  const rateLimited = await enforceRateLimit(req, "chat", { max: 16, windowMs: 60_000 });
  if (rateLimited) return rateLimited;

  let body: ChatRequest;
  try {
    body = (await req.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { message, session_id, confirmed_params } = body;

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

        // True only when confirmed_params exactly matches what the most
        // recently shown checkpoint for THIS session actually parsed - not
        // just "confirmed_params is present." Guards against a stale or
        // replayed confirm (e.g. confirming an old checkpoint after already
        // typing a newer edit) silently overwriting the wrong checkpoint's
        // placeholder history entry - a mismatch is instead treated as its
        // own fresh turn, appended rather than spliced into an unrelated slot.
        const confirmsPendingCheckpoint =
          !!confirmed_params &&
          JSON.stringify(confirmed_params) === JSON.stringify(session.last_params);

        // The user's turn was already recorded in history when the checkpoint
        // was first shown (see the checkpoint push below) - don't record it
        // again when they come back having confirmed it, or history would
        // have the same message twice.
        const recordUserTurn = () => {
          if (!confirmsPendingCheckpoint) {
            session.history.push({ role: "user", content: message.trim() });
          }
        };

        // Same idea for the assistant side: confirming the pending checkpoint
        // means this turn already has a placeholder assistant reply from when
        // the checkpoint was shown (the "here's what I understood" summary) -
        // replace it with the real reply instead of pushing a second
        // assistant turn back to back, which would break the strict
        // user/assistant alternation nlParse's follow-up context relies on.
        const recordAssistantReply = (content: string) => {
          if (confirmsPendingCheckpoint && session.history.at(-1)?.role === "assistant") {
            session.history[session.history.length - 1] = { role: "assistant", content };
          } else {
            session.history.push({ role: "assistant", content });
          }
        };

        let params: SearchParams | null;
        let error: string | null = null;
        let exploreParams: ExploreParams | null = null;

        if (confirmed_params) {
          params = confirmed_params;
        } else {
          // ── Step 1: parse ────────────────────────────────────────────
          push("status", { step: "parsing", message: "Understanding your request…" });

          const parsed = await nlParse(message.trim(), session.history, session.last_params);
          params = parsed.params;
          error = parsed.error;
          exploreParams = parsed.exploreParams;

          // Knowledge question - answer directly, no Duffel call
          if (parsed.answer) {
            session.history.push({ role: "user", content: message.trim() });
            session.history.push({ role: "assistant", content: parsed.answer });
            await save(session);
            push("done", {
              session_id: session.id,
              offers: [],
              reply: parsed.answer,
              search_params: null,
            } satisfies ChatResponse);
            controller.close();
            return;
          }
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

          // "Explore anywhere" fans out ~26 real Duffel calls per message
          // (one per POPULAR_DESTINATIONS entry) - disproportionately
          // expensive versus a normal single-route search, on top of this
          // route already being deliberately unauthenticated. A separate,
          // tighter budget keyed by IP (not the general "chat" key already
          // checked above) stops one client from burning through the
          // Duffel-call budget via repeated explore-mode messages, without
          // narrowing the normal search path's limit.
          if (process.env.NODE_ENV !== "test") {
            const exploreLimit = await checkRateLimit(`explore:${getClientIp(req)}`, {
              max: 3,
              windowMs: 60_000,
            });
            if (!exploreLimit.ok) {
              const reply = "Too many 'anywhere' searches - please wait a moment and try again.";
              session.history.push({ role: "user", content: message.trim() });
              session.history.push({ role: "assistant", content: reply });
              await save(session);
              push("done", {
                session_id: session.id,
                offers: [],
                reply,
                search_params: null,
                search_failed: true,
              } satisfies ChatResponse);
              controller.close();
              return;
            }
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
          recordUserTurn();
          recordAssistantReply(validationError);
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

        // ── Checkpoint: confirm before the real search fires ───────────
        // Surfaces the parsed params for the user to confirm or edit,
        // rather than immediately spending a real Duffel call on a
        // possible misparse. Skipped when confirmed_params was provided -
        // that request IS the confirmation, so it goes straight to
        // searching. Editing is just sending a normal follow-up message;
        // nlParse already merges it against session.last_params (set
        // below), so no separate "edit" protocol is needed.
        if (!confirmed_params) {
          const checkpointSummary =
            `${params.origin} → ${params.destination} on ${params.departure_date}` +
            (params.return_date ? ` (returning ${params.return_date})` : "");
          session.history.push({ role: "user", content: message.trim() });
          // nlParse's follow-up context injects its own user+assistant pair
          // (the "[Previous search parameters: ...]" message) right after
          // whatever's already in history - without an assistant turn here,
          // that would put two "user" messages back to back, which the LLM
          // API rejects/mishandles (strict role alternation). This keeps
          // history alternating correctly for the next message, whether
          // it's a "confirm" or an edit.
          session.history.push({
            role: "assistant",
            content: `Here's what I understood: ${checkpointSummary}. Let me know if that's not right, or confirm to search.`,
          });
          session.last_params = params;
          await save(session);
          push("checkpoint", { session_id: session.id, params } satisfies CheckpointEvent);
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
          recordUserTurn();
          recordAssistantReply(reply);
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
            filterNote,
            (delta) => push("reply_token", { delta })
          ),
        ]);

        recordUserTurn();
        recordAssistantReply(reply);
        session.last_params = usedParams;
        session.last_offers = offers;
        await save(session);

        track("search_completed", {
          offerCount: offers.length,
          origin: usedParams.origin,
          destination: usedParams.destination,
          channel: req.cookies.get("orbi_channel")?.value ?? "direct",
        }).catch(() => {});

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
