"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { OfferList } from "@/components/OfferList";
import { OfferCardSkeleton } from "@/components/OfferCard";
import { PriceCalendarSection } from "@/components/PriceCalendarSection";
import { ExploreResults } from "@/components/ExploreResults";
import { OrbiWordmark, OrbiMark } from "@/components/OrbiLogo";
import { FlightPath } from "@/components/FlightPath";
import { consumeChatStream } from "@/lib/chat/consumeChatStream";
import type { NormalizedOffer } from "@/lib/duffel/types";
import type { PriceCalendarEntry } from "@/lib/duffel/search";
import type { ExploreDestinationResult, ExploreParams, SearchParams } from "@/lib/parser/types";
import styles from "./page.module.css";

interface Message {
  role: "user" | "assistant";
  content: string;
  offers?: NormalizedOffer[];
  searchParams?: SearchParams | null;
  priceCalendar?: PriceCalendarEntry[];
  searchFailed?: boolean;
  exploreResults?: ExploreDestinationResult[];
  exploreParams?: ExploreParams;
  // Present only for a not-yet-confirmed "here's what we understood"
  // checkpoint - rendered as a summary + confirm/edit prompt instead of
  // offers, and gates the real Duffel search behind an explicit confirm.
  checkpoint?: { params: SearchParams; originalMessage: string };
}

function summarizeParams(params: SearchParams): string {
  const paxCount = params.passengers.reduce((sum, p) => sum + p.count, 0);
  const paxLabel = `${paxCount} ${paxCount === 1 ? "passenger" : "passengers"}`;
  const tripLabel = params.return_date
    ? `${params.departure_date} – ${params.return_date}`
    : params.departure_date;
  return `${params.origin} → ${params.destination} · ${tripLabel} · ${paxLabel}`;
}

const EXAMPLE_QUERIES = [
  "London to New York next Friday",
  "Return Paris → Tokyo, March 10 back March 20, business",
  "Non-stop Sydney to London in August",
  "3 passengers Toronto to Amsterdam Sep 1st",
  "Cheap flights from London this weekend, anywhere",
];

const POPULAR_ROUTES = [
  { from: "LHR", to: "JFK", label: "London → New York", query: "London to New York next Friday" },
  { from: "DXB", to: "BKK", label: "Dubai → Bangkok", query: "Dubai to Bangkok next month" },
  { from: "CDG", to: "NRT", label: "Paris → Tokyo", query: "Paris to Tokyo business class" },
  { from: "SYD", to: "SIN", label: "Sydney → Singapore", query: "Sydney to Singapore economy" },
  { from: "AMS", to: "LIS", label: "Amsterdam → Lisbon", query: "Amsterdam to Lisbon this weekend" },
  { from: "YYZ", to: "BCN", label: "Toronto → Barcelona", query: "Toronto to Barcelona in summer" },
];

const MAX_RECENT = 5;

function getSmartSuggestions(offers: NormalizedOffer[], params: SearchParams | null | undefined): string[] {
  const suggestions: string[] = [];

  if (!params) return ["Try different dates", "Change destination", "Add more passengers"];

  const hasNonstop = offers.some((o) => o.slices.every((s) => s.stops === 0));
  const hasStops = offers.some((o) => o.slices.some((s) => s.stops > 0));

  if (hasNonstop && hasStops) suggestions.push("Non-stop only");
  if (!params.additional_slices?.length) {
    if (!params.return_date) suggestions.push("Add a return flight");
    else suggestions.push("One-way only");
  }

  if (params.cabin_class === "business" || params.cabin_class === "first") {
    suggestions.push("Switch to economy");
  } else {
    suggestions.push("Upgrade to business");
  }

  suggestions.push("Try a day earlier");
  suggestions.push("Try a day later");

  return suggestions.slice(0, 5);
}

function getNoResultsSuggestions(params: SearchParams): string[] {
  const suggestions: string[] = [];
  suggestions.push("Try a week later");
  suggestions.push("Try flexible dates");
  if (params.max_connections === 0) suggestions.push("Allow connecting flights");
  if (params.cabin_class && params.cabin_class !== "economy") suggestions.push("Try economy class");
  if (!params.return_date && !params.additional_slices?.length) {
    suggestions.push("Add a return to see more options");
  }
  suggestions.push(`Change destination from ${params.destination}`);
  return suggestions.slice(0, 4);
}

