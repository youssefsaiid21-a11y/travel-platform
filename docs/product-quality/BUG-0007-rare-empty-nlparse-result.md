---
id: BUG-0007
type: bug
status: open
flow: search
severity: degrades-experience
owner: fullstack-engineer
created: 2026-07-15
observed_at_commit: 86bb45c
---

## Repro steps

Filed as a direct byproduct of BUG-0003's required live-acceptance test
(fullstack-engineer, 2026-07-15) - not independently reproduced from a
fresh manual repro, so treat the repro steps below as "what was observed
during that test," not a guaranteed-reproducible recipe.

1. Called the real `nlParse()` function (not mocked) against the live
   Z.AI API directly, in 3 separate batches of 20 calls each (60 total),
   using `"Tokyo to Sydney on October 3"` among 4 rotating absolute-date
   city-pair queries, 5 runs per query per batch.
2. In 2 of the 3 batches, exactly one call for `"Tokyo to Sydney on
   October 3"` returned a `ParseResult` with **all four fields empty**:
   `params: null, error: null, answer: null, exploreParams: null`.
3. Immediately re-ran the identical query 6 times in isolation
   (dedicated follow-up test, same session) - 0/6 reproduced. The 3rd
   full batch (20/20 calls) also showed zero occurrences.

Observed rate: ~2/60 (~3%) in this testing, concentrated (but not
exclusively demonstrated to be tied to) one query out of four tested.

## Expected behavior

`nlParse()` should always return a `ParseResult` where at least one of
`params`/`error`/`answer`/`exploreParams` is set - the four fields are
meant to be mutually exclusive but collectively exhaustive outcomes
(valid search / friendly error / knowledge answer / explore-anywhere).

## Actual behavior

Downstream, `src/app/api/chat/route.ts`'s `if (!params || error)` branch
still catches this case safely (since `params` is null) and falls back to
the generic "I couldn't understand that as a flight search..." reply - so
this does NOT crash or silently mis-search; it's a false-negative "we
couldn't understand you" for a query that should have parsed fine, roughly
1-in-30 of the time in this testing. Degrades Ease (an otherwise
well-formed query occasionally gets an unhelpful generic reply) but does
not block booking - a retry or rephrase works.

## Evidence

