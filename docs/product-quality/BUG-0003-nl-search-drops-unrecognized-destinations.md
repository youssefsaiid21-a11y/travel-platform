---
id: BUG-0003
type: bug
status: planned
flow: search
severity: blocks-booking
owner: fullstack-engineer
created: 2026-07-13
observed_at_commit: 23c8392
---

## Repro steps

Tried three related queries on the homepage chat search, each a distinct,
well-formed request naming two major, real European capital-city
airports:

1. `"Madrid to Rome next month"` -> "Could not parse flight search from
   your message." (reproduced twice in a row, identical result both
   times)
2. `"Madrid to Rome on August 15"` (explicit date, ruling out "next
   month" as the cause) -> same "Could not parse flight search from your
   message."
3. `"Paris to Madrid next Friday"` (known-good origin phrasing, from
   earlier successful "London to X next Friday"/"next Tuesday" queries)
   -> did **not** fail, but silently dropped the destination entirely and
   returned "Found 24 destinations from CDG on 2026-07-17. Cheapest:
   Amsterdam from 44.11 EUR" - an unrelated "explore anywhere from Paris"
   result set that doesn't include Madrid anywhere in it, with zero
   indication to the user that "to Madrid" was ignored.

For comparison, "next Friday"/"next Tuesday" phrasing with other cities
(London, Berlin, Sydney, Tokyo, Paris-as-origin) parsed correctly and
consistently throughout this same session.

## Expected behavior

"Madrid" and "Rome" are two of the largest, most commonly-searched
airports in Europe (MAD, FCO/CIA). A well-formed natural-language query
naming either of them as origin or destination should parse into a
normal search, the same as any other major city tested in this session.

## Actual behavior

- When *both* origin and destination are one of these cities: total parse
  failure, no search performed, no explanation of what to fix.
- When *only the destination* is one of these cities (origin is a
  recognized city): the query silently falls back to "explore anywhere"
  mode from the origin, completely dropping the stated destination with
  no indication to the user that anything was ignored. The user sees
  results (so it doesn't look broken), but none of them are the flight
  they actually asked for.

Since chat-based natural-language search is the *only* way to initiate a
search in this product (no manual origin/destination dropdown exists),
this fully blocks searching for - and therefore booking - a flight to
Madrid or Rome by name, for any phrasing tried in this session.

## Evidence

- All three `/api/chat` requests returned HTTP 200 (network log) - this
  is not a technical/HTTP-level failure, it's a genuine gap in the
  NL-parsing/city-recognition logic (likely the Z.AI tool-call output or
  an IATA-code lookup table missing these two cities), reproduced
  consistently (2/2 direct failures, 1/1 silent-drop) rather than a
  one-off flake.
- Chat transcript (screenshots) shows the exact input/output pairs for
  all three attempts.

## Suggested fix direction

Investigate the city-name-to-IATA-code resolution step (likely in the NL
parser prompt/schema or a lookup table in `src/lib/`) for gaps around
Madrid/Rome specifically, and check whether the "explore anywhere"
fallback path can be entered when a destination *was* stated but not
recognized - that fallback should either surface a clarifying question
("did you mean a specific destination? we couldn't match 'Madrid'") or
extend the recognized-city set, not silently substitute an unrelated
result set.

---

## Root cause (confirmed against the code, 2026-07-14 - fullstack-engineer)

The bug report's stated hypothesis - "an IATA lookup table missing Madrid/
Rome" - is **factually wrong about the mechanism: there is no lookup table
in the parse path at all.** City-to-IATA resolution is delegated 100% to
the Z.AI GLM-4-32B LLM. `src/lib/parser/nl-parser.ts` simply takes whatever
string the model returns in the `origin`/`destination` tool-call fields and
uppercases + slices it to 3 chars (lines 360-361). No deterministic
resolution, no table, nothing the model can lean on when it's unsure.

Two things in the code make Madrid/Rome fail specifically while London/
Berlin/Sydney/Tokyo/Paris succeed:

1. **The system prompt hardcodes a 15-city few-shot list** (nl-parser.ts
   line 173: `London→LHR, New York→JFK, Paris→CDG, Tokyo→NRT, Sydney→SYD,
   Dubai→DXB, Bangkok→BKK, Los Angeles→LAX, Chicago→ORD, Amsterdam→AMS,
   Toronto→YYZ, Singapore→SIN, Berlin→BER, Lisbon→LIS, Barcelona→BCN`).
   **Every city the report says succeeds is on this list. Both cities that
   fail (Madrid, Rome) are absent from it.** For a 32B model, a list like
   this reads less like "examples" and more like an implicit whitelist -
   it reliably resolves the primed cities and gets shaky on unprimed ones.
   (Note: `src/lib/airlines/popularDestinations.ts` DOES contain Madrid=MAD
   and Rome=FCO - but that table is only used by explore-anywhere fan-out,
   never by the parser. A correct mapping already exists in-repo, just
   wired to the wrong place.)

2. **The "no destination" field is overloaded to mean two different
   things,** and the code cannot tell them apart. Omitting `destination`
   is the *intended* signal for explore-anywhere mode (schema description,
   nl-parser.ts lines 50-58: "Omit this field ENTIRELY ... do not guess
   one"). So when the model can't confidently resolve a *stated*
   destination, the schema's own instruction actively pushes it to omit
   the field - which is indistinguishable, downstream, from a genuine
   "anywhere" request.

Mapping this to the two observed symptoms:

- **Symptom 1 (`Madrid to Rome` → total parse failure).** Neither city is
  primed; the model failed to produce a usable `origin` (either no valid
  tool call across all 3 attempts, or `origin` missing/garbled). That path
  returns the literal string `"Could not parse flight search from your
  message."` - which is emitted at nl-parser.ts line 274 (attempts
  exhausted) and line 295 (origin/date not a string), and *nowhere in the
  chat route*. The exact wording confirms the failure originates inside
  `nlParse`, not in `/api/chat`.

- **Symptom 2 (`Paris to Madrid` → silent explore-anywhere).** Origin
  (Paris/CDG, primed) resolved fine; for the unprimed "Madrid" the model
  omitted `destination` per the schema's own "when unsure, omit" wording.
  nl-parser.ts line 313 sees `hasDestination === false`, builds
  `exploreParams` (lines 319-331), and chat/route.ts line 165 runs
  explore-anywhere from CDG. The stated destination is dropped with no
  signal to the user - exactly as reported.

**Honest limitation:** the *mechanism* above is fully confirmed from the
code. The *specific* model behavior for each symptom (which branch fires)
is inferred from the exact error strings plus the report's empirical repro
(2/2 and 1/1) - I did not independently re-run `nlParse` against Z.AI
(no `ZHIPU_API_KEY` in this environment, and the behavior is
non-deterministic LLM output anyway, so a single re-run wouldn't be
definitive). This does not change the fix: the fix removes the LLM's sole
responsibility for resolution and closes the overloaded-signal hole,
regardless of exactly which failure branch a given query happens to hit.

## Plan (fullstack-engineer, 2026-07-14)

Scope is entirely the **parse flow** - no Duffel/order/payment/secret code
is touched (see the booking-safety note below). Three coordinated changes:

**A. Deterministic city→IATA resolution (new file `src/lib/parser/
airports.ts`).** Export `CITY_TO_IATA` - a curated map of major city and
airport names + common aliases → primary IATA - seeded from the existing
`POPULAR_DESTINATIONS` data and expanded to a broader set of world-major
cities, explicitly including `madrid→MAD` and `rome→FCO`. Export a
normalizer `resolveCity(text): string | null` (lowercase/trim/alias-fold).
This makes resolution deterministic rather than a coin-flip on the model's
per-city recall, and directly fixes the Madrid/Rome coverage gap and the
broader class of unprimed-city failures they reveal. This is the "extend
the recognized-city set" half the report asked for, done properly (a real
table the code owns, not more prompt priming that the model may still miss).

**B. Give the parser the user's raw place text, and stop the silent
explore fallback (edit `nl-parser.ts`).**
- Add two optional string fields to the `extract_flight_search` tool:
  `origin_text` and `destination_text`, documented as "the origin/
  destination exactly as the user named it (city or code). Always fill
  these whenever the user states a place. Leave `destination_text` empty
  ONLY for genuine 'anywhere' requests." Keep the existing IATA
  `origin`/`destination` fields.
- Reframe the prompt's city list as *illustrative examples of a capability
  the model has for all major cities* (not an exhaustive whitelist), and
  add Madrid/Rome + more majors, to reduce the omission rate at the source.
- New per-field resolution in `nlParse`, for origin and destination:
  1. If the model's IATA field is a well-formed 3-letter code → use it
     (preserves every currently-passing fixture, incl. codes it gets right).
  2. Else if `*_text` resolves via `resolveCity()` → use that (deterministic
     recovery: "Madrid" → MAD even when the model omitted/garbled the code).
  3. Else if `*_text` is present but unresolved → return a **clarifying
     error** naming the place ("I couldn't match \"Madrid\" to an airport -
     try the airport code or a nearby major city"), routed through the
     existing `error` return so `/api/chat` surfaces it unchanged.
  4. Destination only: enter explore-anywhere **only** when there is no
     destination IATA AND no `destination_text` - i.e. the user genuinely
     stated no destination.

**C. Deterministic explore-gate backstop (edit `nl-parser.ts`).** Even if
the model misbehaves and omits both destination fields on a clearly-
directed query, only enter explore mode when the raw user message actually
contains an explore signal (`anywhere`, `surprise me`, `somewhere`, `where
can I`, `explore`, etc.). No destination + no explore signal → clarifying
error, not explore. This closes the silent-explore hole *deterministically*
rather than trusting the model to set `destination_text` correctly every
time - it's the part that makes symptom 2 genuinely fixed rather than just
made rarer. **Flagged for review:** this narrows the explore trigger and
carries a small regression risk (an exotic explore phrasing whose wording
isn't in the signal set would get a "please clarify" instead of explore
results). Given severity `blocks-booking` and the north-star Ease priority,
a recoverable "please clarify" on a rare explore phrasing is far preferable
to silently showing the wrong flights - but whether to ship C, or rely on
B alone, is a real judgment call I'm surfacing rather than deciding.

**Files touched:** `src/lib/parser/airports.ts` (new),
`src/lib/parser/nl-parser.ts`, `src/__tests__/parser/nl-parser.test.ts`
(+ possibly `fixtures.ts`). `src/app/api/chat/route.ts` is expected to
need **no change** - it already surfaces the `error` return as a friendly
reply (route.ts lines 246-261), so the clarifying-error path works without
route edits. If execution finds a route branch is needed, it's a small
addition and still touches no booking code.

**Alternatives considered / rejected:**
- *Prompt-only fix (just add Madrid/Rome to the few-shot list):* cheapest,
  but leaves resolution LLM-dependent and does nothing about the silent-
  explore hole for the next unprimed city. Rejected as a non-fix for
  symptom 2.
- *Full raw-text decoupling (model returns only place text, code does all
  resolution):* the most robust but a larger rewrite of the origin/
  destination path and every fixture. The A+B+C approach gets the same
  deterministic guarantees with a smaller, more revertable diff by keeping
  the model's IATA output as the fast path and the table as the safety net.

**Execution tier recommendation:** **Sonnet.** This is well-scoped
implementation work against a precise plan (default tier for functional-
agent work per CLAUDE.md Model routing). The one area needing care is the
prompt wording and the explore-gate signal set - if the founder wants
maximum caution on the prompt tuning, Opus is defensible, but the plan is
specific enough that Sonnet can execute it correctly.

**Booking-safety-reviewer:** **NOT required.** Confirmed by the actual
files touched, not the report's framing: parser logic, a new city-name
data module, and tests. No Duffel client, no `/api/booking`, no payment/
order creation, no secrets. The parser feeds search but never moves money
or creates an order.

**Approval tier:** bug-type ✓ and no booking-safety-reviewer needed ✓.
Eligibility for the founder-agent's own approval tier therefore hinges on
whether the plan review comes back clean. Because this plan deliberately
carries one flagged judgment call (change C's explore-gate tradeoff), if
review treats that as real uncertainty it should go to the human founder;
if review is comfortable with C (or with dropping C), founder-agent may
approve directly. Verdict recorded below.

## Plan review verdict (fresh critical Opus pass, 2026-07-14)

**Verdict: APPROVE WITH REQUIRED CHANGES. NOT a clean approve — genuine
uncertainty flagged → routes to the human founder's own sign-off, not the
founder-agent self-approval tier.**

Confirmed by the review: root cause is accurate (no deterministic IATA
lookup in the parse path; overloaded absent-destination signal; the "Could
not parse" string originates in `nlParse`, not the route). Scope is clean
(one flow, no hard-block/hub files, no live branch collision).
booking-safety-reviewer correctly NOT required (parser + data + tests, no
Duffel/order/payment/secret). Sonnet acceptable for execution provided the
post-execution review is Opus and specifically re-checks branch ordering
and explore-gate behavior.

Two counts of flagged uncertainty (why it's not a clean approve):
1. **Symptom-1 determinism is overstated.** If `Madrid to Rome` fails via
   the *no-tool-call* branch (nl-parser.ts line 274) rather than the
   garbled-origin branch (line 295), there is no tool-call payload at all,
   so the deterministic table (A) and `*_text` resolution (B) never
   engage - only the improved prompt priming helps, which is the very
   LLM-dependent mechanism the plan claims to move away from. The fix is
   fully deterministic for symptom 2 and for the "tool-call-returned-but-
   unresolved" flavor of symptom 1; it is prompt-tuning-dependent for the
   no-tool-call flavor. The plan's "regardless of which failure branch"
   claim must be scoped down honestly.
2. **Change C (explore-gate keyword backstop) is a real Ease-vs-Ease
   tradeoff.** Explore-anywhere/"surprise me" is itself a frictionless-
   booking feature; narrowing its trigger to a keyword allowlist adds
   friction to a legitimate flow to fix a different friction bug. The
   review proposes a cleaner primary mechanism: add an explicit
   `explore_anywhere: boolean` to the tool schema that the model sets only
   for genuine anywhere requests (removing the overloaded-absence at its
   source), with the keyword gate demoted to a final backstop. This should
   be evaluated before shipping C's keyword list as the primary gate.

Required changes before execution (fold into the plan at execution time):
1. Correct the symptom-1 determinism claim per (1) above.
2. Evaluate an explicit `explore_anywhere` boolean as the primary intent
   signal, keyword gate as backstop — or justify keeping keyword-gate
   primary.
3. Specify the "neither IATA nor `*_text` present" case (fall through to
   the existing missing-field error, not the new clarifying error), and
   preserve the existing ordering: the origin-required check must stay
   BEFORE the explore branch (the "still requires origin even in explore
   mode" test depends on it).
4. Decide whether the clarifying-error path should set `search_failed:
   true` (a small `route.ts` addition) rather than asserting zero route
   changes — semantically it IS a search failure and the client uses that
   flag for "fix your search" hints. This means route.ts MAY be touched
   after all (still no booking code).

Minor accuracy note: the "Could not parse" string is also returned at
nl-parser.ts line 356 (multi-city leg guard) — immaterial to this fix, but
the enumeration in the root-cause section isn't exhaustive.

## Status / approval routing

Status held at `planned`. Per the charter's two-tier approval model, this
does NOT qualify for founder-agent self-approval (that tier requires a
CLEAN plan review with no flagged uncertainty). It needs the **human
founder's own explicit sign-off** before any code is written, because the
review flagged real uncertainty (symptom-1 determinism scope + the Change C
explore-gate judgment call). On approval, incorporate the four required
changes above, then move to `approved`.

---

## Root cause correction (founder-agent, live empirical test, 2026-07-14)

The plan's root-cause theory (Madrid/Rome-specific coverage gap in the
model's per-city recall) is **not what's actually happening** - confirmed
by directly calling the real Z.AI API with the exact repro queries,
multiple times, plus a control test. Real observed behavior:

- `"Madrid to Rome next month"` → tool called correctly, but
  `destination: "ROM"` - the IATA **city** code for Rome (covers both
  FCO/CIA), not a real airport code. A genuine, separate bug: the model
  identifies the city fine, but returns the wrong *kind* of code.
- `"Madrid to Rome on August 15"` → **no tool call**, twice in a row, with
  a different plain-text excuse each time, despite `tool_choice:
  "required"` being set.
- **Control test, decisive: `"London to Berlin on August 15"`** - cities
  the original bug report says work fine - **also got no tool call**,
  same failure. `"Paris to Berlin next Friday"` and `"Paris to Madrid
  next Friday"` both worked correctly.

**Conclusion: this is not a city-recognition gap at all.** It's phrasing-
dependent, not city-dependent - an absolute date ("on August 15") makes
the model ask a clarifying question in plain text instead of calling the
tool, for ANY city pair; relative phrasing ("next Friday") reliably
works. `tool_choice: "required"` is being silently ignored roughly half
the time in this testing, far more often than the existing code comment
("some proxies don't enforce it 100%") implies. The original report's
"cities that work" list happened to all use relative-date phrasing;
Madrid/Rome got tested with absolute-date phrasing and looked like a city
gap that was actually a date-phrasing gap.

**What this means for the plan:** Change A (the city→IATA table) is still
a real, worthwhile fix for the genuine ROM-vs-FCO city/airport-code
confusion (secondary bug) - keep it, but reframe its purpose from "fix
Madrid/Rome specifically" to "validate/correct any returned code against
real airport codes, not just add two cities." Change B and C's premise
(garbled-city-name / silent-explore-on-unrecognized-destination) is still
worth having as defense-in-depth, but **does not address the primary,
now-confirmed cause** (tool-call enforcement failure, phrasing-dependent,
city-agnostic). The plan needs a new primary fix aimed at the actual
problem: harden the retry loop's handling of the "no tool call despite
required" case specifically (the existing 3-attempt loop is the only
current mitigation and its real-world failure rate looks meaningfully
higher than "occasional" based on this testing), and/or a system-prompt
change that explicitly tells the model to express any needed
clarification through `extract_flight_search`'s own `error` field rather
than replying in plain text - not just tolerate the failure and retry
around it.

Founder decision: proceed with a revised plan addressing this corrected
root cause. Model change (a different NL-parsing model/provider) explicitly
deferred to a later, separate decision - not in scope for this item.

