---
id: BUG-0003
type: bug
status: merged
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

---

# PLAN v2 - REPLAN against the corrected root cause (fullstack-engineer, 2026-07-14)

**Everything above from "## Root cause (confirmed against the code)" through
"## Status / approval routing" is the v1 plan and its review. It is
SUPERSEDED - kept only for history. The v1 root-cause theory (Madrid/Rome
per-city recall gap) was disproven by the founder-agent's live API test.
Do not execute v1. This v2 section is the plan of record.**

## What the actual root cause is (restated, so this section stands alone)

Two independent bugs, neither of which is a city-recognition gap:

1. **PRIMARY - tool-call enforcement fails on absolute-date phrasing,
   city-agnostically.** With an absolute date ("on August 15"), GLM-4-32B
   returns NO tool call roughly half the time and instead replies in plain
   text (a clarifying question), despite `tool_choice: "required"` being set
   - the Z.AI proxy does not hard-enforce it. Confirmed for ANY city pair
   (control: "London to Berlin on August 15" fails identically; both cities
   are on the primed few-shot list). Relative phrasing ("next Friday") works
   reliably. When no tool call comes back across all attempts, `nlParse`
   returns the literal "Could not parse flight search from your message."
   (nl-parser.ts line 274). This is the bug that blocks booking.

2. **SECONDARY - metropolitan city code instead of an airport code.** When
   the model DOES call the tool, it can return an IATA *city/metro* code
   (e.g. `destination: "ROM"` for Rome, which is the city code covering
   FCO+CIA, not a bookable airport) rather than a real airport code. The
   code path just uppercases+slices whatever string it gets (nl-parser.ts
   lines 360-361), and "ROM" passes `validateParams`' `/^[A-Z]{3}$/` check,
   so it sails through to Duffel as an unintended code.

## Why absolute-date phrasing specifically triggers plain-text replies
(the mechanism the fix targets)

The model wants to *ask a clarifying question* about the year ("August 15" -
this year or next?), but we have given it **no sanctioned in-tool channel to
do so**: the `error` field's own description (nl-parser.ts line 152-154)
explicitly says "Set this only if the message is not a flight search **at
all**", and the system prompt (line 179) reinforces "Set error only if the
message is completely unrelated to travel." So a flight request that the
model feels needs clarification has literally no permitted tool output -
it's boxed into either guessing (which it's reluctant to do on an ambiguous
absolute date) or breaking the "always call a tool" rule and replying in
prose. Because `tool_choice: "required"` isn't hard-enforced by the proxy,
the prose path wins about half the time. The relative-date case works
because "next Friday" is unambiguous to resolve, so the model never reaches
for clarification. **The fix therefore has to (a) remove the model's reason
to want to clarify absolute dates, (b) give it a real in-tool channel if it
still does, and (c) force compliance on retry - not just tolerate the plain-
text reply and re-roll the identical prompt.**

## The plan - two changes

### Change 1 (PRIMARY): close the plain-text-reply path at the source

All edits in `src/lib/parser/nl-parser.ts`. Four coordinated parts:

