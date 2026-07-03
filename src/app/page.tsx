"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { OfferList } from "@/components/OfferList";
import { OfferCardSkeleton } from "@/components/OfferCard";
import { PriceCalendarSection } from "@/components/PriceCalendarSection";
import { ExploreResults } from "@/components/ExploreResults";
import type { ChatResponse } from "@/app/api/chat/route";
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
  searching: "Searching 500+ airlines…",
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
  const [sessionId, setSessionId] = useState<string | undefined>(() => {
    if (typeof window === "undefined") return undefined;
    return sessionStorage.getItem("orbi_session_id") ?? undefined;
  });
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const stored = localStorage.getItem("recent_searches");
      return stored ? (JSON.parse(stored) as string[]) : [];
    } catch {
      return [];
    }
  });
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

        if (!res.ok || !res.body) {
          throw new Error(`HTTP ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        let evt = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              evt = line.slice(7).trim();
            } else if (line.startsWith("data: ")) {
              const data = JSON.parse(line.slice(6)) as Record<string, unknown>;

              if (evt === "status") {
                setStatusMsg((data.message as string) ?? "");
                setStatusStep((data.step as string) ?? "");
              } else if (evt === "done") {
                const body = data as unknown as ChatResponse;
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
              } else if (evt === "error") {
                setMessages((prev) => [
                  ...prev,
                  {
                    role: "assistant",
                    content: (data.message as string) ?? "Something went wrong.",
                  },
                ]);
                setStatusMsg("");
                setStatusStep("");
              }

              evt = "";
            }
          }
        }
      } catch {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: "Something went wrong. Please try again." },
        ]);
        setStatusMsg("");
        setStatusStep("");
      } finally {
        setLoading(false);
        setTimeout(() => inputRef.current?.focus(), 50);
      }
    },
    [loading, sessionId]
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
            <div className={styles.heroLogo}>Orbi</div>
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

          const suggestions = isLastAssistant ? pickSuggestions(msg) : null;

          return (
            <div key={i} className={styles.assistantRow}>
              <div className={styles.assistantHeader}>
                <div className={styles.assistantAvatar}>O</div>
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
              <div className={styles.assistantAvatar}>O</div>
              <span className={styles.assistantLabel}>Orbi</span>
            </div>
            {statusMsg ? (
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