function getParseErrorSuggestions(params: SearchParams | null | undefined): string[] {
  if (params?.origin && params?.destination) {
    return [
      `${params.origin} to ${params.destination}, next Friday`,
      `${params.origin} to ${params.destination}, return trip`,
      "Business class flights",
      "Non-stop only",
    ];
  }
  return [
    "London to New York next Friday",
    "Return Paris to Tokyo, business class",
    "Non-stop Sydney to London",
    "3 passengers Toronto to Amsterdam",
  ];
}

function pickSuggestions(msg: Message): string[] | null {
  // Explore-anywhere mode has its own ranked results and reply - generic
  // "try a week later"/parse-error chips don't apply here.
  if (msg.exploreResults !== undefined) return null;
  if (msg.offers === undefined) return null;           // network/SSE error - no hints
  if (msg.offers.length > 0) return getSmartSuggestions(msg.offers, msg.searchParams);
  // The search itself was invalid/failed (bad params, Duffel error) - "try a
  // week later" chips would just repeat the same broken search.
  if (msg.searchFailed) return getParseErrorSuggestions(msg.searchParams);
  if (msg.searchParams) return getNoResultsSuggestions(msg.searchParams);
  return getParseErrorSuggestions(msg.searchParams);  // parse failed
}

const STEP_LABELS: Record<string, string> = {
  parsing: "Understanding your request…",
  searching: "Searching 300+ airlines…",
  ranking: "Ranking results…",
};

