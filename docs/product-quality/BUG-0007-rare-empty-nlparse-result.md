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
