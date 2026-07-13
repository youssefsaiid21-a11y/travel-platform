---
id: BUG-0003
type: bug
status: open
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