export default function Home() {
  const router = useRouter();
  const { data: session } = useSession();

  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState("");
  const [statusStep, setStatusStep] = useState("");
  // Accumulates "reply_token" SSE chunks so the assistant's reply renders
  // progressively instead of popping in whole once "done" arrives.
  const [streamingReply, setStreamingReply] = useState("");
  // Both of these read browser storage, so they must start at the same
  // value the server rendered (undefined/[]) and only pick up the real
  // value in an effect after mount - reading storage inside the useState
  // initializer runs during hydration itself and made the client's first
  // render disagree with the server's, which crashed hydration (React
  // error #418) for any returning visitor with non-empty storage.
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);

  useEffect(() => {
    try {
      const stored = sessionStorage.getItem("orbi_session_id");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- loading persisted state after mount, not syncing from a prop/render value
      if (stored) setSessionId(stored);
    } catch { /* ignore */ }
    try {
      const stored = localStorage.getItem("recent_searches");
      if (stored) setRecentSearches(JSON.parse(stored) as string[]);
    } catch { /* ignore */ }
  }, []); // intentionally runs once on mount only, after hydration completes
  // Tracks which assistant message indexes have had "Track this price"
  // clicked (server-persisted via /api/tracked-searches - this Set is just
  // local UI state so the button can flip to a confirmed state).
  const [trackedMessageIdx, setTrackedMessageIdx] = useState<Set<number>>(new Set());

  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Persist session ID across page refreshes
  useEffect(() => {
    if (sessionId) {
      try { sessionStorage.setItem("orbi_session_id", sessionId); } catch { /* ignore */ }
    }
  }, [sessionId]);

  const hasSearched = messages.length > 0;

  // Declare sendMessage before any effects that reference it
  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || loading) return;
      const trimmed = text.trim();
      setInput("");
      setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
      setLoading(true);
      setStatusMsg(STEP_LABELS.parsing);
      setStatusStep("parsing");
      setStreamingReply("");

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: trimmed, session_id: sessionId }),
        });

        if (res.status === 429) {
          const body = await res.json().catch(() => ({ error: "" })) as { error?: string };
          setMessages((prev) => [
            ...prev,
            {
              role: "assistant",
              content: body.error ?? "Too many searches. Please wait a moment before trying again.",
            },
          ]);
          return;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        await consumeChatStream(res, {
          onStatus: (step, message) => {
            setStatusMsg(message);
            setStatusStep(step);
          },
          onReplyToken: (delta) => {
            setStreamingReply((prev) => prev + delta);
          },
          onCheckpoint: ({ session_id, params }) => {
            setSessionId(session_id);
            setMessages((prev) => [
              ...prev,
              { role: "assistant", content: "", checkpoint: { params, originalMessage: trimmed } },
            ]);
            setStatusMsg("");
            setStatusStep("");
            setStreamingReply("");
          },
          onDone: (body) => {
            if (body.session_id) setSessionId(body.session_id);
            setMessages((prev) => [
              ...prev,
              {
                role: "assistant",
                content: body.reply,
                offers: body.offers,
                searchParams: body.search_params,
                priceCalendar: body.price_calendar,
                searchFailed: body.search_failed,
                exploreResults: body.explore_results,
                exploreParams: body.explore_params,
              },
            ]);
            // Save to recent searches if offers were returned
            if (body.offers && body.offers.length > 0) {
              setRecentSearches((prev) => {
                const next = [trimmed, ...prev.filter((s) => s !== trimmed)].slice(0, MAX_RECENT);
                try { localStorage.setItem("recent_searches", JSON.stringify(next)); } catch { /* ignore */ }
                return next;
              });
            }
            setStatusMsg("");
            setStatusStep("");
            setStreamingReply("");
          },
          onError: (message) => {
            setMessages((prev) => [...prev, { role: "assistant", content: message }]);
            setStatusMsg("");
            setStatusStep("");
            setStreamingReply("");
          },
        });
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Something went wrong. Please try again." },
        ]);
        setStatusMsg("");
        setStatusStep("");
        setStreamingReply("");
      } finally {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [loading, sessionId]
  );

  // Resumes a "checkpoint" message (see Message.checkpoint) by confirming
  // the already-parsed params, skipping NL parsing entirely. Updates the
  // checkpoint message in place rather than appending a new one, since the
  // checkpoint IS this turn's assistant response - the real search result
  // replaces it once it arrives, it isn't a second reply after it.
  const confirmCheckpoint = useCallback(
    async (messageIdx: number) => {
      const target = messages[messageIdx];
      if (!target?.checkpoint || loading) return;
      const { params, originalMessage } = target.checkpoint;

      setLoading(true);
      setStatusMsg(STEP_LABELS.searching);
      setStatusStep("searching");
      setStreamingReply("");

      const replaceCheckpoint = (message: Message) => {
        setMessages((prev) => {
          const next = [...prev];
          next[messageIdx] = message;
          return next;
        });
      };

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: originalMessage,
            session_id: sessionId,
            confirmed_params: params,
          }),
        });

        if (res.status === 429) {
          const body = await res.json().catch(() => ({ error: "" })) as { error?: string };
          replaceCheckpoint({
            role: "assistant",
            content: body.error ?? "Too many searches. Please wait a moment before trying again.",
          });
          return;
        }

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        await consumeChatStream(res, {
          onStatus: (step, message) => {
            setStatusMsg(message);
            setStatusStep(step);
          },
          onReplyToken: (delta) => {
            setStreamingReply((prev) => prev + delta);
          },
          onDone: (body) => {
            if (body.session_id) setSessionId(body.session_id);
            replaceCheckpoint({
              role: "assistant",
              content: body.reply,
              offers: body.offers,
              searchParams: body.search_params,
              priceCalendar: body.price_calendar,
              searchFailed: body.search_failed,
            });
            if (body.offers && body.offers.length > 0) {
              setRecentSearches((prev) => {
                const next = [originalMessage, ...prev.filter((s) => s !== originalMessage)].slice(0, MAX_RECENT);
                try { localStorage.setItem("recent_searches", JSON.stringify(next)); } catch { /* ignore */ }
                return next;
              });
            }
            setStatusMsg("");
            setStatusStep("");
            setStreamingReply("");
          },
          onError: (message) => {
            replaceCheckpoint({ role: "assistant", content: message });
            setStatusMsg("");
            setStatusStep("");
            setStreamingReply("");
          },
        });
      } catch {
        replaceCheckpoint({
          role: "assistant",
          content: "Something went wrong. Please try again.",
        });
        setStatusMsg("");
        setStatusStep("");
        setStreamingReply("");
      } finally {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [messages, loading, sessionId]
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading, statusMsg]);

  // Keyboard shortcuts: "/" focuses input; Escape clears it when input is focused
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const active = document.activeElement;
      const inInput = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement;

      if (e.key === "Escape" && active === inputRef.current && input) {
        e.preventDefault();
        setInput("");
        return;
      }

      if (e.key !== "/" || loading || inInput) return;
      e.preventDefault();
      inputRef.current?.focus();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [loading, input]);

  // Auto-submit a query pre-filled by "Search similar" on the bookings page
  useEffect(() => {
    const q = localStorage.getItem("prefill_query");
    if (q) {
      localStorage.removeItem("prefill_query");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      sendMessage(q);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentionally runs once on mount only

  const lastAssistantIdx = messages.reduce(
    (last, m, i) => (m.role === "assistant" ? i : last),
   -1
  );

  return (
    <div className={styles.page}>
      <main className={styles.messages} aria-label="Flight search results" aria-live="off" aria-busy={loading}>
        {!hasSearched && (
          <div className={styles.hero}>
            <div className={styles.heroLogo}><OrbiWordmark /></div>
            <p className={styles.heroTagline}>Search real flights with plain English</p>
            <p className={styles.heroSub}>
              Save your details once - book any flight in under a minute, for life.
            </p>
            <div className={styles.examples}>
              {EXAMPLE_QUERIES.map((q) => (
                <button
                  key={q}
                  className={styles.exampleChip}
                  onClick={() => sendMessage(q)}
                >
                  {q}
                </button>
              ))}
            </div>

            {recentSearches.length > 0 && (
              <div className={styles.recentSection}>
                <div className={styles.recentHeader}>
                  <p className={styles.recentHeading}>Recent</p>
                  <button
                    className={styles.clearRecent}
                    onClick={() => {
                      setRecentSearches([]);
                      try { localStorage.removeItem("recent_searches"); } catch { /* ignore */ }
                    }}
                    aria-label="Clear recent searches"
                  >
                    Clear
                  </button>
                </div>
                <div className={styles.recentChips}>
                  {recentSearches.map((s) => (
                    <button
                      key={s}
                      className={styles.recentChip}
                      onClick={() => sendMessage(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className={styles.popularSection}>
              <p className={styles.popularHeading}>Popular routes</p>
              <div className={styles.popularGrid}>
                {POPULAR_ROUTES.map((r) => (
                  <button
                    key={r.label}
                    className={styles.popularCard}
                    onClick={() => sendMessage(r.query)}
                  >
                    <span className={styles.popularRoute}>{r.label}</span>
                    <span className={styles.popularLabel}>{r.from} → {r.to}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          const isLastAssistant = i === lastAssistantIdx;

          if (msg.role === "user") {
            return (
              <div key={i} className={styles.userRow}>
                <div className={styles.userBubble}>
                  <p>{msg.content}</p>
                </div>
              </div>
            );
          }

          if (msg.checkpoint) {
            return (
              <div key={i} className={styles.assistantRow}>
                <div className={styles.assistantHeader}>
                  <div className={styles.assistantAvatar}>
                    <OrbiMark tone="mono" className={styles.assistantAvatarMark} />
                  </div>
                  <span className={styles.assistantLabel}>Orbi</span>
                </div>
                <div className={styles.checkpointCard}>
                  <p className={styles.checkpointTitle}>Here&apos;s what I understood:</p>
                  <p className={styles.checkpointSummary}>{summarizeParams(msg.checkpoint.params)}</p>
                  <div className={styles.checkpointActions}>
                    <button
                      type="button"
                      className={styles.checkpointConfirmBtn}
                      onClick={() => confirmCheckpoint(i)}
                      disabled={loading || !isLastAssistant}
                    >
                      Confirm search
                    </button>
                    <button
                      type="button"
                      className={styles.checkpointEditBtn}
                      onClick={() => inputRef.current?.focus()}
                      disabled={loading || !isLastAssistant}
                    >
                      Edit
                    </button>
                  </div>
                </div>
              </div>
            );
          }

          const suggestions = isLastAssistant ? pickSuggestions(msg) : null;

          return (
            <div key={i} className={styles.assistantRow}>
              <div className={styles.assistantHeader}>
                <div className={styles.assistantAvatar}>
                  <OrbiMark tone="mono" className={styles.assistantAvatarMark} />
                </div>
                <span className={styles.assistantLabel}>Orbi</span>
              </div>
              <div className={styles.assistantBubble}>
                <p>{msg.content}</p>
              </div>
              {isLastAssistant && msg.exploreResults && msg.exploreResults.length > 0 && (
                <div className={styles.offers}>
                  <ExploreResults
                    results={msg.exploreResults}
                    disabled={loading}
                    onSelect={(destination) => {
                      const p = msg.exploreParams;
                      if (!p) return;
                      const returnPart = p.return_date ? ` returning ${p.return_date}` : "";
                      sendMessage(
                        `${p.origin} to ${destination} on ${p.departure_date}${returnPart}`
                      );
                    }}
                  />
                </div>
              )}
              {msg.offers && msg.offers.length > 0 && (
                <div className={styles.offers}>
                  {isLastAssistant &&
                    msg.searchParams?.origin &&
                    msg.searchParams?.destination &&
                    !msg.searchParams?.additional_slices?.length && (
                    <div className={styles.routeStrip}>
                      <FlightPath
                        compact
                        origin={msg.searchParams.origin}
                        destination={msg.searchParams.destination}
                      />
                    </div>
                  )}
                  {isLastAssistant && msg.priceCalendar && msg.priceCalendar.length > 1 && msg.searchParams && (
                    <PriceCalendarSection
                      entries={msg.priceCalendar}
                      searchParams={msg.searchParams}
                      selectedDate={msg.searchParams.departure_date}
                      onSelectDate={(date) => {
                        const { departure_date, return_date } = msg.searchParams!;
                        if (!return_date) {
                          sendMessage(`Change date to ${date}`);
                          return;
                        }
                        // The calendar's price for this date assumes the same
                        // trip length (getPriceCalendar shifts both dates by
                        // the same delta) - say so explicitly instead of
                        // leaving the LLM to guess/carry forward the old
                        // return date, which would search a different trip
                        // than the price shown.
                        const deltaDays = Math.round(
                          (Date.parse(date) - Date.parse(departure_date)) / 86_400_000
                        );
                        const shiftedReturn = new Date(return_date + "T00:00:00Z");
                        shiftedReturn.setUTCDate(shiftedReturn.getUTCDate() + deltaDays);
                        sendMessage(
                          `Change dates to depart ${date} and return ${shiftedReturn.toISOString().split("T")[0]}`
                        );
                      }}
                      disabled={loading}
                    />
                  )}
                  <OfferList
                    offers={msg.offers}
                    onSelect={(o) => handleSelectOffer(o, msg.searchParams)}
                  />
                  {msg.searchParams && (
                    <div className={styles.trackPriceRow}>
                      <button
                        type="button"
                        className={`${styles.trackPriceBtn} ${trackedMessageIdx.has(i) ? styles.trackPriceBtnTracked : ""}`}
                        disabled={trackedMessageIdx.has(i)}
                        onClick={() => handleTrackPrice(i, msg.offers!, msg.searchParams!)}
                      >
                        {trackedMessageIdx.has(i) ? "✓ Tracking this price" : "Track this price"}
                      </button>
                    </div>
                  )}
                </div>
              )}
              {suggestions && (
                <div className={styles.suggestions}>
                  {suggestions.map((s) => (
                    <button
                      key={s}
                      className={styles.suggestionChip}
                      onClick={() => sendMessage(s)}
                      disabled={loading}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {loading && (
          <div className={styles.assistantRow}>
            <div className={styles.assistantHeader}>
              <div className={styles.assistantAvatar}>
                <OrbiMark tone="mono" className={styles.assistantAvatarMark} />
              </div>
              <span className={styles.assistantLabel}>Orbi</span>
            </div>
            {streamingReply ? (
              <div className={styles.assistantBubble}>
                <p>{streamingReply}</p>
              </div>
            ) : statusMsg ? (
              <div className={styles.statusBubble}>
                <span className={styles.statusSpinner} />
                <span className={styles.statusText}>{statusMsg}</span>
              </div>
            ) : (
              <div className={styles.thinkingBubble}>
                <div className={styles.dot} />
                <div className={styles.dot} />
                <div className={styles.dot} />
              </div>
            )}
            {(statusStep === "searching" || statusStep === "ranking") && (
              <div className={styles.offers}>
                <div className={styles.routeStrip}>
                  <FlightPath compact />
                </div>
                <OfferCardSkeleton />
                <OfferCardSkeleton />
                <OfferCardSkeleton />
              </div>
            )}
          </div>
        )}

        <div ref={bottomRef} />
      </main>

      <div aria-live="polite" aria-atomic="true" className={styles.srOnly}>
        {statusMsg || (loading ? "Searching for flights" : "")}
      </div>

      <div className={styles.formWrapper}>
        {hasSearched && !loading && (
          <div className={styles.newSearchRow}>
            <button
              className={styles.newSearchBtn}
              onClick={() => {
                setMessages([]);
                setSessionId(undefined);
                setInput("");
                try { sessionStorage.removeItem("orbi_session_id"); } catch { /* ignore */ }
                setTimeout(() => inputRef.current?.focus(), 50);
              }}
            >
              ↩ New search
            </button>
          </div>
        )}
        {input.length >= 280 && (
          <p className={styles.charWarning}>
            {input.length} chars - try to keep queries concise for best results
          </p>
        )}
        <form
          className={styles.form}
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input);
          }}
        >
          <input
            ref={inputRef}
            className={styles.input}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              hasSearched
                ? "Refine search or ask something new…"
                : "Where do you want to fly?"
            }
            disabled={loading}
            autoFocus
            autoComplete="off"
            spellCheck={false}
            maxLength={400}
            title="Press / to focus search"
            aria-label="Flight search"
          />
          {!input && !loading && (
            <span className={styles.enterHint} aria-hidden="true" title="Press Enter to search">↵</span>
          )}
          <button
            type="submit"
            className={styles.button}
            disabled={loading || !input.trim()}
          >
            {loading ? "Searching…" : "Search"}
          </button>
        </form>
      </div>
    </div>
  );

  async function handleTrackPrice(
    messageIdx: number,
    offers: NormalizedOffer[],
    searchParams: SearchParams
  ) {
    if (!session?.user) {
      router.push("/login?callbackUrl=/");
      return;
    }
    if (trackedMessageIdx.has(messageIdx)) return;

    const cheapest = offers.reduce((min, o) =>
      parseFloat(o.total_amount) < parseFloat(min.total_amount) ? o : min
    , offers[0]);

    // Optimistic: this is a non-monetary save, not a booking, so it's safe to
    // show "tracked" instantly and roll back on failure rather than making
    // the user wait on the round-trip to see confirmation.
    setTrackedMessageIdx((prev) => new Set(prev).add(messageIdx));
    try {
      const res = await fetch("/api/tracked-searches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          searchParams,
          cheapestAmount: cheapest.total_amount,
          cheapestCurrency: cheapest.total_currency,
        }),
      });
      if (!res.ok) {
        setTrackedMessageIdx((prev) => {
          const next = new Set(prev);
          next.delete(messageIdx);
          return next;
        });
      }
    } catch {
      setTrackedMessageIdx((prev) => {
        const next = new Set(prev);
        next.delete(messageIdx);
        return next;
      });
    }
  }

  function handleSelectOffer(offer: NormalizedOffer, searchParams?: SearchParams | null) {
    if (!session?.user) {
      router.push("/login?callbackUrl=/booking/confirm");
      return;
    }
    localStorage.setItem(
      "pending_booking",
      JSON.stringify({ offer, searchParams: searchParams ?? {} })
    );
    router.push("/booking/confirm");
  }
}
