# PLAN: Vertical Slice 1 - Conversational Flight Search

## Goal
A user types a natural-language flight request and gets back a clean,
structured, comparable set of real flight options pulled from Duffel's
sandbox environment. Nothing gets booked. This slice proves the "faster,
more seamless search" thesis before any money-touching code exists.

## In scope
- NL input parsing → structured search params (origin, destination, dates,
  pax, cabin, flexible-date handling like "sometime in October")
- Duffel offer request (sandbox) → normalized results
- Result ranking/filtering (price, duration, stops, times)
- A conversational follow-up loop ("cheaper if I fly Tuesday instead?")
  re-queries rather than hallucinating an answer from prior results
- Basic session/conversation state (in-memory or DB, your call)

## Explicitly out of scope for this slice
- Payment
- Order/ticket creation
- User accounts / auth beyond a session id
- Any live (non-sandbox) API calls

## Acceptance criteria (deterministic - a goal loop can check these)
- [ ] Given a fixed set of 10 canned NL queries (write these as fixtures),
      the parser extracts correct structured params for all 10
- [ ] A search for a real sandbox route returns >0 offers and each offer
      has price, airline, duration, stops, departure/arrival times
- [ ] Every displayed price matches what Duffel's sandbox API returned -
      no client-side price math beyond currency formatting
- [ ] A follow-up query that changes one param (date, cabin) triggers a
      fresh Duffel call, not a client-side guess
- [ ] Zero calls to any non-sandbox Duffel endpoint (verify via request
      logging/hook, not just code inspection)
- [ ] Test suite passes; no TODOs left in payment/booking-adjacent code
      paths (there shouldn't be any yet - flag it if there are)

## Definition of done
All boxes above checked, with command output shown as evidence, not just
"looks good" from the implementing agent.