- Raw JSON dump of the two occurrences (from BUG-0003's live-test logging):
  `{"params":null,"error":null,"answer":null,"exploreParams":null}` for
  `"Tokyo to Sydney on October 3"`.
- Root cause NOT isolated. An attempt to instrument per-attempt Z.AI
  telemetry (a `globalThis.fetch` spy) captured zero real network calls,
  implying the OpenAI SDK does not route through `globalThis.fetch` in a
  way that spy could intercept - so it's unknown which of the (up to 4)
  retry attempts produced this, or whether it happened on attempt 1 (never
  hit the retry/corrective path at all) or after the retry corrective was
  already appended.

## Suggested fix direction

Two independent angles worth checking, neither confirmed:
1. A defensive fallback in `nlParse()` itself: if all four attempts
   exhaust without EITHER a hard failure being set NOR a valid
   `input`/`toolCallName`, the existing "Could not parse..." path should
   already catch it (`if (!input || !toolCallName)` at the top) - so this
   suggests `input`/`toolCallName` WERE actually set (a tool call was
   parsed successfully) but fell through every subsequent branch (not
   `answer_travel_question`, no `input.error`, `hasDestination` false but
   `input.origin` also missing/invalid in a way not caught, or some other
   uncovered combination). Re-read `nlParse`'s branches added by BUG-0003
   (Change 1's `error`-field path, the explore-mode branch, the top-level
   origin/departure_date guard) for a gap where a malformed-but-parseable
   tool call could produce all-null.
2. Reproduce with real request/response logging temporarily added
   (`console.log` on the raw `toolCall.function.arguments` string before
   `JSON.parse`) across enough live runs to catch the case in the act,
   since post-hoc analysis without the raw payload couldn't isolate it
   here.

Given the low rate (~3%), graceful downstream fallback (no crash, just a
generic reply), and non-reproducibility on demand, this is `degrades-
experience`, not `blocks-booking` - investigate opportunistically, not
urgently.

## Investigation (fullstack-engineer, 2026-07-14)

**Structural finding - the strongest lead.** Read `nlParse()` in full,
both at `observed_at_commit: 86bb45c` (`git show 86bb45c:src/lib/parser/nl-parser.ts`)
and at current HEAD. Both versions have exactly 7 `return` statements, and
**every one of them sets at least one of the four `ParseResult` fields to
a non-null value** (an `error` string, an `answer` string/`""`, a
`params` object, or an `exploreParams` object). There is no code path in
`nlParse()`, past or present, that can construct
`{params:null,error:null,answer:null,exploreParams:null}` as a normal
return value. This means the original evidence almost certainly did NOT
come from a return value of `nlParse()` itself.

**Where such a shape could actually come from:** `nlParse()` has exactly
one internal `try`/`catch` (around `JSON.parse(toolCall.function.arguments)`
only) - the actual network call, `client.chat.completions.create(...)`,
is NOT wrapped in any try/catch inside the retry loop. If that call
throws (timeout - the client has a 10s timeout per attempt -, a transient
5xx, a rate limit, or any OpenAI-SDK-level error), the exception
propagates straight out of `nlParse()` uncaught; it is not converted into
a `ParseResult` internally. This is a real, verifiable robustness gap:
`nlParse()`'s error handling only covers "the model responded but not
usefully" (no tool call, malformed JSON), not "the API call itself
failed."

The evidence was captured by BUG-0003's own throwaway live-test script
(not committed to this repo - could not be located to inspect directly).
Given the structural finding above, the most likely explanation is that
script's own catch-block, wrapping each of its 60 direct `nlParse()`
calls, defaulted to logging an all-null placeholder when `nlParse()`
threw (rather than capturing/printing the actual exception) - i.e. this
was very likely an artifact of the disposable test harness's own
error-handling choice, not a bug in `nl-parser.ts`'s parsing logic
itself. Consistent with this: production's actual caller,
`src/app/api/chat/route.ts:92-427`, wraps its `nlParse()` call (line 140)
in a try block whose `catch (err)` (line 423) pushes a real `error` SSE
event with `err.message` - so if this had happened in production, the
user would see a genuine error message, not the generic "I couldn't
understand that" fallback this item's "Actual behavior" section
describes (that fallback only fires when `nlParse()` *returns*
`{params: null, error: null-or-string}` normally, not when it throws).
This is a discrepancy worth flagging: if the original evidence really
was a thrown exception caught by the test script, then the "Actual
behavior" section's characterization of the *production* user impact may
not be accurate for whatever actually happened - a live user hitting the
same underlying transient failure would see a hard error, not a soft
"try rephrasing" message. Still `degrades-experience`, not
`blocks-booking` either way (both are recoverable by retry), so the
severity call stands regardless.

**Live reproduction attempt.** Added temporary instrumentation directly
in `nlParse()`'s retry loop (per this item's own suggested fix direction
#2) logging, per attempt: `finish_reason`, raw `tool_calls` count, raw
`message.content`, and the raw `function.arguments` string - then called
the real `nlParse()` against the live Z.AI API (`ZHIPU_API_KEY`) for the
flagged query, `"Tokyo to Sydney on October 3"`, wrapping each call in an
explicit try/catch to distinguish "returned all-null" from "threw an
exception" (the original test's gap - it caught zero real network calls
with a `fetch` spy, so this distinction was never actually observed
either way).
- **50 live calls total** (2 batches of 25), each with full per-attempt
  raw diagnostics captured.
- **Result: 0/50 all-null returns, 0/50 exceptions thrown.** All 50 calls
  eventually resolved to a valid `params` (occasionally after the model
  first asked a plain-text year-clarification question on attempt 0-1,
  which the existing corrective-retry mechanism successfully recovered
  from within the 4-attempt budget every time).