**1a. Give clarification a sanctioned home - broaden the `error` field.**
Rewrite the `error` property description (currently "Set this only if the
message is not a flight search at all") to: set it whenever you cannot
produce a confident search - EITHER the message isn't a flight search at
all, OR it's flight-shaped but you genuinely need to ask the user to
clarify something; put the clarifying question here as the value; NEVER ask
in plain text. This converts today's silent "no tool call" failure into, at
worst, a graceful clarifying question surfaced to the user (route.ts lines
246-261 already render a set `error` as a normal assistant reply - no route
change needed for this path).

**1b. Remove the reason to clarify absolute dates - strengthen the date
rule** in `buildSystemPrompt`. Make explicit that the model must resolve
every date itself, including bare absolute dates ("August 15", "on the 15th
of August", "December 3") to the nearest future occurrence, and must NOT ask
the user which year - just pick it (the existing "nearest future occurrence"
rule at line 175 already implies this for "March 10"-style inputs; this
makes it emphatic and names the "don't ask, just resolve" behavior directly,
which is the specific thing the model is currently failing to do).

**1c. Make the "never plain text" instruction actionable** by pairing it
with the channel from 1a. Replace the bare closing line ("Always call one of
the two tools - never reply in plain text") with: you MUST always call one
of the two tools and never reply in plain text under any circumstances; if
you need to ask the user anything, do NOT answer in prose - call
extract_flight_search and put the question in its `error` field (or use
answer_travel_question for general questions). The instruction only works
once 1a has actually given "ask via error" a place to land.

**1d. Stop the retry loop from re-rolling the identical prompt.** Today the
loop (lines 251-270) resends the exact same `messages` array on every
attempt, giving the model another unforced chance to make the same plain-
text choice. Change it so that after an attempt returns no tool call (or
malformed JSON), before the next attempt, a corrective instruction is
appended to `messages` - e.g. a `system`-role message: "Your previous
response did not call a function. You MUST call extract_flight_search or
answer_travel_question - do not reply in plain text. If you need to clarify
something, put the question in extract_flight_search's `error` field." Using
a `system` role sidesteps the user/assistant strict-alternation concern (it
doesn't participate in the alternation the way an extra user turn would);
the existing code already injects a synthetic user+assistant pair mid-array
for `previousParams`, so the API tolerates non-trivial message structures.
**Execution must confirm GLM accepts a trailing mid-conversation system
message** (fallback if not: append the model's own returned text as an
`assistant` turn followed by a `user`-role corrective, preserving
alternation - larger but safe).

**1e. Modestly raise the attempt bound** from 3 to 4 (`MAX_ATTEMPTS`). With
a confirmed ~50% per-attempt failure rate on the affected phrasing, and with
1d making retries materially more likely to succeed than a naive replay, 4
attempts gives real margin without risking the route's 30s `maxDuration`:
typical tool-call latency is 1-3s, so 4 attempts is ~4-12s in the common
case; the per-call 10s client timeout bounds the pathological case. Not
going higher than 4 deliberately, to stay clear of the 30s route ceiling in
the worst case. (This is a judgment dimension, not a load-bearing number -
3, 4, or 5 are all defensible; 4 is the honest middle given the evidence.)

### Change 2 (SECONDARY): deterministic airport-code correction

**New file `src/lib/parser/airports.ts`.** Export a curated
`METRO_TO_AIRPORT` map of the well-known IATA *metropolitan/city* codes that
are not themselves the primary bookable airport, each -> its primary airport
code (ROM->FCO, LON->LHR, NYC->JFK, PAR->CDG, TYO->NRT, MIL->MXP, WAS->IAD,
BUE->EZE, SAO->GRU, RIO->GIG, OSA->KIX, BJS->PEK, etc. - a bounded set,
there are only ~30-40 IATA metro codes worldwide), seeded to be consistent
with the primaries already in the prompt's few-shot list. Export
`normalizeAirportCode(code): string` - uppercase+slice to 3, return the
mapped airport if it's a known metro code, else return the code unchanged.

**Apply it in `nlParse`** at each point that currently does
`.toUpperCase().slice(0, 3)`: top-level `origin`, `destination`, the
explore-mode `origin`, and each `additional_slices` leg's origin/
destination. This runs BEFORE `validateParams`, so "ROM" becomes "FCO"
before validation or Duffel ever sees it.

**Scope boundary (deliberate):** this corrects the KNOWN, confirmed failure
class (metro codes) deterministically. It does NOT attempt a full positive
allowlist of all ~9,000 real IATA airport codes - that's an unmaintainable
dataset and out of scope. Genuinely unknown/garbage codes still fall through
to Duffel's own validation, which route.ts already handles with friendly,
specific errors (lines 331-338: "We couldn't find the airport ..."). So the
founder's "validate/correct any returned code" goal is met for the real
failure mode without building and owning a giant airport table.

## What v2 deliberately DROPS from v1, and why

v1's Change B (`origin_text`/`destination_text` fields + a city-NAME->IATA
table) and Change C (explore-gate keyword allowlist) are **not carried
forward.** The live test disproved their premise: the model resolves city
*names* fine (it returned ROM *because it correctly identified Rome*), and
the reported symptom-2 silent-explore-drop ("Paris to Madrid" -> explore)
did NOT reproduce in the live test ("Paris to Madrid next Friday" worked
correctly). Bundling a city-name table and narrowing the legitimate explore-
anywhere trigger (itself a frictionless-booking feature - the exact Ease-vs-
Ease tradeoff the v1 review flagged) to fix a now-unreproduced symptom is
scope creep against a disproven theory. **If** the silent-explore-drop is
reproduced later, it should be filed as its own item with its own live
repro, not smuggled in here. This keeps the diff tight and aimed only at the
two confirmed bugs (charter: "keep the diff as small as the fix actually
requires").

## Files touched

- `src/lib/parser/nl-parser.ts` - prompt (1b, 1c), `error` field desc (1a),
  retry loop (1d, 1e), apply `normalizeAirportCode` (Change 2).
- `src/lib/parser/airports.ts` - NEW (Change 2).
- `src/__tests__/parser/nl-parser.test.ts` - new tests: retry appends a
  corrective before re-calling (assert via `mockCreate.mock.calls[n]`'s
  messages), metro-code correction (ROM->FCO for origin, destination, and a
  multi-city leg), and the error-field-as-clarification path returning a
  friendly `error`. Existing retry tests stay valid (the "succeeds on 3rd
  attempt" test still passes with MAX_ATTEMPTS=4; the "gives up" test uses
  `mockResolvedValue` for every attempt, still exhausts and returns the
  friendly error).
- `src/app/api/chat/route.ts` - **NO change.** The broadened `error` path
  already surfaces as a friendly assistant reply (lines 246-261). A
  clarifying question is deliberately NOT flagged `search_failed: true` (it
  is a conversational turn, not a failed search - no "fix your search" hint
  wanted). No booking/order/payment/secret code anywhere in scope.

## Collision check

Working tree clean on `main` (tip cedd3d3). The four `track-*` branches that
`git diff --stat` shows touching nl-parser.ts are all fully MERGED and stale
(0 commits ahead of main, 115 behind; their tip == merge-base - the large
diff is divergence inflation, not active work). `ui-rehaul` touches no parser
files. No active branch collides with this flow. No hard-block/hub files
(`sitemap.ts`, `robots.ts`, `layout.tsx`) touched.

## Booking-safety-reviewer: NOT required

Parser logic, a new city-code data module, and tests. No Duffel client, no
`/api/booking`, no payment/order creation, no secrets. Same determination as
v1, and the v1 review confirmed it. The parser feeds search but never moves
money or creates an order.

## Honest uncertainties (flagged, not buried)

1. **The primary fix cannot be proven in this environment.** It targets non-
   deterministic LLM behavior; there is no `ZHIPU_API_KEY` here and the
   failure is a ~50% coin-flip, so unit tests (which mock the model) can
   only prove the *plumbing* (retry appends a corrective, error path
   surfaces, codes normalize) - they cannot prove the model's plain-text
   rate actually drops. The real acceptance gate is a **live repro test**
   the founder-agent runs post-execution (it already ran the diagnostic
   version): the exact absolute-date queries across several city pairs,
   multiple times each, confirming the plain-text-reply rate falls
   materially. This is the CLAUDE.md "verify in the real environment"
   discipline, and it is REQUIRED before this is called done - a green unit
   suite is explicitly not sufficient here.
2. Broadening `error` (1a) may slightly increase clarifying-question turns
   for genuinely ambiguous dates. That's a graceful outcome (a friendly
   question beats "Could not parse"), but it is a real behavior change worth
   watching in the live test - if the model over-clarifies dates it should
   just resolve, 1b's wording needs tightening.
3. The retry corrective's role/placement (1d) depends on GLM tolerating a
   mid-conversation system message - execution must verify, fallback noted.
4. MAX_ATTEMPTS 3-vs-4-vs-5 is a latency/reliability judgment, not a proven
   value.

## Execution tier recommendation: **Opus**

This is prompt-engineering against a specific, subtle LLM failure mode -
three prompt instructions (resolve dates confidently / route clarifications
through `error` / never plain-text) that must reinforce rather than conflict,
plus retry-message alternation mechanics. Wording is load-bearing here in a
way v1's mechanical table work wasn't. Per CLAUDE.md model routing, "any
decision where the wording itself is the fix" justifies Opus over the Sonnet
default. Sonnet + a mandatory Opus post-execution review that specifically
re-checks the prompt wording and the retry alternation is an acceptable
cheaper alternative, but Opus for execution is the safer call given how much
rides on getting three interacting instructions right.

## Approval routing: needs the HUMAN FOUNDER's own sign-off (not self-approve)

Per the charter, founder-agent self-approval requires a CLEAN plan review
with no flagged uncertainty. This plan carries genuine, material uncertainty
by its nature (item 1 above): the primary fix cannot be verified before
merge except by a live behavioral test, and it targets a failure the founder
themselves flagged as "meaningfully higher than occasional." That is exactly
the "bug-type item whose plan review flags real uncertainty" case the
charter routes to the human founder. I am NOT forcing a clean verdict to
unlock self-approval. Final determination recorded after the fresh Opus plan
review below.

## Plan review verdict (fresh critical Opus pass, 2026-07-14)

**Verdict: APPROVE WITH REQUIRED CHANGES. NOT a clean approve - genuine
uncertainty confirmed -> routes to the human founder's own sign-off, not the
founder-agent self-approval tier.**

Confirmed correct by the review: the v2 root-cause framing matches the
founder's live evidence (tool-call enforcement failure, phrasing-dependent,
city-agnostic; plus the metro-code secondary bug). The mechanism analysis -
that the model reaches for plain text because the `error` field is currently
walled off from flight-shaped requests, leaving no sanctioned clarification
channel - is sound and is the right thing to attack. Scope is clean: one
flow, no hard-block/hub files, no active-branch collision (the track-*
diffs are stale/merged, verified). booking-safety-reviewer correctly NOT
required. Existing tests survive the MAX_ATTEMPTS bump (verified: the "3rd
attempt" test stops at 3 calls since `input` is set; the "gives up" test
uses a persistent mock and asserts no call count). Dropping v1's B/C is a
defensible, disciplined call given the disproven premise.

Three substantive findings (why it's not a clean approve):

1. **Change 1's whole effectiveness is concentrated in ONE unverifiable
   prompt instruction (1b), and the failure mode if it under-delivers is
   subtle, not loud.** If 1b doesn't make the model resolve absolute dates
   confidently, 1a+1c simply convert today's ~50% hard "Could not parse"
   into some rate of "which year did you mean?" clarifying turns. That is
   strictly *better* (graceful, recoverable) but it is NOT the same as
   fixed, and a green unit suite will look identical either way because the
   model is mocked. REQUIRED: the live acceptance test is a hard gate (not
   optional), and it must explicitly measure BOTH (a) that the plain-text-
   reply rate drops AND (b) that the model isn't merely trading hard-fails
   for over-clarification of dates it should just resolve. If (b) shows up,
   1b's wording iterates before this ships.

2. **1d's primary mechanism (trailing `system` corrective) risks being
   accepted-but-ignored - flip it with the stated fallback.** Many models
   weight only the leading system message and treat a mid-conversation
   system turn as low-signal; "GLM accepts it" (doesn't 400) is weaker than
   "GLM heeds it." The plan's own fallback - capture the model's returned
   plain-text as an `assistant` turn, then append a `user`-role corrective -
   is both alternation-correct AND far more likely to actually change the
   next generation (a user instruction immediately preceding generation
   carries strong weight; we're currently discarding that assistant text
   anyway). REQUIRED: make the assistant-text + user-corrective approach the
   PRIMARY retry mechanism, not the fallback.

3. **Change 2 assumes FCO-normalization is strictly an improvement without
   confirming what "ROM" actually does at Duffel - and it could conflict
   with the Price north-star.** The IATA metro code ROM covers FCO
   (Fiumicino) AND CIA (Ciampino, the budget/Ryanair field). IF Duffel
   accepts metro codes and searches both airports, then rewriting ROM->FCO
   would DROP the cheaper CIA options - a Price regression to fix a bug
   whose actual symptom was never characterized (rejected? empty? wrong
   results?). REQUIRED: characterize the real ROM failure at Duffel (part of
   the same live test) before assuming FCO-normalization is the right
   correction. If Duffel handles metro codes fine, the correct fix may be to
   leave them alone or map to a multi-airport search, not narrow to one
   airport. Change 2 should not ship on the assumption alone.

Minor / non-blocking:
- 1d should append the corrective at most once (or dedupe), not stack an
  identical system/user turn on every failed iteration.
- The structural overloading behind old symptom-2 (omitted destination is
  indistinguishable from "couldn't resolve") still exists after v2; it's
  correctly out of scope here, but worth a one-line tracking note so it
  isn't forgotten if it ever resurfaces.

Net: the plan attacks the right cause and is honestly scoped, but its two
load-bearing pieces (the 1b prompt instruction and the Change 2
normalization) both rest on behavior that can only be confirmed live, and
one retry detail (1d) should be reworked before execution. That is real
uncertainty, not a clean approve.

## Status / approval routing (v2)

Status held at `planned`. Per the charter's two-tier model, this does NOT
qualify for founder-agent self-approval - that tier requires a CLEAN review
with no flagged uncertainty, and this review flags three substantive items,
two of which (1b's effectiveness, Change 2's correctness) can only be
resolved by a live test that hasn't run yet. It needs the **human founder's
own explicit sign-off** before any code is written. On approval, fold in the
three required changes (hard live-test gate incl. the over-clarification
check; flip 1d to assistant-text + user-corrector as primary; characterize
ROM-at-Duffel before shipping Change 2's normalization), then move to
`approved`. Recommended execution tier: **Opus** (prompt wording is the fix).

## Plan approval (founder-agent tier, 2026-07-15)

**Approved directly by founder-agent** under the widened step-3 tier in
`fullstack-engineer-agent.md` (2026-07-15: founder-agent can now
self-approve `bug`-type, non-money-adjacent plans regardless of whether
the review came back clean or flagged real uncertainty - this item is the
first approved under that widened rule). Confirmed this item qualifies:
`bug`-type, and per the review itself `booking-safety-reviewer` is NOT
required (no Duffel client, no `/api/booking`, no payment/order/secrets
touched).

Weighing the three flagged uncertainties directly, as the widened rule now
asks founder-agent to do:

1. **Live-test-only fix (1b).** Accepted as an unavoidable property of
   fixing non-deterministic model behavior, not a reason to withhold
   approval - the review's own required gate (a mandatory live acceptance
   test measuring both the plain-text-reply rate AND over-clarification,
   before this is called done) is the right control and is being carried
   into execution as a hard requirement, not a suggestion.
2. **Retry-mechanism weakness (1d).** Straightforward - the review's
   reasoning (a `user`-role corrective immediately preceding generation
   carries more weight than a mid-conversation `system` aside, and the
   assistant-text capture is already alternation-correct) is sound
   on its face. Execution must implement the assistant-text +
   user-corrective approach as PRIMARY, not fallback, per the review.
3. **ROM->FCO / Change 2's Price risk.** This is the one real product-shape
   judgment call in this plan, and it's the reason to be deliberate rather
   than wave it through: characterizing what Duffel actually does with a
   metro code (accepts it and searches both FCO+CIA vs. rejects it
   outright) must happen as part of the live test, BEFORE Change 2's
   normalization ships - not assumed. If Duffel already handles ROM fine
   and searches both airports, execution should NOT apply the
   normalization (leave metro codes alone, or file a follow-up for a
   proper multi-airport search) rather than shipping a Price regression to
   fix a bug that turns out not to need this specific fix. This is
   explicitly called out as a required change, not a nice-to-have.

**Required changes folded in as execution requirements (not optional):**
- Hard live-test gate: measure both plain-text-reply rate drop AND
  over-clarification rate on dates, across several absolute-date city-pair
  queries, multiple runs each. A green unit suite alone does not close this
  item.
- 1d's primary mechanism is assistant-text-capture + user-role corrective,
  not a trailing system message. Append the corrective at most once per
  retry sequence (don't stack on every failed attempt).
- Characterize ROM's actual behavior at Duffel as part of the live test
  before Change 2 ships. If metro codes already resolve correctly and
  search multiple airports, do not apply `normalizeAirportCode` in a way
  that narrows the search - re-scope Change 2 or drop it, and note the
  finding in this file.

Execution tier: **Opus**, per the plan's own recommendation (prompt wording
is the load-bearing part of this fix).

Status moved to `approved`.

---

## Execution (fullstack-engineer, 2026-07-15)

Implemented the v2 plan as approved, with the three required changes folded
in exactly as specified. All edits confined to the parse flow - no Duffel
client/order/payment/secret code touched.

### What shipped

**Change 1 (primary - `src/lib/parser/nl-parser.ts`):**
- **1a.** `error` field description broadened: set for either "not a flight
  search at all" OR "flight-shaped but needs clarification" (question goes
  in the field value); explicitly told NOT to use it to ask which year a
  date falls in (that's 1b's job); never ask in plain text.
- **1b.** Date rule strengthened: any bare absolute date must be resolved by
  the model itself (nearest future occurrence), with an explicit "do NOT
  ask the user which year - just pick one" instruction and "no exceptions."
- **1c.** Closing instruction rewritten to pair with 1a: must always call a
  tool, never plain text, and route any needed clarification (including
  year ambiguity) through `error`.
- **1d. (required change, implemented as PRIMARY not fallback).** The retry
  loop no longer re-sends the identical `messages` array. After the FIRST
  failed attempt (no tool call, or malformed JSON) in a retry sequence, the
  model's own returned content is captured as a genuine `assistant` turn
  (preserving strict alternation, using `"(no response)"` as a placeholder
  when content is empty/missing), followed by a `user`-role corrective
  instructing it to call one of the two tools and use `error` for any
  needed clarification. This is NOT a system-role message, and is appended
  **at most once** per retry sequence (a `correctiveAppended` flag guards
  subsequent failed attempts from stacking another copy).
- **1e.** `MAX_ATTEMPTS` raised 3 → 4.

**Change 2 (secondary - new `src/lib/parser/airports.ts`):** curated
`METRO_TO_AIRPORT` map (ROM→FCO, LON→LHR, NYC→JFK, PAR→CDG, TYO→NRT, and
~15 more well-known IATA metro/city codes) plus `normalizeAirportCode()`.
Wired into `nlParse` at all four call sites that previously did a bare
`.toUpperCase().slice(0,3)`: top-level `origin`/`destination`, the
explore-mode `origin`, and each `additional_slices` leg. **Shipped** - see
the ROM-at-Duffel finding below for why.

**Tests added** (`src/__tests__/parser/nl-parser.test.ts`,
`src/__tests__/parser/airports.test.ts`): retry-corrective assertions
(assistant-text capture + user-corrective appended exactly once, not
stacked across multiple failed attempts, no system-role message
introduced, placeholder text on empty content), a MAX_ATTEMPTS=4 bound
test alongside the existing =3 test, an `error`-field clarification-path
test, metro-code normalization at all four call sites (origin,
destination, explore-origin, multi-city leg) plus a real-code-passthrough
test, and a dedicated `airports.test.ts` unit suite. All existing tests
continue to pass unmodified. Full suite: **60 files / 463 passed, 3
skipped** (up from the pre-existing 59/448 baseline). Lint and
`tsc --noEmit` both clean.

### Required change #3: ROM-at-Duffel characterization (before shipping Change 2)

Per the approval's explicit requirement, characterized what Duffel actually
does with the raw metro code "ROM" **before** wiring the normalization in,
using a temporary live test against the real Duffel **sandbox** API
(`duffel_test_` key, read-only `POST /air/offer_requests` - no order/
payment code touched, consistent with this item's scope). Findings (run
twice, consistent both times):

- `MAD → ROM`, departure `2026-08-20`: **succeeds**, 186 real offers
  returned. Every single offer's destination airport is **FCO only** -
  no CIA (Ciampino) offers appeared at all.
- `ROM → MAD` (as origin): **succeeds**, 182 offers, all originating from
  **FCO only**.
- Control, `MAD → FCO` (passing the real airport code directly): 187
  offers, also all FCO.

**Conclusion:** Duffel does not reject or mishandle the raw metro code
"ROM" - it accepts it and returns valid, bookable offers. But it does
**not** fan out to a genuine multi-airport search (no CIA results ever
appeared) - it silently resolves "ROM" to FCO only, internally, producing
a result statistically indistinguishable from passing "FCO" directly (186
vs 187 offers is ordinary sandbox-data variance between two separate
calls, not a systematic difference). This is a third outcome the approval's
two-way framing ("rejects/mishandles" vs. "searches both FCO+CIA") didn't
explicitly anticipate.

**Decision: ship Change 2's normalization.** Reasoning: the approval's
actual concern was the Price principle - would narrowing to FCO drop
cheaper CIA options a raw "ROM" search would otherwise have surfaced? The
live evidence says no: Duffel itself never returns CIA options for "ROM" in
the first place, so there is nothing for our own explicit normalization to
drop. Doing the resolution ourselves (rather than relying on Duffel's own
undocumented metro-code handling - the Duffel API docs available in this
repo's `duffel-api` skill describe an airport's own `iata_code` vs.
`iata_city_code` as distinct fields, but nowhere document accepting a raw
city code as a search input) is a net-neutral-to-positive move: same
observed results, no dependency on undocumented provider behavior for
correctness going forward. No Price-principle regression identified or
expected.

### Required change #2: hard live-test gate (real Z.AI API)

Ran a temporary live test (`nlParse()` called directly, not mocked) against
the real Z.AI API in 3 separate batches, covering the exact class of query
that failed in the original report and the founder's diagnostic session:
`"Paris to Rome on August 15"`, `"London to Berlin on August 15"`,
`"Madrid to Amsterdam on September 10"`, `"Tokyo to Sydney on October 3"` -
5 runs each per batch (20 calls/batch, 60 total).

**Results, aggregated across all 3 batches (60 total `nlParse()` calls):**
- **HARD_FAIL ("Could not parse flight search from your message.")** rate:
  **0/60 (0%)** - down from the founder's previously-confirmed ~50%
  per-attempt failure rate. Every query resolved to a real, concrete
  `departure_date` (correctly picking the nearest future occurrence -
  2026 or 2027 depending on whether Aug/Sep/Oct 2026 had already passed
  relative to each individual real API call's own "today").
- **CLARIFY_DATE (over-clarification signal - model asks "which year?" or
  similar instead of resolving)**: **0/60 (0%)**. 1b's strengthened wording
  did not trade hard failures for excessive date-clarification questions -
  the specific partial-failure mode the plan review flagged did not
  manifest in this testing.
- **CLARIFY_OTHER (graceful non-date clarification)**: 0/60.
- **SUCCESS**: 59/60 (98.3%) resolved to valid params directly. The
  remaining 1/60 twice showed a rare "OTHER" outcome (no params, no error,
  no answer, no exploreParams - all four `ParseResult` fields empty) on
  `"Tokyo to Sydney on October 3"`, not reproduced in 6 immediate isolated
  follow-up calls with the same query, nor in the 3rd full batch (20/20
  clean). Reported honestly rather than glossed over: this is a real,
  observed edge case, occurring at roughly a 1-in-30 rate in this testing,
  that doesn't fit any of the three intended outcome buckets - but it is
  categorically different from, and far rarer than, the pre-fix ~50%
  hard-fail rate, and is not the over-clarification failure mode either.
  Root cause not isolated (the instrumented raw per-attempt Z.AI telemetry
  did not capture data - the OpenAI SDK does not route through
  `globalThis.fetch` in a way the test's fetch-spy could intercept, so only
  `nlParse()`'s final outcome was observable, not which internal attempt
  produced it). Filing as a new low-severity follow-up item
  (`docs/product-quality/`, owner `fullstack-engineer`) rather than
  blocking this fix on a ~3% unreproduced anomaly, per the "keep the diff
  as small as the fix actually requires" discipline - this item's mandate
  was the ~50% hard-fail rate, which is confirmed fixed.

**Honest caveat carried forward from the plan's own uncertainty #1:** this
live test is real evidence, not a formal statistical proof - 60 calls
across 4 query patterns strongly demonstrates the fix works and doesn't
over-clarify, but non-deterministic model behavior means the true
long-run rate could differ modestly from these exact percentages. The
before/after contrast (0% vs. a previously-confirmed ~50%) is large enough
that this conclusion is not sensitive to normal sampling noise.

### Independent review (fresh Opus pass, 2026-07-15)

Verdict: **APPROVE WITH NITS.** Confirmed: all three required changes
genuinely implemented (1d as PRIMARY not fallback, appended-once guard
verified in the actual guard logic; MAX_ATTEMPTS 3→4 with old + new bound
tests both valid; Change 2 wired at all four call sites; ROM-at-Duffel
finding specific and evidence-justified, not asserted; live-test numbers
specific and the over-clarification bucket genuinely measured, not waved
off). Scope clean - no Duffel/payment/order/secret code touched. Reviewed
the `mockCreate.mock.calls[n].messages` shared-mutated-array trap
specifically and confirmed the tests assert final-state invariants that
would actually fail if the retry/dedup logic broke - not false coverage.

One real, blocking-worthy finding: **line 187 of the system prompt** still
read "Set error only if the message is completely unrelated to travel" -
a leftover from before 1a/1c, directly contradicting the newly-broadened
`error` field description and the new closing instruction that both now
tell the model to route flight-shaped clarifications through `error` too.
Fixed: reconciled line 187 to match 1a/1c (error is for either "unrelated
to travel" OR "flight-shaped but needs clarification," with an explicit
reminder not to use it to ask about years). Re-ran the full mocked suite
(60/60 files, 463/463 passing, lint + typecheck clean) and a 6-call
confirmatory live batch against the real Z.AI API after the fix - 6/6
clean successes, no regression introduced by the wording reconciliation.

Two non-blocking notes from the review, not acted on (correctly minor):
the corrective pair also gets appended once, harmlessly, right as the loop
is about to exit on a final failed attempt (wasted mutation, not a bug);
and the live test measured `nlParse()`'s end-to-end outcome rather than
raw per-attempt telemetry (disclosed honestly in this file already - the
fetch-spy instrumentation didn't capture data because the OpenAI SDK
doesn't route through `globalThis.fetch` in an interceptable way).

Status: **`in-review`**. PR opened:
https://github.com/youssefsaiid21-a11y/travel-platform/pull/8
(branch `fix/bug-0003-nl-search-tool-call-enforcement`) - not merged by
this agent, per protocol. Follow-up item filed for the live-test anomaly:
`docs/product-quality/BUG-0007-rare-empty-nlparse-result.md`.

## Merge (founder-agent, 2026-07-15)

Independently verified before merging (diff re-read via `gh pr diff 8`,
matches the execution report exactly - no Duffel/payment/order/secret code
touched, confirmed non-money-adjacent). CI green
(`build-and-test` passed). PR branch was already even with `main`'s tip
(no rebase needed - no other work had landed since the charter-widening
commit). Re-ran the full gate on the exact merged commit directly (not
trusting the agent's own report): `npm run lint` clean, `npx tsc --noEmit`
clean, `npm test` 60/60 files, 463/463 tests passing, 3 skipped - matches
the execution report. Merged via squash, branch deleted
(`54d52d1`). Per the merge-authority rule, this did not need a separate
founder ask - bug-type, no money-adjacent code, independent review already
passed. Status moved to `merged`. Not yet `verified` - that's the Product
Agent's job on its next pass, post-deploy.

