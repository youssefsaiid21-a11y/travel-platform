---
id: BUG-0005
type: bug
status: in-review
flow: payment
severity: blocks-booking
owner: fullstack-engineer
created: 2026-07-14
observed_at_commit: 23c8392
---

## How this was found

Not from a Product Agent walkthrough - surfaced by the Fullstack Engineer
agent while planning the fix for BUG-0002 (payment succeeds, Duffel order
creation fails silently). Filed as its own item per that plan's own
recommendation, rather than folded into BUG-0002's diff, to keep that fix
to one flow.

## The gap

`src/app/api/stripe/payment-intent` re-fetches the offer via
`getOfferWithServices` immediately before creating the Stripe
PaymentIntent (i.e. before the card is charged) - but never checks
`offer.expires_at` against the current time before proceeding. This is
the only point in the booking flow where a check could prevent charging
the card at all for an offer that's already dead; everywhere else
(`api/booking/route.ts`, addressed in BUG-0002) only runs after the
charge has already happened.

This project's own Duffel skill doc already flags this as a known risk
class: `.claude/skills/duffel-api/SKILL.md:103` - `"expires_at: ISO 8601
// offers expire - check before booking"`.

## Expected behavior

If `offer.expires_at` has already passed when the PaymentIntent is about
to be created, the route should refuse to create it and return a clear
error - the user should never be able to submit payment for an offer
that's already guaranteed to fail order creation.

## Actual behavior

No such check exists. A user can submit payment for an already-expired
offer, the charge succeeds, and only then (in the separate `api/booking`
route, per BUG-0002) does the doomed Duffel order attempt fail - after
the money has already moved.

## Suggested fix direction

Add a read-only `expires_at <= now` guard in the payment-intent route,
immediately after the offer re-fetch and before `stripe.paymentIntents.create(...)`
is called. This is NOT money-moving code itself - it's a precondition
check that refuses to set up a payment for a dead offer, same risk class
as the amount-verification check the route presumably already does.
Still money-adjacent (it's in the payment-intent creation path), so
`booking-safety-reviewer` review is still required on the resulting diff,
same as BUG-0002.

## Resolution (2026-07-16)

Implemented as planned: `src/app/api/stripe/payment-intent/route.ts` now
checks `new Date(offer.expires_at).getTime() <= Date.now()` immediately
after the amount-validation guard and before `stripe.paymentIntents.create`,
returning 410 on expiry. Also logs `Sentry.captureException` (tags:
`route: "api/stripe/payment-intent"`, `failureMode: "offer_expired_preauth"`)
so this guard's real-world hit rate is measurable, matching
`api/booking/route.ts`'s existing post-charge check. New test added in
`src/__tests__/api/payment-intent.test.ts`. Independent Opus review: PASS,
no issues. `booking-safety-reviewer`: clean against all 5 checks. Plan
sign-off and this diff's merge decision both required the human founder's
explicit approval separately, per this item's money-adjacent status - plan
approved 2026-07-16 (with the Sentry addition, per independent plan
review's recommendation); merge is a separate, still-pending ask.