- At a true ~3% underlying rate, 0/50 is not statistically surprising
  (~21.8% chance of seeing zero occurrences in 50 draws at p=0.03) - this
  does not rule out the original observation, it just didn't happen to
  land in this window either.

**Why no fix is being shipped.** Per this item's own investigation
guidance: don't guess at a fix for a bug that can't be characterized. The
one real, verifiable gap found (`nlParse()`'s API call isn't wrapped in
try/catch) is a plausible *mechanism*, not a confirmed *cause* - it was
not observed firing in 50 fresh live attempts, and "fixing" it by adding
a catch-and-return-null-ParseResult inside `nlParse()` would trade a
loud, correct failure mode (production's existing outer catch already
surfaces a real error to the user) for a quiet, misleading one (a
generic "I couldn't understand that" message that hides an actual
infrastructure problem behind what looks like a user-input problem) -
that would be a regression dressed up as a fix. Recommend NOT adding such
a catch without first confirming, via the same instrumentation added
here (easy to re-add - see commit history if needed, not currently in
the codebase since it was temporary and has been removed), that this is
actually what's happening.

**Status: left `open`**, not `wontfix` - the underlying mechanism
(unhandled exception path in `nlParse()`) is real and worth someone
eventually deciding what the *right* behavior should be (surface the
real error, as today; or degrade gracefully with a generic reply, which
requires deciding whether masking infra errors as parse failures is
actually desirable) - that's a product-shape question, not something to
default on quietly. Next investigation step if this resurfaces: capture
a larger live sample (100+) with the same instrumentation pattern used
here, or add temporary telemetry to the *production* route's existing
`err` catch (line 423-426) to see whether any real user traffic is
actually hitting that path for chat requests - that would settle the
question with real signal instead of more live-call sampling.

No code changes shipped for this item - all temporary instrumentation
(the debug `console.error` in `nl-parser.ts`'s retry loop, and the
standalone live-test file) was added, used, and then fully removed
before concluding; `git status`/`git diff` on `src/lib/parser/nl-parser.ts`
confirmed clean (no residual diff) after cleanup.

## Telemetry added (fullstack-engineer, 2026-07-16)

Implemented this item's own recommended next step: added *permanent*
production telemetry to `src/app/api/chat/route.ts`'s existing outer catch
block, rather than more temporary/local sampling. A `phase` tracker
variable (`"session_init"` / `"nl_parse"` / `"explore_search"` /
`"duffel_search"` / `"price_calendar_and_reply"`) is updated immediately
before each major `await` in the stream handler, so the catch block knows
which phase was in flight when an unhandled exception hit it. On any such
exception, the catch now calls `Sentry.captureException(err, { tags: {
route: "api/chat", failureMode: "unhandled_stream_error", phase }, extra:
{ sessionId: session_id ?? null } })` (plus a `console.error`) *before*
the pre-existing behavior (the SSE `error` event push and
`controller.close()`), which is otherwise completely unchanged - no
user-visible behavior differs. No PII/message text is sent.

This does NOT fix the underlying issue - it's instrumentation only, per
this item's own investigation conclusion above (adding a catch-and-
return-null inside `nl-parser.ts` itself, without confirming the
mechanism, would mask a real infra failure as a fake user-input failure).
**Status stays `open`.** Once this ships to production, watch Sentry for
`route:api/chat` + `failureMode:unhandled_stream_error` events, especially
with `phase:nl_parse` - if real user traffic is hitting this, that's the
confirmation needed to decide the real product-shape question (surface
the real error, as today; or degrade gracefully with a generic reply). If
nothing fires over a reasonable observation window, that's evidence this
was specific to the original disposable test harness's own error handling
(see the 2026-07-14 investigation above), not a live production gap.

PR: `fix/bug-0007-chat-telemetry` branch, opened against `main`, tests/
lint/typecheck all clean, independent Opus review passed clean. Not yet
merged - awaiting the founder-agent's merge decision (see this repo's
Fullstack Engineer agent doc: merges are not automatically the
founder-agent's call, brought back for a live decision here).
